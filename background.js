console.log("Canvas AI Assistant background worker started");

chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => console.error(error));

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

const CLAUDE_API_URL = "https://api.anthropic.com/v1/messages";
const CLAUDE_MODEL = "claude-sonnet-5";

const SYSTEM_PROMPT = `You are a helpful assistant for a college student. You answer questions about their Canvas courses using ONLY the course data provided to you: a lightweight summary covering every one of their active courses (syllabus text, assignment names/due dates/points, and current/final grade and score when posted), plus the results of any tools you call.

You have two tools available:
- get_file_content: fetches the full extracted text of one specific file, when the summary's file name list alone isn't enough to answer the question.
- get_assignment_details: fetches one specific assignment's full description, when its name/due date/points alone aren't enough to answer the question.

Rules:
- Only use information present in the provided summary or in tool results. Never use outside knowledge about a course, Rutgers, or typical academic policies to fill gaps.
- If the answer — a due date, grade, policy, or file/assignment content — is not available even after calling a relevant tool, say plainly that it is not available in the indexed course data. Do not guess or estimate. This applies to grades too: a null or missing grade/score means it hasn't been posted yet (common early in a course), not that it's zero — say so plainly rather than implying a grade exists.
- When you do answer, mention whether it came from the syllabus, an assignment, or a specific file so the student can double check it.
- Be concise and answer the question directly.`;

const TOOLS = [
  {
    name: "get_file_content",
    description: "Get the full extracted text of one specific file from one specific course. Call this only when the course summary (which lists file names but not their content) isn't enough to answer the question — e.g. the question is likely answered by something inside a specific document (a rubric, a reading, a project spec) rather than by a due date, grade weight, or policy already visible in the syllabus.",
    input_schema: {
      type: "object",
      properties: {
        course_id: { type: "string", description: "The course's id, from the course summary." },
        file_name: { type: "string", description: "The exact file name (as it appears in the course summary's file list)." }
      },
      required: ["course_id", "file_name"]
    }
  },
  {
    name: "get_assignment_details",
    description: "Get the full description of one specific assignment from one specific course. Call this only when the assignment's name, due date, and points alone (already in the course summary) aren't enough to answer the question — e.g. the question asks what an assignment requires, how it's graded, or other details that live in its description.",
    input_schema: {
      type: "object",
      properties: {
        course_id: { type: "string", description: "The course's id, from the course summary." },
        assignment_name: { type: "string", description: "The exact assignment name (as it appears in the course summary's assignments list)." }
      },
      required: ["course_id", "assignment_name"]
    }
  }
];

async function fetchJSON(url) {
  const response = await fetch(url, {
    credentials: "include",
    headers: { "Accept": "application/json" }
  });

  if (!response.ok) {
    throw new Error(`Canvas request failed (${response.status}): ${url}`);
  }

  try {
    return await response.json();
  } catch (err) {
    throw new Error(`Canvas didn't return valid data for: ${url}`);
  }
}

async function getBaseUrl() {
  const { canvasUrl } = await chrome.storage.local.get(["canvasUrl"]);

  if (!canvasUrl) {
    throw new Error("No Canvas URL set. Please add your school's Canvas URL in the extension settings.");
  }

  return `https://${canvasUrl}/api/v1`;
}

async function indexAllCourses() {
  const BASE_URL = await getBaseUrl();
  const courses = await fetchJSON(`${BASE_URL}/courses?enrollment_state=active`);
  console.log(`Found ${courses.length} courses`);

  const fullData = [];

  for (const course of courses) {
    console.log(`Fetching data for: ${course.name}`);

    let assignments = [];
    try {
      assignments = await fetchJSON(
        `${BASE_URL}/courses/${course.id}/assignments?per_page=100`
      );
    } catch (err) {
      console.warn(`Failed to fetch assignments for ${course.name}:`, err.message);
    }

    let filesArray = [];
    try {
      const files = await fetchJSON(
        `${BASE_URL}/courses/${course.id}/files?per_page=100`
      );
      filesArray = Array.isArray(files) ? files : [];
    } catch (err) {
      console.warn(`Failed to fetch files for ${course.name}:`, err.message);
    }

    let syllabusText = "";
    try {
      const courseDetails = await fetchJSON(
        `${BASE_URL}/courses/${course.id}?include[]=syllabus_body`
      );
      syllabusText = stripHtml(courseDetails.syllabus_body);
    } catch (err) {
      console.warn(`Failed to fetch details for ${course.name}:`, err.message);
    }

    let grades = null;
    try {
      const enrollments = await fetchJSON(
        `${BASE_URL}/courses/${course.id}/enrollments?user_id=self&state[]=active&state[]=completed`
      );
      const enrollment = Array.isArray(enrollments) ? enrollments[0] : null;
      const enrollmentGrades = enrollment && enrollment.grades;

      if (enrollmentGrades) {
        grades = {
          current_grade: enrollmentGrades.current_grade ?? null,
          current_score: enrollmentGrades.current_score ?? null,
          final_grade: enrollmentGrades.final_grade ?? null,
          final_score: enrollmentGrades.final_score ?? null
        };
      }
    } catch (err) {
      console.warn(`Failed to fetch grades for ${course.name}:`, err.message);
    }

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
      syllabusText: syllabusText,
      grades: grades
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

async function ensureOffscreenDocument() {
  if (await chrome.offscreen.hasDocument()) return;

  await chrome.offscreen.createDocument({
    url: "offscreen.html",
    reasons: ["WORKERS"],
    justification: "Extract text from PDF files using pdf.js"
  });
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

function buildAllCoursesSummary(courseIndex) {
  return (courseIndex || []).map(course => ({
    course_id: course.id,
    course_name: course.name,
    syllabus: course.syllabusText || null,
    assignments: (course.assignments || []).map(a => ({
      name: a.name,
      due_at: a.due_at,
      points_possible: a.points_possible
    })),
    files: (course.files || []).map(f => f.display_name),
    grades: course.grades || null
  }));
}

function findCourse(courseIndex, courseId) {
  return (courseIndex || []).find(c => String(c.id) === String(courseId));
}

function getFileContent(courseIndex, courseId, fileName) {
  const course = findCourse(courseIndex, courseId);
  if (!course) return `No course found with id "${courseId}".`;

  const file = (course.files || []).find(f => f.display_name === fileName);
  if (!file) return `No file named "${fileName}" found in ${course.name}.`;

  return file.extractedText || `"${fileName}" has no extracted text available (it may not be a PDF, or extraction failed).`;
}

function getAssignmentDetails(courseIndex, courseId, assignmentName) {
  const course = findCourse(courseIndex, courseId);
  if (!course) return `No course found with id "${courseId}".`;

  const assignment = (course.assignments || []).find(a => a.name === assignmentName);
  if (!assignment) return `No assignment named "${assignmentName}" found in ${course.name}.`;

  const description = stripHtml(assignment.description);
  return description || `"${assignmentName}" has no description text.`;
}

function resolveToolUse(courseIndex, block) {
  if (block.name === "get_file_content") {
    return getFileContent(courseIndex, block.input.course_id, block.input.file_name);
  }

  if (block.name === "get_assignment_details") {
    return getAssignmentDetails(courseIndex, block.input.course_id, block.input.assignment_name);
  }

  return `Unknown tool "${block.name}".`;
}

async function callClaude(apiKey, messages) {
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
      system: [
        { type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }
      ],
      tools: TOOLS,
      output_config: { effort: "low" },
      fallbacks: "default",
      messages
    })
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data?.error?.message || `Claude API error (${response.status})`);
  }

  return data;
}

const MAX_TOOL_ROUNDS = 5;
const HISTORY_ANSWER_MAX_CHARS = 500;

function truncate(text, maxLength) {
  if (!text || text.length <= maxLength) return text;
  return `${text.slice(0, maxLength)}...`;
}

function formatHistoryBlock(history) {
  if (!history || history.length === 0) return null;

  const lines = history.map(entry => {
    const speaker = entry.role === "user" ? "Student" : "Assistant";
    const text = entry.role === "assistant" ? truncate(entry.text, HISTORY_ANSWER_MAX_CHARS) : entry.text;
    return `${speaker}: ${text}`;
  });

  return `Recent conversation so far in this session (the new question below may follow up on it):\n${lines.join("\n")}`;
}

async function askClaude(question, history) {
  const { apiKey } = await chrome.storage.local.get(["apiKey"]);

  if (!apiKey) {
    throw new Error("No API key set. Please add your Claude API key in the extension settings.");
  }

  const { courseIndex } = await chrome.storage.local.get(["courseIndex"]);

  if (!courseIndex || courseIndex.length === 0) {
    throw new Error("No indexed courses yet. Visit Canvas and reopen the extension.");
  }

  const summary = buildAllCoursesSummary(courseIndex);
  const historyText = formatHistoryBlock(history);

  const content = [
    {
      type: "text",
      text: `Course summary, across all active courses (JSON):\n${JSON.stringify(summary)}`,
      cache_control: { type: "ephemeral" }
    }
  ];

  if (historyText) {
    content.push({ type: "text", text: historyText });
  }

  content.push({
    type: "text",
    text: `Today's date is ${new Date().toISOString()}.\n\nQuestion: ${question}`
  });

  const messages = [{ role: "user", content }];

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const data = await callClaude(apiKey, messages);

    const usage = data.usage || {};
    console.log(
      `[cache] round ${round}: input=${usage.input_tokens ?? "?"} ` +
      `cache_read=${usage.cache_read_input_tokens ?? 0} ` +
      `cache_write=${usage.cache_creation_input_tokens ?? 0}`
    );

    if (data.stop_reason === "refusal") {
      throw new Error("Claude declined to answer that question.");
    }

    const toolUseBlocks = (data.content || []).filter(block => block.type === "tool_use");

    if (toolUseBlocks.length === 0) {
      const textBlock = (data.content || []).find(block => block.type === "text");
      return textBlock ? textBlock.text : "";
    }

    messages.push({ role: "assistant", content: data.content });

    const toolResults = toolUseBlocks.map(block => ({
      type: "tool_result",
      tool_use_id: block.id,
      content: resolveToolUse(courseIndex, block)
    }));

    messages.push({ role: "user", content: toolResults });
  }

  throw new Error("Claude needed too many tool calls to answer this question. Try asking something more specific.");
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "REFRESH_COURSE_INDEX") {
    getCourseIndex(true)
      .then(() => {
        chrome.storage.local.remove("indexError");
        sendResponse({ success: true });
      })
      .catch(err => {
        console.warn("Course index refresh failed:", err.message);
        chrome.storage.local.set({ indexError: err.message });
        sendResponse({ success: false, error: err.message });
      });

    return true; // keep the message channel open for the async response
  }

  if (message.type === "ASK_QUESTION") {
    askClaude(message.question, message.history)
      .then(answer => sendResponse({ success: true, answer }))
      .catch(err => sendResponse({ success: false, error: err.message }));

    return true; // keep the message channel open for the async response
  }
});

// Run once when the background worker starts
getCourseIndex()
  .then(() => chrome.storage.local.remove("indexError"))
  .catch(err => {
    console.warn("Skipping initial course index:", err.message);
    chrome.storage.local.set({ indexError: err.message });
  });