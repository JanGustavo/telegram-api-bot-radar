const API_BASE_URL = "http://localhost:8000";
const STORAGE_KEY = "radarConfig";

// ---------------------------------------------------------------------------
// Estado global
// ---------------------------------------------------------------------------
let allGroups = [];
let monitoringActive = false;
let lastAlertId = null;

const state = {
  // Grupos selecionados manualmente (toggle)
  selectedGroupIds: new Set(),
  // Nível de monitoramento
  level: "broad",
  // Filtros por nível
  specific_models: [],
  mid_brands: [],
  broad_keywords: [],
  price_max: null,
};

// ---------------------------------------------------------------------------
// Storage helpers (chrome.storage ou localStorage)
// ---------------------------------------------------------------------------
function storageSet(data) {
  return new Promise((resolve) => {
    if (typeof chrome !== "undefined" && chrome.storage?.local) {
      chrome.storage.local.set({ [STORAGE_KEY]: data }, resolve);
    } else {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      resolve();
    }
  });
}

function storageGet() {
  return new Promise((resolve) => {
    if (typeof chrome !== "undefined" && chrome.storage?.local) {
      chrome.storage.local.get([STORAGE_KEY], (result) => resolve(result?.[STORAGE_KEY] || {}));
    } else {
      try {
        resolve(JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}"));
      } catch {
        resolve({});
      }
    }
  });
}

function clearAuthSession() {
  return new Promise((resolve) => {
    if (typeof chrome !== "undefined" && chrome.storage?.local) {
      chrome.storage.local.remove(["telegramAuth"], resolve);
    } else {
      localStorage.removeItem("telegramAuth");
      resolve();
    }
  });
}

async function saveState() {
  await storageSet({
    level: state.level,
    specific_models: state.specific_models,
    mid_brands: state.mid_brands,
    broad_keywords: state.broad_keywords,
    price_max: state.price_max,
    selectedGroupIds: [...state.selectedGroupIds],
  });
}

async function loadState() {
  const saved = await storageGet();
  if (saved.level) state.level = saved.level;
  if (Array.isArray(saved.specific_models)) state.specific_models = saved.specific_models;
  if (Array.isArray(saved.mid_brands)) state.mid_brands = saved.mid_brands;
  if (Array.isArray(saved.broad_keywords)) state.broad_keywords = saved.broad_keywords;
  if (saved.price_max !== undefined) state.price_max = saved.price_max;
  if (Array.isArray(saved.selectedGroupIds)) {
    state.selectedGroupIds = new Set(saved.selectedGroupIds);
  }
}

// ---------------------------------------------------------------------------
// Utilitários
// ---------------------------------------------------------------------------
function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function normalizeText(value) {
  return String(value ?? "").trim().toLowerCase();
}

function openLogin() {
  if (typeof chrome !== "undefined" && chrome.runtime?.getURL) {
    window.location.href = chrome.runtime.getURL("login.html");
  } else {
    window.location.href = "login.html";
  }
}

// ---------------------------------------------------------------------------
// Renderizar grupos (com filtro automático visual)
// ---------------------------------------------------------------------------
function renderGroups() {
  const node = document.getElementById("groups");
  const showFiltered = document.getElementById("showFilteredToggle")?.checked;

  let visible = allGroups.filter((g) => {
    if (!showFiltered && g.auto_filtered) return false;
    return true;
  });

  if (visible.length === 0) {
    node.innerHTML = '<div class="empty-state">Nenhum grupo encontrado.</div>';
    return;
  }

  const totalFiltered = allGroups.filter((g) => g.auto_filtered).length;
  const banner =
    totalFiltered > 0
      ? `<div class="filter-banner">
          🛡️ <strong>${totalFiltered}</strong> grupo(s) bloqueado(s) automaticamente (bots/spam/crypto)
          <label class="show-filtered-label">
            <input type="checkbox" id="showFilteredToggle" ${showFiltered ? "checked" : ""} />
            mostrar mesmo assim
          </label>
        </div>`
      : "";

  let html = banner;
  for (const group of visible) {
    const isSelected = state.selectedGroupIds.has(group.id);
    const filtered = group.auto_filtered;
    html += `
      <div class="group-item ${filtered ? "group-filtered" : ""}">
        <div class="group-info">
          <div class="group-avatar ${filtered ? "avatar-filtered" : ""}">
            ${filtered ? "🚫" : escapeHtml(group.title.charAt(0).toUpperCase())}
          </div>
          <div>
            ${
              group.link
                ? `<a href="${group.link}" target="_blank" class="group-name link">
                     ${escapeHtml(group.title)}
                   </a>`
                : `<span class="group-name">
                     ${escapeHtml(group.title)}
                   </span>`
            }            ${filtered ? '<span class="filter-badge">auto-filtrado</span>' : ""}
          </div>
        </div>
        <label class="switch ${filtered ? "switch-disabled" : ""}">
          <input type="checkbox"
            ${isSelected && !filtered ? "checked" : ""}
            ${filtered ? "disabled" : ""}
            data-group-id="${group.id}"
            aria-label="Selecionar ${escapeHtml(group.title)}"
          />
          <span class="slider"></span>
        </label>
      </div>`;
  }

  node.innerHTML = html;

  // Re-bind toggle "mostrar filtrados"
  const showToggle = document.getElementById("showFilteredToggle");
  if (showToggle) {
    showToggle.addEventListener("change", renderGroups);
  }

  // Bind nos switches de grupo
  node.querySelectorAll("input[data-group-id]").forEach((checkbox) => {
    checkbox.addEventListener("change", (e) => {
      const id = parseInt(e.target.getAttribute("data-group-id"));
      if (e.target.checked) {
        state.selectedGroupIds.add(id);
      } else {
        state.selectedGroupIds.delete(id);
      }
      saveState();
    });
  });
}

// ---------------------------------------------------------------------------
// Renderizar painel de níveis
// ---------------------------------------------------------------------------
function renderLevelPanel() {
  const levelBtns = document.querySelectorAll(".level-btn");
  levelBtns.forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.level === state.level);
  });

  // Esconder/mostrar painéis de configuração por nível
  document.getElementById("panel-broad").style.display =
    state.level === "broad" ? "block" : "none";
  document.getElementById("panel-mid").style.display =
    state.level === "mid" ? "block" : "none";
  document.getElementById("panel-specific").style.display =
    state.level === "specific" ? "block" : "none";

  // Preencher campos com valores do state
  document.getElementById("broadKeywordsInput").value = state.broad_keywords.join(", ");
  document.getElementById("midBrandsInput").value = state.mid_brands.join(", ");
  document.getElementById("specificModelsInput").value = state.specific_models.join("\n");
  document.getElementById("priceMaxInput").value = state.price_max ?? "";
}

// ---------------------------------------------------------------------------
// Testar oferta em tempo real
// ---------------------------------------------------------------------------
async function testOfferText() {
  const text = document.getElementById("offerTestInput").value.trim();
  const resultNode = document.getElementById("offerTestResult");

  if (!text) {
    resultNode.textContent = "";
    return;
  }

  try {
    const res = await fetch(`${API_BASE_URL}/offers/test`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    const data = await res.json();

    const icon = data.would_alert ? "✅" : "❌";
    const categories = data.offer_categories?.join(", ") || "nenhuma";
    const price = data.extracted_price ? `R$ ${data.extracted_price.toLocaleString("pt-BR")}` : "—";

    resultNode.innerHTML = `
      <span class="${data.would_alert ? "test-pass" : "test-fail"}">
        ${icon} ${data.would_alert ? "Seria capturado" : "Não seria capturado"}
      </span>
      <span class="test-meta">
        Score: ${data.offer_score}/5 · Categorias: ${categories} · Preço: ${price}
      </span>`;
  } catch {
    resultNode.textContent = "Erro ao conectar com a API.";
  }
}

// ---------------------------------------------------------------------------
// Sincronizar config com o backend
// ---------------------------------------------------------------------------
async function pushConfigToApi() {
  try {
    await fetch(`${API_BASE_URL}/watch/config`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        level: state.level,
        specific_models: state.specific_models,
        mid_brands: state.mid_brands,
        broad_keywords: state.broad_keywords,
        price_max: state.price_max,
      }),
    });
  } catch {
    // API offline — config foi salva localmente, vai sincronizar ao iniciar
  }
}

// ---------------------------------------------------------------------------
// Colher valores dos inputs do painel de nível
// ---------------------------------------------------------------------------
function collectLevelInputs() {
  state.broad_keywords = document
    .getElementById("broadKeywordsInput")
    .value.split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  state.mid_brands = document
    .getElementById("midBrandsInput")
    .value.split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  state.specific_models = document
    .getElementById("specificModelsInput")
    .value.split("\n")
    .map((s) => s.trim())
    .filter(Boolean);

  const priceRaw = document.getElementById("priceMaxInput").value.replace(",", ".");
  state.price_max = priceRaw ? parseFloat(priceRaw) : null;
}

// ---------------------------------------------------------------------------
// Iniciar / Parar monitoramento
// ---------------------------------------------------------------------------
async function toggleScanner() {
  const btn = document.getElementById("startScannerBtn");

  if (monitoringActive) {
    // PARAR
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Parando...';
    try {
      await fetch(`${API_BASE_URL}/watch/stop`, { method: "POST" });
    } catch {}
    monitoringActive = false;
    setScannerState(false);
    btn.disabled = false;
    return;
  }

  // INICIAR
  collectLevelInputs();
  await saveState();
  await pushConfigToApi();

  const groupIds = [...state.selectedGroupIds];
  if (groupIds.length === 0) {
    showToast("Selecione ao menos um grupo para monitorar.", "warning");
    return;
  }

  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Iniciando...';

  try {
    const res = await fetch(`${API_BASE_URL}/watch/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ group_ids: groupIds }),
    });
    if (!res.ok) throw new Error();
    monitoringActive = true;
    setScannerState(true);
  } catch {
    showToast("Erro ao iniciar monitoramento. API está rodando?", "error");
  } finally {
    btn.disabled = false;
  }
}

function setScannerState(active) {
  const btn = document.getElementById("startScannerBtn");
  if (active) {
    btn.classList.add("running");
    btn.style.background = "var(--success)";
    btn.innerHTML = `
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
      Monitorando — Clique para parar`;
  } else {
    btn.classList.remove("running");
    btn.style.background = "var(--primary)";
    btn.innerHTML = `
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="4" fill="currentColor"/></svg>
      Iniciar monitoramento`;
  }
}

// ---------------------------------------------------------------------------
// Alertas (polling simples a cada 10s quando monitorando)
// ---------------------------------------------------------------------------
let alertsPollingInterval = null;

function startAlertsPolling() {
  clearInterval(alertsPollingInterval);
  alertsPollingInterval = setInterval(loadAlerts, 10_000);
}

function stopAlertsPolling() {
  clearInterval(alertsPollingInterval);
}

async function loadAlerts() {
  const node = document.getElementById("alertsList");
  if (!node) return;

  try {
    const res = await fetch(`${API_BASE_URL}/alerts?limit=30`);
    const data = await res.json();
    const alerts = Array.isArray(data.alerts) ? data.alerts : [];

    if (alerts.length === 0) {
      node.innerHTML = '<div class="empty-state">Nenhum alerta ainda.</div>';
      return;
    }



    // Mais recentes primeiro
    const sorted = [...alerts].reverse();
    const latest = sorted[0];
        if(latest && latest.message_id !== lastAlertId){
      notify(latest);
      lastAlertId = latest.message_id;
    }

    node.innerHTML = sorted
      .map((a) => {
        const cats = (a.offer_categories || []).join(" · ");
        const price = a.extracted_price
          ? `R$ ${Number(a.extracted_price).toLocaleString("pt-BR")}`
          : "";
        return `
        <div class="alert-item">
          <div class="alert-header">
           ${
              a.link
                ? `<a href="${a.link}" target="_blank" class="alert-group-link">
                  🔗 ${escapeHtml(a.group_title || a.group_id)}
            </a>`
               : `<span class="alert-group">
         ${escapeHtml(a.group_title || a.group_id)}
       </span>`
}
            ${price ? `<span class="alert-price">${price}</span>` : ""}
          </div>
          <p class="alert-text">${escapeHtml((a.message || "").slice(0, 200))}</p>
          <div class="alert-meta">
            <span>Score ${a.offer_score}/5</span>
            ${cats ? `<span>${cats}</span>` : ""}
            ${a.timestamp ? `<span>${new Date(a.timestamp).toLocaleTimeString("pt-BR")}</span>` : ""}
          </div>
        </div>`;
      })
      .join("");
  } catch {}
}

// ---------------------------------------------------------------------------
// Toast
// ---------------------------------------------------------------------------
function showToast(msg, type = "info") {
  const existing = document.getElementById("toast");
  if (existing) existing.remove();

  const toast = document.createElement("div");
  toast.id = "toast";
  toast.className = `toast toast-${type}`;
  toast.textContent = msg;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3500);
}

// ---------------------------------------------------------------------------
// Usuário / Logout
// ---------------------------------------------------------------------------
async function loadUser() {
  const userNode = document.getElementById("user");
  try {
    const res = await fetch(`${API_BASE_URL}/me`);
    const data = await res.json();
    if (data.logged) {
      userNode.innerHTML = `
        <div class="user-badge">
          <div class="status-dot online"></div>
          <span>${data.first_name || data.username || "Usuário"}</span>
        </div>`;
    } else {
      userNode.innerHTML = '<span class="status-text">Não autenticado</span>';
    }
  } catch {
    userNode.innerHTML = '<span class="status-text error">Erro de conexão</span>';
  }
}

async function logout() {
  const btn = document.getElementById("logoutBtn");
  if (btn) { btn.disabled = true; btn.textContent = "Saindo..."; }
  try { await fetch(`${API_BASE_URL}/logout`, { method: "POST" }); } catch {}
  await clearAuthSession();
  openLogin();
}

async function loadGroups() {
  const node = document.getElementById("groups");
  node.innerHTML = '<div class="loading-spinner"><div class="spinner"></div> Carregando grupos...</div>';
  try {
    const res = await fetch(`${API_BASE_URL}/groups`);
    if (!res.ok) throw new Error();
    const data = await res.json();
    allGroups = Array.isArray(data.groups) ? data.groups : [];

    // Selecionar automaticamente os grupos não filtrados
    allGroups.forEach((g) => {
      if (!g.auto_filtered && !state.selectedGroupIds.has(g.id)) {
        state.selectedGroupIds.add(g.id);
      }
    });

    renderGroups();
  } catch {
    node.innerHTML = '<div class="error-state">Falha ao conectar com a API.</div>';
  }
}

// ---------------------------------------------------------------------------
// Event bindings
// ---------------------------------------------------------------------------
function bindEvents() {
  // Nível
  document.querySelectorAll(".level-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.level = btn.dataset.level;
      renderLevelPanel();
      saveState();
    });
  });

  // Inputs de nível — auto-save ao desfocar
  ["broadKeywordsInput", "midBrandsInput", "specificModelsInput", "priceMaxInput"].forEach((id) => {
    document.getElementById(id)?.addEventListener("blur", async () => {
      collectLevelInputs();
      await saveState();
    });
  });

  // Botão principal
  document.getElementById("startScannerBtn").addEventListener("click", () => {
    toggleScanner().then(() => {
      if (monitoringActive) {
        startAlertsPolling();
        loadAlerts();
      } else {
        stopAlertsPolling();
      }
    });
  });

  // Logout
  document.getElementById("logoutBtn").addEventListener("click", logout);

  // Teste de oferta
  const testInput = document.getElementById("offerTestInput");
  let debounce;
  testInput?.addEventListener("input", () => {
    clearTimeout(debounce);
    debounce = setTimeout(testOfferText, 600);
  });

  // Limpar alertas
  document.getElementById("clearAlertsBtn")?.addEventListener("click", async () => {
    await fetch(`${API_BASE_URL}/alerts`, { method: "DELETE" });
    loadAlerts();
  });
}

function notify(alert){
  if(Notification.permission === "granted"){
    const n = new Notification(`🚨 ${alert.group_title}`, {
      body: alert.message.slice(0, 120),
    });

    if(alert.link){
      n.onclick = () => {
        window.open(alert.link, "_blank");
      };
    }
  }
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------
async function init() {
  await loadState();
  renderLevelPanel();
  loadUser();
  loadGroups();
  bindEvents();
  loadAlerts();
  if ("Notification" in window && Notification.permission !== "granted") {
  Notification.requestPermission();
}
}

init();