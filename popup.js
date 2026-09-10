const settingsSection = document.getElementById("settingsSection");
const mainSection = document.getElementById("mainSection");
const apiKeyInput = document.getElementById("apiKeyInput");
const saveKeyButton = document.getElementById("saveKeyButton");
const settingsStatusEl = document.getElementById("settingsStatus");
const changeKeyButton = document.getElementById("changeKeyButton");

const courseSelect = document.getElementById("courseSelect");
const questionInput = document.getElementById("questionInput");
const askButton = document.getElementById("askButton");
const statusEl = document.getElementById("status");
const answerEl = document.getElementById("answer");

function showSettings() {
  apiKeyInput.value = "";
  settingsStatusEl.textContent = "";
  settingsSection.hidden = false;
  mainSection.hidden = true;
}

function showMain() {
  settingsSection.hidden = true;
  mainSection.hidden = false;
}

async function loadCourses() {
  const { courseIndex } = await chrome.storage.local.get(["courseIndex"]);

  if (!courseIndex || courseIndex.length === 0) {
    statusEl.textContent = "No indexed courses yet. Visit Canvas and reopen the extension.";
    askButton.disabled = true;
    return;
  }

  courseSelect.innerHTML = "";
  for (const course of courseIndex) {
    const option = document.createElement("option");
    option.value = course.id;
    option.textContent = course.name;
    courseSelect.appendChild(option);
  }
}

async function init() {
  const { apiKey } = await chrome.storage.local.get(["apiKey"]);

  if (!apiKey) {
    showSettings();
    return;
  }

  showMain();
  loadCourses();
}

saveKeyButton.addEventListener("click", async () => {
  const key = apiKeyInput.value.trim();

  if (!key || !key.startsWith("sk-ant-")) {
    settingsStatusEl.textContent = 'Please enter a valid Claude API key (it should start with "sk-ant-").';
    return;
  }

  await chrome.storage.local.set({ apiKey: key });
  showMain();
  loadCourses();
});

changeKeyButton.addEventListener("click", () => {
  showSettings();
});

askButton.addEventListener("click", () => {
  const courseId = courseSelect.value;
  const question = questionInput.value.trim();

  if (!question) return;

  askButton.disabled = true;
  statusEl.textContent = "Thinking...";
  answerEl.textContent = "";

  chrome.runtime.sendMessage({ type: "ASK_QUESTION", courseId, question }, (response) => {
    askButton.disabled = false;
    statusEl.textContent = "";

    if (chrome.runtime.lastError) {
      answerEl.textContent = `Error: ${chrome.runtime.lastError.message}`;
      return;
    }

    if (!response || !response.success) {
      answerEl.textContent = `Error: ${response ? response.error : "No response from background script."}`;
      return;
    }

    answerEl.textContent = response.answer;
  });
});

init();
