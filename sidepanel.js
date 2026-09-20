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

const dueSoonCardsEl = document.getElementById("dueSoonCards");
const viewAllDueSoonButton = document.getElementById("viewAllDueSoonButton");

const HISTORY_MAX_PAIRS = 3;
const SESSION_INACTIVITY_MS = 30 * 60 * 1000;

const DUE_SOON_DEFAULT_COUNT = 3;
const DUE_SOON_URGENT_DAYS = 1;
const DUE_SOON_SOON_DAYS = 3;

let dueSoonExpanded = false;

function cleanCanvasUrl(value) {
  return value.trim().replace(/^https?:\/\//i, "").split("/")[0];
}

function getRecentHistoryForRequest(chatHistory) {
  if (!chatHistory || chatHistory.length === 0) return [];

  const lastMessage = chatHistory[chatHistory.length - 1];
  const isNewSession = Date.now() - lastMessage.timestamp > SESSION_INACTIVITY_MS;

  if (isNewSession) return [];

  return chatHistory.slice(-HISTORY_MAX_PAIRS * 2);
}

function isPlausibleDomain(value) {
  return /^[^\s/]+\.[^\s/]+$/.test(value);
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
  const { courseIndex, indexError } = await chrome.storage.local.get(["courseIndex", "indexError"]);

  if (indexError) {
    statusEl.textContent = "Couldn't reach Canvas at that URL. Double check your school's Canvas domain in settings.";
    askButton.disabled = true;
    return;
  }

  if (!courseIndex || courseIndex.length === 0) {
    statusEl.textContent = "No indexed courses yet. Visit Canvas and reopen the extension.";
    askButton.disabled = true;
    return;
  }

  askButton.disabled = false;
  statusEl.textContent = "";
}

function daysUntil(dueAt) {
  const now = new Date();
  const due = new Date(dueAt);

  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfDue = new Date(due.getFullYear(), due.getMonth(), due.getDate());

  return Math.round((startOfDue - startOfToday) / (24 * 60 * 60 * 1000));
}

function dueSoonUrgency(daysAway) {
  if (daysAway <= DUE_SOON_URGENT_DAYS) return "due-urgent";
  if (daysAway <= DUE_SOON_SOON_DAYS) return "due-soon";
  return "due-later";
}

function dueSoonLabel(daysAway) {
  if (daysAway <= 0) return "Due today";
  if (daysAway === 1) return "Tomorrow";
  return `In ${daysAway} days`;
}

function collectUpcomingAssignments(courseIndex) {
  const now = Date.now();
  const upcoming = [];

  for (const course of courseIndex || []) {
    for (const assignment of course.assignments || []) {
      if (!assignment.due_at) continue;

      const dueTime = new Date(assignment.due_at).getTime();
      if (Number.isNaN(dueTime) || dueTime < now) continue;

      upcoming.push({
        name: assignment.name,
        course_name: course.name,
        due_at: assignment.due_at
      });
    }
  }

  upcoming.sort((a, b) => new Date(a.due_at) - new Date(b.due_at));
  return upcoming;
}

function renderDueSoonCard(assignment) {
  const daysAway = daysUntil(assignment.due_at);
  const dueDate = new Date(assignment.due_at);
  const month = dueDate.toLocaleString("en-US", { month: "short" }).toUpperCase();

  const card = document.createElement("div");
  card.className = `dueCard ${dueSoonUrgency(daysAway)}`;
  card.innerHTML = `
    <div class="dueBadge">${month} ${dueDate.getDate()}</div>
    <div class="dueName"></div>
    <div class="dueCourse"></div>
    <div class="duePill">${dueSoonLabel(daysAway)}</div>
  `;
  card.querySelector(".dueName").textContent = assignment.name;
  card.querySelector(".dueCourse").textContent = assignment.course_name;
  return card;
}

async function renderDueSoon() {
  const { courseIndex } = await chrome.storage.local.get(["courseIndex"]);
  const upcoming = collectUpcomingAssignments(courseIndex);

  dueSoonCardsEl.innerHTML = "";

  if (upcoming.length === 0) {
    const empty = document.createElement("div");
    empty.id = "dueSoonEmpty";
    empty.textContent = "Nothing due soon.";
    dueSoonCardsEl.appendChild(empty);
    viewAllDueSoonButton.hidden = true;
    return;
  }

  const visible = dueSoonExpanded ? upcoming : upcoming.slice(0, DUE_SOON_DEFAULT_COUNT);
  for (const assignment of visible) {
    dueSoonCardsEl.appendChild(renderDueSoonCard(assignment));
  }

  viewAllDueSoonButton.hidden = upcoming.length <= DUE_SOON_DEFAULT_COUNT;
  viewAllDueSoonButton.textContent = dueSoonExpanded ? "Show less" : "View all →";
}

viewAllDueSoonButton.addEventListener("click", () => {
  dueSoonExpanded = !dueSoonExpanded;
  renderDueSoon();
});

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
  renderDueSoon();
  loadChatHistory();
}

saveSettingsButton.addEventListener("click", async () => {
  const canvasUrl = cleanCanvasUrl(canvasUrlInput.value);
  const key = apiKeyInput.value.trim();

  if (!canvasUrl) {
    settingsStatusEl.textContent = "Please enter your school's Canvas URL (e.g. rutgers.instructure.com).";
    return;
  }

  if (!isPlausibleDomain(canvasUrl)) {
    settingsStatusEl.textContent = `"${canvasUrl}" doesn't look like a valid domain — enter just the domain (e.g. rutgers.instructure.com), not a full page URL.`;
    return;
  }

  if (!key || !key.startsWith("sk-ant-")) {
    settingsStatusEl.textContent = 'Please enter a valid Claude API key (it should start with "sk-ant-").';
    return;
  }

  await chrome.storage.local.set({ canvasUrl, apiKey: key });
  await chrome.storage.local.remove("indexError");
  showMain();
  askButton.disabled = true;
  statusEl.textContent = "Checking your Canvas URL...";

  chrome.runtime.sendMessage({ type: "REFRESH_COURSE_INDEX" }, () => {
    checkIndexReady();
    renderDueSoon();
  });

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

askButton.addEventListener("click", async () => {
  const question = questionInput.value.trim();

  if (!question) return;

  askButton.disabled = true;
  statusEl.textContent = "Thinking...";

  const { chatHistory } = await chrome.storage.local.get(["chatHistory"]);
  const history = getRecentHistoryForRequest(chatHistory);

  chrome.runtime.sendMessage({ type: "ASK_QUESTION", question, history }, async (response) => {
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
