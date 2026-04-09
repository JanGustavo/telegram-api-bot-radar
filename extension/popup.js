function openLogin() {
  chrome.tabs.create({
    url: chrome.runtime.getURL("login.html"),
  });
}

function openPanel() {
  chrome.tabs.create({
    url: chrome.runtime.getURL("dashboard.html"),
  });
}

document.getElementById("openLogin").addEventListener("click", openLogin);
document.getElementById("openPanel").addEventListener("click", openPanel);
