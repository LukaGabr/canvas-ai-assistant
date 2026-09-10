console.log("Canvas AI Assistant background worker started");

const BASE_URL = "https://rutgers.instructure.com/api/v1";
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

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

    fullData.push({
      id: course.id,
      name: course.name,
      assignments: assignments,
      files: files
    });

    await new Promise(resolve => setTimeout(resolve, 250));
  }

  // Save to persistent storage, with a timestamp
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

// Run once when the background worker starts
getCourseIndex();

extractPdfText("https://rutgers.instructure.com/files/60310828/download?download_frd=1")
  .then(text => console.log("Extracted text:", text));