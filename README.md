# 📡 Telegram Radar - Monitor de Ofertas em Tempo Real

[![Python](https://img.shields.io/badge/Python-3.10+-3776AB?logo=python&logoColor=white)](https://www.python.org/)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.100+-009688?logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com/)
[![Telethon](https://img.shields.io/badge/Telethon-Library-0088cc?logo=telegram&logoColor=white)](https://docs.telethon.dev/)
[![JavaScript](https://img.shields.io/badge/JavaScript-ES6+-F7DF1E?logo=javascript&logoColor=black)](https://developer.mozilla.org/en-US/docs/Web/JavaScript)

O **Telegram Radar** é uma solução completa para monitoramento automatizado de grupos e canais do Telegram. Desenvolvido para caçadores de ofertas e entusiastas de automação, o projeto combina uma API robusta em Python com uma extensão de navegador moderna para oferecer controle total sobre o fluxo de informações.

---

## 🚀 Funcionalidades Principais

- **Autenticação Segura**: Login direto via Telegram API com suporte a código de verificação.
- **Monitoramento em Tempo Real**: Escaneia mensagens de múltiplos grupos simultaneamente.
- **Filtros Inteligentes**: Configure palavras-chave e critérios específicos (preço, modelo, ano) para filtrar apenas o que importa.
- **Blacklist de Grupos**: Bloqueie grupos indesejados por nome de forma dinâmica.
- **Interface Moderna**: Dashboard intuitivo com design *Glassmorphism* e feedback em tempo real.
- **Extensão de Navegador**: Acesso rápido e controle total diretamente do seu browser.

---

## 🛠️ Tecnologias Utilizadas

### **Backend (API)**
- **Python 3.10+**: Linguagem base pela sua versatilidade e ecossistema.
- **FastAPI**: Framework de alta performance para a construção da API.
- **Telethon**: Biblioteca cliente do Telegram para interação com a MTProto API.
- **Asyncio**: Processamento assíncrono para garantir escalabilidade no monitoramento.

### **Frontend (Extensão)**
- **HTML5 & CSS3**: Layout moderno com variáveis CSS e animações fluidas.
- **JavaScript (Vanilla)**: Lógica de interface pura, sem dependências pesadas, garantindo leveza.
- **Chrome Extension API**: Integração nativa com o navegador para armazenamento local e gerenciamento de abas.

---

## 📦 Estrutura do Projeto

```bash
.
├── api/                # Servidor Backend em Python
│   └── server.py       # Lógica da API e integração com Telegram
├── extension/          # Código da Extensão do Navegador
│   ├── login.html      # Tela de autenticação
│   ├── dashboard.html  # Painel principal de controle
│   ├── popup.html      # Acesso rápido da extensão
│   └── *.js            # Lógica de interface separada
└── .env                # Configurações de API (API_ID, API_HASH)
```

---

## 🔧 Como Configurar

### 1. Requisitos Prévios
- Obtenha seu `API_ID` e `API_HASH` em [my.telegram.org](https://my.telegram.org).
- Python 3.10 ou superior instalado.

### 2. Configuração do Backend
```bash
# Clone o repositório
git clone https://github.com/JanGustavo/telegram-api-bot-radar.git
cd telegram-api-bot-radar/api

# Instale as dependências
pip install fastapi uvicorn telethon python-dotenv

# Configure suas credenciais no arquivo .env
echo "API_ID=seu_id\nAPI_HASH=seu_hash" > .env

# Inicie o servidor
python server.py
```

### 3. Instalação da Extensão
1. Abra o Chrome e vá para `chrome://extensions/`.
2. Ative o **Modo do Desenvolvedor** no canto superior direito.
3. Clique em **Carregar sem compactação** e selecione a pasta `extension` deste projeto.

---

## 🎨 Preview do Layout

O projeto conta com uma interface moderna e responsiva, focada na experiência do usuário:
- **Login**: Fluxo simplificado em etapas.
- **Dashboard**: Grid organizado com status em tempo real e controles intuitivos.
- **Popup**: Atalho rápido para acesso imediato ao radar.

---

## 📄 Licença

Este projeto está sob a licença MIT. Veja o arquivo [LICENSE](LICENSE) para mais detalhes.

---

> **Nota de Portfólio**: Este projeto demonstra habilidades em desenvolvimento Full Stack, integração com APIs de terceiros (Telegram MTProto), processamento assíncrono e design de interface moderna.
