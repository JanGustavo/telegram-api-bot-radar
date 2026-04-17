function openTab(page) {
  if (typeof chrome !== "undefined" && chrome.tabs && chrome.tabs.create) {
    chrome.tabs.create({
      url: chrome.runtime.getURL(page),
    });
  } else {
    window.open(page, '_blank');
  }
}

function getAuthSession() {
  return new Promise((resolve) => {
    if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get(["telegramAuth"], (result) => {
        resolve(result?.telegramAuth || null);
      });
    } else {
      const stored = localStorage.getItem('telegramAuth');
      resolve(stored ? JSON.parse(stored) : null);
    }
  });
}

async function openPanel() {
  const btn = document.getElementById("openPanel");
  const originalText = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Abrindo...';

  try {
    const authSession = await getAuthSession();

    if (authSession?.logged) {
      openTab("dashboard.html");
    } else {
      openTab("login.html");
    }
  } catch (error) {
    console.error("Erro ao abrir painel:", error);
  } finally {
    setTimeout(() => {
      btn.disabled = false;
      btn.innerHTML = originalText;
    }, 500);
  }
}

document.getElementById("openPanel").addEventListener("click", openPanel);
