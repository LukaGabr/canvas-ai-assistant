import * as pdfjsLib from "./libs/pdfjs/pdf.mjs";
pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL("libs/pdfjs/pdf.worker.mjs");

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type !== "EXTRACT_PDF_TEXT") return;

  extractPdfText(message.fileUrl)
    .then(text => sendResponse({ success: true, text }))
    .catch(err => sendResponse({ success: false, error: err.message }));

  return true; // keep the message channel open for the async response
});

async function extractPdfText(fileUrl) {
  const response = await fetch(fileUrl, { credentials: "include" });
  const arrayBuffer = await response.arrayBuffer();

  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  let fullText = "";

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const content = await page.getTextContent();
    const pageText = content.items.map(item => item.str).join(" ");
    fullText += `\n\n--- Page ${pageNum} ---\n${pageText}`;
  }

  return fullText;
}