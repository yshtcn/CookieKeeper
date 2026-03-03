// offscreen.js
// Runs in a hidden offscreen document so we can use URL.createObjectURL(),
// which is not available in MV3 service workers.
// Background sends DOWNLOAD_FILE messages here to trigger real Blob-URL downloads.

chrome.runtime.onMessage.addListener((msg, _sender, respond) => {
  if (msg.target !== 'offscreen' || msg.type !== 'DOWNLOAD_FILE') return false;

  const blob = new Blob([msg.content], { type: 'text/plain; charset=utf-8' });
  const blobUrl = URL.createObjectURL(blob);

  chrome.downloads.download(
    {
      url: blobUrl,
      filename: msg.filename,       // e.g. "CookieKeeper/youtube_com_cookies.txt"
      saveAs: false,
      conflictAction: 'overwrite',
    },
    (downloadId) => {
      const err = chrome.runtime.lastError;
      // Revoke after Chrome has started reading the blob (generous timeout)
      setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
      respond({ success: !err, downloadId, error: err?.message });
    }
  );

  return true; // keep message channel open for async callback
});
