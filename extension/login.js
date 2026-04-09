const API_BASE_URL = "http://localhost:8000";
let sendCodeInFlight = false;

function saveAuthSession() {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set(
      {
        telegramAuth: {
          logged: true,
          savedAt: Date.now(),
        },
      },
      () => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve();
      }
    );
  });
}

function openDashboard() {
  window.location.href = chrome.runtime.getURL("dashboard.html");
}

function setStatus(message, type = "info") {
  const status = document.getElementById("status");
  status.textContent = message;
  status.className = `status ${type}`;
}

async function extractErrorMessage(response, fallbackMessage) {
  try {
    const data = await response.json();
    return data?.detail || data?.message || fallbackMessage;
  } catch {
    return fallbackMessage;
  }
}

async function sendCode() {
  if (sendCodeInFlight) {
    return;
  }

  const phone = document.getElementById("phone").value.trim();
  const sendCodeBtn = document.getElementById("sendCodeBtn");

  if (!phone) {
    setStatus("Digite um telefone para continuar.", "error");
    return;
  }

  sendCodeInFlight = true;
  sendCodeBtn.disabled = true;
  setStatus("Enviando codigo...", "info");

  try {
    const response = await fetch(`${API_BASE_URL}/send.code`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone }),
    });

    if (!response.ok) {
      const detail = await extractErrorMessage(response, "Falha ao enviar o codigo.");
      setStatus(detail, "error");
      return;
    }

    setStatus("Codigo enviado no Telegram.", "success");
  } finally {
    sendCodeInFlight = false;
    sendCodeBtn.disabled = false;
  }
}

async function login() {
  const code = document.getElementById("code").value.trim();
  const loginBtn = document.getElementById("loginBtn");

  if (!code) {
    setStatus("Digite o codigo recebido.", "error");
    return;
  }

  loginBtn.disabled = true;
  setStatus("Validando codigo...", "info");

  try {
    const response = await fetch(`${API_BASE_URL}/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    });

    if (!response.ok) {
      const detail = await extractErrorMessage(response, "Falha no login.");
      setStatus(detail, "error");
      return;
    }

    setStatus("Logado com sucesso!", "success");

    try {
      await saveAuthSession();
    } catch (error) {
      console.error("Nao foi possivel salvar sessao local:", error);
    }

    setTimeout(openDashboard, 450);
  } finally {
    loginBtn.disabled = false;
  }
}

document.getElementById("sendCodeBtn").addEventListener("click", sendCode);
document.getElementById("loginBtn").addEventListener("click", login);
