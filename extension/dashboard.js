const API_BASE_URL = "http://localhost:8000";
const BLACKLIST_KEY = "groupNameBlacklist";
const AUTH_KEY = "telegramAuth";

let allGroups = [];
let blacklistTerms = [];

function normalizeText(value) {
  return (value || "").toString().trim().toLowerCase();
}

function getGroupTitle(group) {
  if (typeof group === "string") {
    return group;
  }
  return group?.title || group?.username || `Grupo ${group?.id || "sem nome"}`;
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function saveBlacklist() {
  return new Promise((resolve) => {
    if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
      chrome.storage.local.set({ [BLACKLIST_KEY]: blacklistTerms }, () => resolve());
    } else {
      localStorage.setItem(BLACKLIST_KEY, JSON.stringify(blacklistTerms));
      resolve();
    }
  });
}

function clearAuthSession() {
  return new Promise((resolve) => {
    if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
      chrome.storage.local.remove([AUTH_KEY], () => resolve());
      return;
    }

    localStorage.removeItem(AUTH_KEY);
    resolve();
  });
}

function openLogin() {
  window.location.href = chrome.runtime.getURL("login.html");
}

function loadBlacklist() {
  return new Promise((resolve) => {
    if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get([BLACKLIST_KEY], (result) => {
        const stored = result?.[BLACKLIST_KEY];
        resolve(Array.isArray(stored) ? stored : []);
      });
    } else {
      const stored = localStorage.getItem(BLACKLIST_KEY);
      resolve(stored ? JSON.parse(stored) : []);
    }
  });
}

function isBlacklisted(groupTitle) {
  const normalizedTitle = normalizeText(groupTitle);
  return blacklistTerms.some((term) => normalizedTitle.includes(term));
}

function renderBlacklistTags() {
  const tagsNode = document.getElementById("blacklistTags");

  if (blacklistTerms.length === 0) {
    tagsNode.innerHTML = '<p style="font-size: 12px; color: var(--text-muted); margin-top: 8px;">Nenhum termo bloqueado.</p>';
    return;
  }

  let html = "";
  blacklistTerms.forEach((term, index) => {
    html += `
      <span class="blacklist-tag">
        <span>${escapeHtml(term)}</span>
        <button type="button" data-index="${index}" aria-label="Remover termo">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
        </button>
      </span>`;
  });

  tagsNode.innerHTML = html;
}

function renderGroups() {
  const groupsNode = document.getElementById("groups");

  const visibleGroups = allGroups.filter((group) => {
    const title = getGroupTitle(group);
    return !isBlacklisted(title);
  });

  if (visibleGroups.length === 0) {
    groupsNode.innerHTML = '<div class="empty-state">Nenhum grupo encontrado ou todos foram filtrados.</div>';
    return;
  }

  let html = "";
  visibleGroups.forEach((group) => {
    const title = getGroupTitle(group);
    html += `
      <div class="group-item">
        <div class="group-info">
          <div class="group-avatar">${title.charAt(0).toUpperCase()}</div>
          <span class="group-name">${escapeHtml(title)}</span>
        </div>
        <label class="switch">
          <input type="checkbox" checked aria-label="Selecionar grupo ${escapeHtml(title)}">
          <span class="slider"></span>
        </label>
      </div>`;
  });

  groupsNode.innerHTML = html;
}

async function logout() {
  const logoutBtn = document.getElementById("logoutBtn");

  if (logoutBtn) {
    logoutBtn.disabled = true;
    logoutBtn.textContent = "Saindo...";
  }

  try {
    await fetch(`${API_BASE_URL}/logout`, { method: "POST" });
  } catch {
    // Se a API estiver fora, o logout local ainda deve acontecer.
  } finally {
    await clearAuthSession();
    openLogin();
  }
}

async function loadUser() {
  const userNode = document.getElementById("user");

  try {
    const response = await fetch(`${API_BASE_URL}/me`);
    const data = await response.json();

    if (data.logged) {
      userNode.innerHTML = `
        <div class="user-badge">
          <div class="status-dot online"></div>
          <span>${data.first_name || data.username || "Usuário"}</span>
        </div>`;
      return;
    }

    userNode.innerHTML = '<span class="status-text">Não autenticado</span>';
  } catch {
    userNode.innerHTML = '<span class="status-text error">Erro de conexão</span>';
  }
}

async function loadGroups() {
  const groupsNode = document.getElementById("groups");
  groupsNode.innerHTML = '<div class="loading-spinner"><div class="spinner"></div> Carregando grupos...</div>';

  try {
    const response = await fetch(`${API_BASE_URL}/groups`);

    if (!response.ok) {
      groupsNode.innerHTML = '<div class="error-state">Erro ao carregar grupos.</div>';
      return;
    }

    const data = await response.json();
    const groups = Array.isArray(data.groups) ? data.groups : [];

    allGroups = groups;
    renderGroups();
  } catch {
    groupsNode.innerHTML = '<div class="error-state">Falha ao conectar com a API.</div>';
  }
}

async function addBlacklistTerm() {
  const input = document.getElementById("blacklistInput");
  const term = normalizeText(input.value);

  if (!term) return;

  if (blacklistTerms.includes(term)) {
    input.value = "";
    return;
  }

  blacklistTerms.push(term);
  await saveBlacklist();
  renderBlacklistTags();
  renderGroups();
  input.value = "";
}

async function removeBlacklistTermAt(index) {
  blacklistTerms = blacklistTerms.filter((_, currentIndex) => currentIndex !== index);
  await saveBlacklist();
  renderBlacklistTags();
  renderGroups();
}

function startScanner() {
  const btn = document.getElementById("startScannerBtn");
  const isRunning = btn.classList.contains("running");
  
  if (isRunning) {
    btn.classList.remove("running");
    btn.innerHTML = 'Iniciar monitoramento';
    btn.style.background = 'var(--primary)';
  } else {
    btn.classList.add("running");
    btn.innerHTML = '<span class="spinner"></span> Monitorando...';
    btn.style.background = 'var(--success)';
  }
}

// Event Listeners
document.getElementById("addBlacklistBtn").addEventListener("click", addBlacklistTerm);
document.getElementById("blacklistInput").addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    addBlacklistTerm();
  }
});

document.getElementById("blacklistTags").addEventListener("click", (event) => {
  const button = event.target.closest('button');
  if (!button) return;

  const indexText = button.getAttribute("data-index");
  if (indexText === null) return;

  const index = Number(indexText);
  if (Number.isNaN(index)) return;

  removeBlacklistTermAt(index);
});

document.getElementById("startScannerBtn").addEventListener("click", startScanner);
document.getElementById("logoutBtn").addEventListener("click", logout);

// Inicialização
async function init() {
  blacklistTerms = await loadBlacklist();
  renderBlacklistTags();
  loadUser();
  loadGroups();
}



init();
