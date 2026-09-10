console.log("Canvas AI Assistant background worker started");

const BASE_URL = "https://rutgers.instructure.com/api/v1";
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

const CLAUDE_API_URL = "https://api.anthropic.com/v1/messages";
const CLAUDE_MODEL = "claude-opus-5";

const SYSTEM_PROMPT = `You are a helpful assistant for a Rutgers student. You answer questions about ONE of their Canvas courses using ONLY the course data (syllabus, assignments, and file text) provided in the user's message.

Rules:
- Only use information present in the provided course data. Never use outside knowledge about this course, Rutgers, or typical academic policies to fill gaps.
- If the answer — a due date, grade, policy, or file content — is not present in the provided data, say plainly that it is not available in the indexed course data. Do not guess or estimate.
- When you do answer, mention whether it came from the syllabus, an assignment, or a specific file so the student can double check it.
- Be concise and answer the question directly.`;

async function fetchJSON(url) {
  const response = await fetch(url, {
    credentials: "include",
    headers: { "Accept": "application/json" }
  });
  return response.json();
}

async function indexAllCourses() {
  const courses = await fetchJSON(`${BASE_URL}/courses?enrollment_state=active`);
  console.log(`Found ${courses.length} courses`);

  const fullData = [];

  for (const course of courses) {
    console.log(`Fetching data for: ${course.name}`);

    const assignments = await fetchJSON(
      `${BASE_URL}/courses/${course.id}/assignments?per_page=100`
    );
    const files = await fetchJSON(
      `${BASE_URL}/courses/${course.id}/files?per_page=100`
    );
    const courseDetails = await fetchJSON(
      `${BASE_URL}/courses/${course.id}?include[]=syllabus_body`
    );

    const filesArray = Array.isArray(files) ? files : [];
    const syllabusText = stripHtml(courseDetails.syllabus_body);

    // NEW: extract text for each PDF file
    for (const file of filesArray) {
      if (file["content-type"] !== "application/pdf") {
        console.log(`Skipping non-PDF file: ${file.display_name}`);
        file.extractedText = null;
        continue;
      }

      console.log(`Extracting text from: ${file.display_name}`);
      try {
        file.extractedText = await extractPdfText(file.url);
      } catch (err) {
        console.warn(`Failed to extract ${file.display_name}:`, err.message);
        file.extractedText = null;
      }

      await new Promise(resolve => setTimeout(resolve, 250));
    }

    fullData.push({
      id: course.id,
      name: course.name,
      assignments: assignments,
      files: filesArray,
      syllabusText: syllabusText
    });

    await new Promise(resolve => setTimeout(resolve, 250));
  }

  await chrome.storage.local.set({
    courseIndex: fullData,
    lastSynced: Date.now()
  });

  console.log("Full index saved to storage:", fullData);
  return fullData;
}

async function getCourseIndex(forceRefresh = false) {
  const stored = await chrome.storage.local.get(["courseIndex", "lastSynced"]);

  const isStale =
    !stored.lastSynced || (Date.now() - stored.lastSynced) > ONE_DAY_MS;

  if (!forceRefresh && stored.courseIndex && !isStale) {
    console.log("Using cached course index from storage (still fresh)");
    return stored.courseIndex;
  }

  console.log("Cache missing or stale — re-indexing from Canvas");
  return indexAllCourses();
}

let offscreenReady = null;

async function ensureOffscreenDocument() {
  if (offscreenReady) return offscreenReady;

  offscreenReady = chrome.offscreen.createDocument({
    url: "offscreen.html",
    reasons: ["WORKERS"],
    justification: "Extract text from PDF files using pdf.js"
  });

  return offscreenReady;
}

async function extractPdfText(fileUrl) {
  await ensureOffscreenDocument();

  const response = await chrome.runtime.sendMessage({
    type: "EXTRACT_PDF_TEXT",
    fileUrl: fileUrl
  });

  if (!response.success) {
    throw new Error(response.error);
  }

  return response.text;
}

function stripHtml(html) {
  if (!html) return "";
  return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function buildCourseContext(course) {
  const assignments = (course.assignments || []).map(a => ({
    name: a.name,
    due_at: a.due_at,
    points_possible: a.points_possible,
    description: stripHtml(a.description)
  }));

  const files = (course.files || []).map(f => ({
    name: f.display_name,
    extractedText: f.extractedText || null
  }));

  return {
    course_name: course.name,
    syllabus: course.syllabusText || null,
    assignments,
    files
  };
}

async function askClaude(courseId, question) {
  const { apiKey } = await chrome.storage.local.get(["apiKey"]);

  if (!apiKey) {
    throw new Error("No API key set. Please add your Claude API key in the extension settings.");
  }

  const { courseIndex } = await chrome.storage.local.get(["courseIndex"]);
  const course = (courseIndex || []).find(c => String(c.id) === String(courseId));

  if (!course) {
    throw new Error("Couldn't find that course in the indexed data. Try refreshing the extension.");
  }

  const courseContext = buildCourseContext(course);
  const userMessage = `Today's date is ${new Date().toISOString()}.\n\nCourse data (JSON):\n${JSON.stringify(courseContext)}\n\nQuestion: ${question}`;

  const response = await fetch(CLAUDE_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-beta": "server-side-fallback-2026-07-01",
      "anthropic-dangerous-direct-browser-access": "true"
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      output_config: { effort: "low" },
      fallbacks: "default",
      messages: [{ role: "user", content: userMessage }]
    })
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data?.error?.message || `Claude API error (${response.status})`);
  }

  if (data.stop_reason === "refusal") {
    throw new Error("Claude declined to answer that question.");
  }

  const textBlock = (data.content || []).find(block => block.type === "text");
  return textBlock ? textBlock.text : "";
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type !== "ASK_QUESTION") return;

  askClaude(message.courseId, message.question)
    .then(answer => sendResponse({ success: true, answer }))
    .catch(err => sendResponse({ success: false, error: err.message }));

  return true; // keep the message channel open for the async response
});

// Run once when the background worker starts
getCourseIndex();