// Popup script for Eco Product Finder
document.addEventListener("DOMContentLoaded", function () {
  const apiKeyInput = document.getElementById("apiKey");
  const saveBtn = document.getElementById("saveBtn");
  const statusDiv = document.getElementById("status");

  // Load existing API key
  chrome.runtime.sendMessage({ action: "getApiKey" }, (response) => {
    if (response.apiKey) {
      apiKeyInput.value = response.apiKey;
      showStatus("API key loaded successfully", "success");
    }
  });

  // Save API key
  saveBtn.addEventListener("click", function () {
    const apiKey = apiKeyInput.value.trim();

    if (!apiKey) {
      showStatus("Please enter a valid API key", "error");
      return;
    }

    // Validate API key format (basic check)
    if (!apiKey.startsWith("AIza") || apiKey.length < 20) {
      showStatus("Invalid API key format. Please check your key.", "error");
      return;
    }

    saveBtn.disabled = true;
    saveBtn.textContent = "Saving...";

    chrome.runtime.sendMessage(
      {
        action: "saveApiKey",
        apiKey: apiKey,
      },
      (response) => {
        saveBtn.disabled = false;
        saveBtn.textContent = "Save API Key";

        if (response.success) {
          showStatus("API key saved successfully!", "success");
        } else {
          showStatus("Failed to save API key", "error");
        }
      }
    );
  });

  // Handle Enter key in API key input
  apiKeyInput.addEventListener("keypress", function (e) {
    if (e.key === "Enter") {
      saveBtn.click();
    }
  });

  function showStatus(message, type) {
    statusDiv.textContent = message;
    statusDiv.className = `status ${type}`;
    statusDiv.style.display = "block";

    // Hide status after 3 seconds for success messages
    if (type === "success") {
      setTimeout(() => {
        statusDiv.style.display = "none";
      }, 3000);
    }
  }
});
