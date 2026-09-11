# Privacy Policy — Canvas AI Assistant

**Last updated: September 11, 2026**

Canvas AI Assistant is a Chrome extension that helps students ask questions about their Canvas courses. This policy explains what data the extension handles and how.

## What data is stored

The extension stores the following, locally on your own device, using Chrome's built-in extension storage:

- **Your Claude API key** — entered by you in the extension's settings, used only to authenticate your requests to Anthropic's Claude API.
- **Your school's Canvas URL** — entered by you in settings, used to know which Canvas instance to contact.
- **Indexed course data** — assignment names, due dates, points, file names, extracted text from your course PDFs, and syllabus content, pulled directly from your own Canvas account.
- **Chat history** — the questions you ask and the answers you receive, so your conversation persists when you reopen the extension.

## Where this data goes

- **Nothing is sent to the developer of this extension, or to any server operated by the developer.** There is no backend server as part of this extension.
- Data is sent only to two places, both directly from your own browser:
  1. **Your school's Canvas instance** (`*.instructure.com`), to read your own course data using your existing logged-in Canvas session — no separate login or token is used.
  2. **Anthropic's Claude API** (`api.anthropic.com`), to answer your questions, using the API key you provided.
- Your data is never sold, shared with third parties, or used for advertising.

## Your control over this data

- All stored data can be cleared at any time: use the "Clear conversation" button to remove chat history, or remove the extension entirely to clear all stored data, including your API key and Canvas URL.
- You can revoke your Claude API key at any time from your Anthropic account (platform.claude.com), which immediately stops the extension from being able to make requests.

## Third-party services

This extension relies on two third-party services, each governed by their own privacy policies:
- **Canvas / Instructure** — see your school's Canvas privacy policy
- **Anthropic** — see [Anthropic's Privacy Policy](https://www.anthropic.com/legal/privacy)

## Changes to this policy

If this policy changes, the updated version will be posted at this same URL, with the "Last updated" date revised.

## Contact

This is an open-source, independently developed project. For questions or to report an issue, please open an issue on the GitHub repository: https://github.com/LukaGabr/canvas-ai-assistant