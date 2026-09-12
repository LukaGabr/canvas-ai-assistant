# Canvas AI Assistant

A Chrome extension that lets you ask questions about your Canvas courses in plain English — due dates, assignment details, syllabus policies, and lecture content — instead of clicking through nested course tabs.

> "What's due across all my classes this week?" → a real, grounded answer, pulled from your actual course data.

## Why this exists

Canvas buries useful information across dozens of pages per course. This extension indexes everything once — assignments, files, syllabus — and lets an AI answer questions directly from that real data, with honest "not available" answers instead of guesses when something genuinely isn't there.

**A deliberate technical constraint:** many schools (including the one this was built for) block students from generating personal Canvas API access tokens. Rather than requiring one, this extension authenticates using your normal, already-logged-in browser session — the same way Canvas's own website works — so it runs without ever needing special API access from your school's IT department.

## Features

- **Auto-indexes every active course** — assignments, files, and syllabus content, pulled automatically
- **Real PDF text extraction** — reads the actual content of lecture slides and readings, not just filenames
- **Cross-course AI Q&A** — ask about any class without picking one from a dropdown first; the AI automatically figures out which course(s) and files are relevant
- **Persistent chat** — runs as a Chrome side panel, stays open while you browse, remembers your conversation across sessions
- **Grounded answers only** — never guesses at due dates, grades, or policies; says plainly when something isn't in the indexed data, and cites its source
- **Bring your own API key** — each user supplies their own Claude API key; no shared backend, no cost or data liability for anyone but the person using it
- **Works at any Canvas-based school** — not hardcoded to one university

## How it works (technical overview)

- **No backend server.** The extension calls the Canvas API directly (using your session cookie, not a personal token) and the Claude API directly, both from the browser.
- **Real tool-calling.** Instead of dumping every file's content into every request, the AI receives a lightweight summary across all your courses and can request a specific file's or assignment's full content on demand, only when it actually needs it.
- **Prompt caching.** Repeated context (the course summary, system instructions) within a session is cached, cutting the cost of follow-up questions by roughly 90%.
- **PDF extraction runs in an offscreen document** — a Manifest V3 constraint (service workers can't spawn real workers) worked around using Chrome's offscreen document API alongside pdf.js.

## Install

**Chrome Web Store (recommended):**
[Install Canvas AI Assistant](https://chromewebstore.google.com/detail/hnebmaenjbmhjjdhmhdidgamekemaihb)

**From source (for developers, or to inspect the code first):** see Setup below.

> New installs may briefly show a Chrome "not trusted by Enhanced Safe Browsing" warning — this is expected for any newly published extension and resolves automatically over time as the listing builds trust with Google. It's unrelated to what the extension actually does.

## Setup

1. Clone this repository
2. Go to `chrome://extensions`, enable **Developer mode** (top right)
3. Click **Load unpacked**, select the cloned folder
4. Click the extension icon to open the side panel
5. Get a Claude API key at [platform.claude.com](https://platform.claude.com) (Settings → API keys)
6. Enter your **Claude API key** and your **school's Canvas URL** (e.g. `yourschool.instructure.com`) in the settings screen
7. Visit your Canvas dashboard once to let it index your courses, then start asking questions

## Known limitations

- Only PDF files are text-extracted; PPTX/DOCX files are indexed by name only, not content
- Canvas "Pages" (wiki-style content some instructors use, separate from the syllabus) aren't indexed yet
- Schools running Canvas on a fully custom domain (not `*.instructure.com`) aren't currently supported

## License

MIT