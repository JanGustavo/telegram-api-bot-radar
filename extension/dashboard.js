const API_BASE_URL = "http://localhost:8000";
const BLACKLIST_KEY = "groupNameBlacklist";

let allGroups = [];
let blacklistTerms = [];

function normalizeText(value) {
  return (value || "").toString().trim().toLowerCase();
}

function getGroupTitle(group) {
  if (typeof group === "string") {
    return group;
  }
  return group?.title || group?.username || `grupo ${group?.id || "sem nome"}`;
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
    if (typeof chrome === "undefined" || !chrome.storage || !chrome.storage.local) {
      resolve();
      return;
    }

    chrome.storage.local.set({ [BLACKLIST_KEY]: blacklistTerms }, () => resolve());
  });
}

function loadBlacklist() {
  return new Promise((resolve) => {
    if (typeof chrome === "undefined" || !chrome.storage || !chrome.storage.local) {
      resolve([]);
      return;
    }

    chrome.storage.local.get([BLACKLIST_KEY], (result) => {
      const stored = result?.[BLACKLIST_KEY];
      resolve(Array.isArray(stored) ? stored : []);
    });
  });
}

function isBlacklisted(groupTitle) {
  const normalizedTitle = normalizeText(groupTitle);
  return blacklistTerms.some((term) => normalizedTitle.includes(term));
}

function renderBlacklistTags() {
  const tagsNode = document.getElementById("blacklistTags");

  if (blacklistTerms.length === 0) {
    tagsNode.innerHTML = "";
    return;
  }

  let html = "";

  blacklistTerms.forEach((term, index) => {
    html += `
<span class="blacklist-tag">
  <span>${escapeHtml(term)}</span>
  <button type="button" data-index="${index}" aria-label="Remover termo">x</button>
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
    groupsNode.innerHTML = '<div class="group"><span class="group-name">nenhum grupo encontrado</span></div>';
    return;
  }

  let html = "";

  visibleGroups.forEach((group) => {
    const title = getGroupTitle(group);
    html += `
<div class="group">
  <span class="group-name">${escapeHtml(title)}</span>
  <input type="checkbox" aria-label="Selecionar grupo ${escapeHtml(title)}">
</div>`;
  });

  groupsNode.innerHTML = html;
}

async function loadUser() {
  const userNode = document.getElementById("user");

  try {
    const response = await fetch(`${API_BASE_URL}/me`);
    const data = await response.json();

    if (data.logged) {
      userNode.innerText = `conectado como ${data.first_name || data.username || "usuario"}`;
      return;
    }

    userNode.innerText = "nao autenticado";
  } catch {
    userNode.innerText = "falha ao conectar com a API";
  }
}

async function loadGroups() {
  const groupsNode = document.getElementById("groups");

  try {
    const response = await fetch(`${API_BASE_URL}/groups`);

    if (!response.ok) {
      groupsNode.innerText = "erro ao carregar grupos";
      return;
    }

    const data = await response.json();
    const groups = Array.isArray(data.groups) ? data.groups : [];

    allGroups = groups;
    renderGroups();
  } catch {
    groupsNode.innerText = "falha ao conectar com a API";
  }
}

async function addBlacklistTerm() {
  const input = document.getElementById("blacklistInput");
  const term = normalizeText(input.value);

  if (!term) {
    return;
  }

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
  alert("monitoramento iniciado");
}

document.getElementById("addBlacklistBtn").addEventListener("click", addBlacklistTerm);
document.getElementById("blacklistInput").addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    addBlacklistTerm();
  }
});
document.getElementById("blacklistTags").addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) {
    return;
  }

  const indexText = target.getAttribute("data-index");
  if (indexText === null) {
    return;
  }

  const index = Number(indexText);
  if (Number.isNaN(index)) {
    return;
  }

  removeBlacklistTermAt(index);
});
document.getElementById("startScannerBtn").addEventListener("click", startScanner);

async function init() {
  blacklistTerms = await loadBlacklist();
  renderBlacklistTags();
  loadUser();
  loadGroups();
}

init();
