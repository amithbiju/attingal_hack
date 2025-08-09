document.addEventListener("DOMContentLoaded", () => {
  const geminiInput = document.getElementById("geminiApiKey");
  const hfInput = document.getElementById("hfApiKey");
  const visionInput = document.getElementById("googleVisionApiKey");
  const saveBtn = document.getElementById("saveBtn");
  const statusDiv = document.getElementById("status");

  // Load stored keys
  chrome.storage.sync.get(["geminiApiKey", "hfApiKey", "googleVisionApiKey"], (items) => {
    if (items.geminiApiKey) geminiInput.value = items.geminiApiKey;
    if (items.hfApiKey) hfInput.value = items.hfApiKey;
    if (items.googleVisionApiKey) visionInput.value = items.googleVisionApiKey;
  });

  saveBtn.addEventListener("click", () => {
    const geminiKey = geminiInput.value.trim();
    const hfKey = hfInput.value.trim();
    const visionKey = visionInput.value.trim();

    if (!geminiKey || !hfKey || !visionKey) {
      return showStatus("Please enter all API keys", "error");
    }

    chrome.storage.sync.set(
      {
        geminiApiKey: geminiKey,
        hfApiKey: hfKey,
        googleVisionApiKey: visionKey,
      },
      () => {
        showStatus("API keys saved successfully!", "success");
      }
    );
  });

  function showStatus(message, type) {
    statusDiv.textContent = message;
    statusDiv.className = `status ${type}`;
    statusDiv.style.display = "block";
    if (type === "success") setTimeout(() => (statusDiv.style.display = "none"), 3000);
  }
});
