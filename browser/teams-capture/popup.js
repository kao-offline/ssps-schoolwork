import { capturePage } from './collector.js';
const status = document.getElementById('status');
const preview = document.getElementById('preview');
const download = document.getElementById('download');
let blobUrl;
document.getElementById('capture').addEventListener('click', async () => {
  download.hidden = true;
  preview.hidden = true;
  status.textContent = 'Capturing rendered text…';
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const [response] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: capturePage });
    if (!response?.result) throw new Error('Capture failed. Open a supported schoolwork page.');
    const capture = response.result;
    preview.value = capture.text;
    preview.hidden = false;
    if (blobUrl) URL.revokeObjectURL(blobUrl);
    blobUrl = URL.createObjectURL(new Blob([JSON.stringify(capture, null, 2)], { type: 'application/json' }));
    download.href = blobUrl;
    download.download = `teams-capture-${Date.now()}.json`;
    download.hidden = false;
    status.textContent = `${capture.text.length} characters. Review the preview, then download and import locally. ${capture.truncated ? 'Text limit reached.' : ''}`;
  } catch {
    status.textContent = 'Capture failed. Use a signed-in Teams, school SharePoint or OneNote page; sign-in/error pages are unsupported. Embedded frames may require opening the page directly.';
  }
});
