const API_BASE_URL = "https://jangustavo.me/apis/promopulse";
const STORAGE_KEY = "radarConfig";

// ---------------------------------------------------------------------------
// Estado global
// ---------------------------------------------------------------------------
let allGroups = [];
let monitoringActive = false;
let lastAlertId = null;

const state = {
  selectedGroupIds: new Set(),
  broad_categories: new Set(["celulares"]), // Memória do painel Amplo
  mid_categories: new Set(), // Memória do painel Marcas
  current_tab: "broad",
  active_levels: new Set(["broad"]), // Níveis ativos (pode ser "broad", "mid", "specific")
  mid_selected_brands: new Set(),
  specific_models: [],
  mid_brands: [],
  broad_keywords: [],
  price_max: null,
};

// Dicionário Inteligente de Marcas
const BRANDS_MAP = {
  celulares: ["Apple", "Samsung", "Xiaomi", "Motorola", "Poco", "Realme", "Asus"],
  tvs: ["Samsung", "LG", "TCL", "Philips", "AOC", "Philco"],
  audio: ["JBL", "Sony", "Edifier", "Apple", "Samsung", "Sennheiser", "QCY"],
  higiene: ["Dove", "L'Oréal", "Nivea", "Rexona", "Gillette", "Pampers"],
  informatica: ["Dell", "Lenovo", "Acer", "Asus", "Apple", "Avell", "Logitech"],
  casa: ["Mondial", "Electrolux", "Philco", "Oster", "Midea", "Arno"],
  moda: ["Nike", "Adidas", "Puma", "Hering", "Lupo", "Vans", "Reserva", "Olimpikus"],
  games: ["PlayStation", "Xbox", "Nintendo", "Sony", "Microsoft", "Asus", "Gigabyte"],
  esportes: ["Nike", "Adidas", "Puma", "Under Armour", "Asics", "Mizuno", "Penalty"],
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
    active_levels: [...state.active_levels],
    broad_categories: [...state.broad_categories],
    mid_categories: [...state.mid_categories],
    mid_selected_brands: [...state.mid_selected_brands],
    specific_models: state.specific_models,
    mid_brands: state.mid_brands,
    broad_keywords: state.broad_keywords,
    price_max: state.price_max,
    selectedGroupIds: [...state.selectedGroupIds],
  });
}

async function loadState() {
  const saved = await storageGet();
  
  if (saved.active_levels) state.active_levels = new Set(saved.active_levels);
  
  // Transforma os arrays salvos de volta em Set (memória isolada)
  if (saved.broad_categories) state.broad_categories = new Set(saved.broad_categories);
  if (saved.mid_categories) state.mid_categories = new Set(saved.mid_categories);
  if (saved.mid_selected_brands) state.mid_selected_brands = new Set(saved.mid_selected_brands);

  if (saved.specific_models) state.specific_models = saved.specific_models;
  if (saved.mid_brands) state.mid_brands = saved.mid_brands;
  if (saved.broad_keywords) state.broad_keywords = saved.broad_keywords;
  if (saved.price_max) state.price_max = saved.price_max;
  if (saved.selectedGroupIds) state.selectedGroupIds = new Set(saved.selectedGroupIds);
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
            <div class="filter-banner-content">
              <div class="filter-icon">🛡️</div>
              <div class="filter-text">
                <span class="filter-title"><strong>${totalFiltered}</strong> grupos bloqueados</span>
                <span class="filter-desc">Filtro anti-spam/crypto ativado</span>
              </div>
            </div>
            <label class="show-filtered-label">
              <input type="checkbox" id="showFilteredToggle" ${showFiltered ? "checked" : ""} />
              <span class="custom-checkbox"></span>
              Mostrar grupos ocultos
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
        active_levels: [...state.active_levels],
        broad_categories: [...state.broad_categories],
        specific_models: state.specific_models,
        mid_brands: [...state.mid_selected_brands, ...state.mid_brands],
        broad_keywords: state.broad_keywords,
        price_max: state.price_max,
      }),
    });
  } catch {
    // API offline
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
    
    // Se a API recusar o acesso (Não Autorizado), a sessão expirou ou é inválida
    if (res.status === 401) {
      await clearAuthSession(); // Limpa dados velhos
      openLogin(); // Expulsa para o login
      return false; 
    }

    const data = await res.json();
    if (data.logged || data.first_name || data.username) {
      userNode.innerHTML = `
        <div class="user-badge">
          <div class="status-dot online"></div>
          <span>${data.first_name || data.username || "Usuário"}</span>
        </div>`;
      return true;
    } else {
      // API respondeu 200, mas disse que não está logado
      await clearAuthSession();
      openLogin();
      return false;
    }
  } catch {
    // Erro de rede (API offline). Permite ver o dashboard, mas avisa.
    userNode.innerHTML = '<span class="status-text error">API Offline</span>';
    return true; 
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

function renderMidBrands() {
  const container = document.getElementById("dynamicBrandSelect");
  if (!container) return;

  let availableBrands = new Set();
  
  // A MÁGICA ESTÁ AQUI: Garante que o loop só rode nas categorias que você clicou no painel Marcas!
  if (state.mid_categories && state.mid_categories.size > 0) {
    state.mid_categories.forEach(cat => {
      if (BRANDS_MAP[cat]) {
        BRANDS_MAP[cat].forEach(b => availableBrands.add(b));
      }
    });
  }

  // Se nenhuma categoria estiver clicada, mostra o aviso
  if (availableBrands.size === 0) {
    container.innerHTML = '<div class="empty-state" style="width:100%; padding:10px;">Selecione uma categoria acima para ver as marcas.</div>';
    return;
  }

  // Ordena alfabeticamente e cria os botões
  const sortedBrands = Array.from(availableBrands).sort();
  container.innerHTML = "";
  
  sortedBrands.forEach(brand => {
    const btn = document.createElement("button");
    // Verifica se a marca já tinha sido selecionada antes
    btn.className = `brand-pill ${state.mid_selected_brands.has(brand) ? "active" : ""}`;
    btn.textContent = brand;
    
    // O clique na bolha da marca
    btn.addEventListener("click", async () => {
      if (state.mid_selected_brands.has(brand)) {
        state.mid_selected_brands.delete(brand);
      } else {
        state.mid_selected_brands.add(brand);
      }
      btn.classList.toggle("active");
      await saveState();
      await pushConfigToApi(); // Atualiza o radar em tempo real
    });
    
    container.appendChild(btn);
  });
}

function bindEvents() {
  // Nível
 // --- ABAS (Mudam apenas a aba visual no painel) ---
  document.querySelectorAll(".level-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.current_tab = btn.dataset.level;
      renderLevelPanel();
    });
  });

  // --- BOTÕES DE ATIVAÇÃO (Ligar/Desligar o Radar no Python) ---
  document.querySelectorAll(".btn-activate-level").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const lvl = btn.dataset.level;
      if (state.active_levels.has(lvl)) {
        state.active_levels.delete(lvl); // Pausa
      } else {
        state.active_levels.add(lvl); // Ativa
      }
      renderLevelPanel();
      await saveState();
      await pushConfigToApi(); // Envia pro servidor
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

// ---------------------------------------------------------------------------
// Renderização Visual
// ---------------------------------------------------------------------------


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

// --- Cartões de Categoria (Totalmente Independentes) ---
  document.querySelectorAll(".cat-card").forEach((card) => {
    card.addEventListener("click", async () => {
      const catName = card.dataset.category;
      const panel = card.dataset.panel; // "broad" ou "mid"

      if (panel === "broad") {
        if (state.broad_categories.has(catName)) state.broad_categories.delete(catName);
        else state.broad_categories.add(catName);
      } else if (panel === "mid") {
        if (state.mid_categories.has(catName)) state.mid_categories.delete(catName);
        else state.mid_categories.add(catName);
        renderMidBrands(); 
      }

      card.classList.toggle("active", panel === "broad" ? state.broad_categories.has(catName) : state.mid_categories.has(catName));
      await saveState();
      await pushConfigToApi();
    });
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

function renderLevelPanel() {
  // 1. Atualiza as ABAS (Visualização)
  document.querySelectorAll(".level-btn").forEach((btn) => {
    const lvl = btn.dataset.level;
    if (state.current_tab === lvl) {
      btn.classList.add("active");
    } else {
      btn.classList.remove("active");
    }
  });

  // 2. Mostra apenas o painel da aba selecionada (3 Menus Diferentes!)
  const panelBroad = document.getElementById("panel-broad");
  const panelMid = document.getElementById("panel-mid");
  const panelSpecific = document.getElementById("panel-specific");

  if (panelBroad) panelBroad.style.display = state.current_tab === "broad" ? "block" : "none";
  if (panelMid) panelMid.style.display = state.current_tab === "mid" ? "block" : "none";
  if (panelSpecific) panelSpecific.style.display = state.current_tab === "specific" ? "block" : "none";

  // 3. Sincroniza os Botões de Ligar/Desligar dentro dos painéis
  document.querySelectorAll(".btn-activate-level").forEach((btn) => {
    const lvl = btn.dataset.level;
    if (state.active_levels.has(lvl)) {
      btn.classList.add("running");
      btn.innerHTML = "🟢 Radar Ativado";
    } else {
      btn.classList.remove("running");
      btn.innerHTML = "⚪ Pausado";
    }
  });

  // Sincroniza os cartões de categorias
  document.querySelectorAll(`.cat-card[data-panel="broad"]`).forEach(c => {
    c.classList.toggle("active", state.broad_categories.has(c.dataset.category));
  });
  document.querySelectorAll(`.cat-card[data-panel="mid"]`).forEach(c => {
    c.classList.toggle("active", state.mid_categories.has(c.dataset.category));
  });
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------
async function init() {
  // 1. BARREIRA RÁPIDA: Verifica se existe auth localmente
  const auth = await new Promise((resolve) => {
    if (typeof chrome !== "undefined" && chrome.storage?.local) {
      chrome.storage.local.get(["telegramAuth"], (res) => resolve(res.telegramAuth));
    } else {
      resolve(JSON.parse(localStorage.getItem("telegramAuth")));
    }
  });

  // Se não tem registo local, nem carrega o resto. Vai para o login!
  if (!auth || !auth.logged) {
    openLogin();
    return;
  }

  // 2. Se passou na primeira barreira, carrega a UI base
  await loadState();
  renderLevelPanel();

  // 3. BARREIRA SEGURA: Confirma com a API se a sessão é real
  const isSessionValid = await loadUser();
  if (!isSessionValid) return; // Se não for válida, o loadUser já redirecionou e paramos aqui

  // 4. Sessão validada! Carrega os dados pesados
  loadGroups();
  bindEvents();
  loadAlerts();
  renderMidBrands();
  if ("Notification" in window && Notification.permission !== "granted") {
    Notification.requestPermission();
  }
}

//obriga o carregamento do DOM antes de iniciar a aplicação
document.addEventListener("DOMContentLoaded", init);