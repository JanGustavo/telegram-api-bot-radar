function openTab(page) {
  chrome.tabs.create({
    url: chrome.runtime.getURL(page),
  });
}

function getAuthSession() {
  return new Promise((resolve) => {
    if (typeof chrome === "undefined" || !chrome.storage || !chrome.storage.local) {
      resolve(null);
      return;
    }

    chrome.storage.local.get(["telegramAuth"], (result) => {
      resolve(result?.telegramAuth || null);
    });
  });
}

async function openPanel() {
  const authSession = await getAuthSession();

  if (authSession?.logged) {
    openTab("dashboard.html");
    return;
  }

  openTab("login.html");
}

document.getElementById("openPanel").addEventListener("click", openPanel);
