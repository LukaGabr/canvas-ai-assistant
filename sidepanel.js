const settingsSection = document.getElementById("settingsSection");
const mainSection = document.getElementById("mainSection");
const canvasUrlInput = document.getElementById("canvasUrlInput");
const apiKeyInput = document.getElementById("apiKeyInput");
const saveSettingsButton = document.getElementById("saveSettingsButton");
const settingsStatusEl = document.getElementById("settingsStatus");
const changeSettingsButton = document.getElementById("changeSettingsButton");

const messageListEl = document.getElementById("messageList");
const emptyStateEl = document.getElementById("emptyState");
const questionInput = document.getElementById("questionInput");
const askButton = document.getElementById("askButton");
const statusEl = document.getElementById("status");
const clearButton = document.getElementById("clearButton");

function cleanCanvasUrl(value) {
  return value.trim().replace(/^https?:\/\//i, "").replace(/\/+$/, "");
}

async function showSettings() {
  const { canvasUrl } = await chrome.storage.local.get(["canvasUrl"]);
  canvasUrlInput.value = canvasUrl || "";
  apiKeyInput.value = "";
  settingsStatusEl.textContent = "";
  settingsSection.hidden = false;
  mainSection.hidden = true;
}

function showMain() {
  settingsSection.hidden = true;
  mainSection.hidden = false;
}

async function checkIndexReady() {
  const { courseIndex } = await chrome.storage.local.get(["courseIndex"]);

  if (!courseIndex || courseIndex.length === 0) {
    statusEl.textContent = "No indexed courses yet. Visit Canvas and reopen the extension.";
    askButton.disabled = true;
    return;
  }

  askButton.disabled = false;
  statusEl.textContent = "";
}

function renderMessage(message) {
  emptyStateEl.hidden = true;

  const bubble = document.createElement("div");
  bubble.className = `msg ${message.role === "user" ? "msg-user" : "msg-assistant"}`;
  bubble.textContent = message.text;
  messageListEl.appendChild(bubble);
  messageListEl.scrollTop = messageListEl.scrollHeight;
}

async function loadChatHistory() {
  const { chatHistory } = await chrome.storage.local.get(["chatHistory"]);

  for (const message of chatHistory || []) {
    renderMessage(message);
  }
}

async function appendToHistory(messages) {
  const { chatHistory } = await chrome.storage.local.get(["chatHistory"]);
  const updated = [...(chatHistory || []), ...messages];
  await chrome.storage.local.set({ chatHistory: updated });
}

async function init() {
  const { apiKey, canvasUrl } = await chrome.storage.local.get(["apiKey", "canvasUrl"]);

  if (!apiKey || !canvasUrl) {
    showSettings();
    return;
  }

  showMain();
  checkIndexReady();
  loadChatHistory();
}

saveSettingsButton.addEventListener("click", async () => {
  const canvasUrl = cleanCanvasUrl(canvasUrlInput.value);
  const key = apiKeyInput.value.trim();

  if (!canvasUrl) {
    settingsStatusEl.textContent = "Please enter your school's Canvas URL (e.g. rutgers.instructure.com).";
    return;
  }

  if (!key || !key.startsWith("sk-ant-")) {
    settingsStatusEl.textContent = 'Please enter a valid Claude API key (it should start with "sk-ant-").';
    return;
  }

  await chrome.storage.local.set({ canvasUrl, apiKey: key });
  showMain();
  checkIndexReady();
  loadChatHistory();
});

changeSettingsButton.addEventListener("click", () => {
  showSettings();
});

clearButton.addEventListener("click", async () => {
  if (!confirm("Clear the entire conversation history? This can't be undone.")) return;

  await chrome.storage.local.remove("chatHistory");
  messageListEl.innerHTML = "";
  messageListEl.appendChild(emptyStateEl);
  emptyStateEl.hidden = false;
});

askButton.addEventListener("click", () => {
  const question = questionInput.value.trim();

  if (!question) return;

  askButton.disabled = true;
  statusEl.textContent = "Thinking...";

  chrome.runtime.sendMessage({ type: "ASK_QUESTION", question }, async (response) => {
    askButton.disabled = false;

    if (chrome.runtime.lastError) {
      statusEl.textContent = `Error: ${chrome.runtime.lastError.message}`;
      return;
    }

    if (!response || !response.success) {
      statusEl.textContent = `Error: ${response ? response.error : "No response from background script."}`;
      return;
    }

    statusEl.textContent = "";
    questionInput.value = "";

    const userMessage = { role: "user", text: question, timestamp: Date.now() };
    const assistantMessage = { role: "assistant", text: response.answer, timestamp: Date.now() };

    renderMessage(userMessage);
    renderMessage(assistantMessage);

    await appendToHistory([userMessage, assistantMessage]);
  });
});

init();
