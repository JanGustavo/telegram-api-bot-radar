import asyncio
import re

from fastapi import FastAPI, HTTPException
from telethon import TelegramClient, events
from telethon.errors import SessionPasswordNeededError
from telethon.errors.rpcerrorlist import (
    PhoneCodeInvalidError,
    PhoneNumberInvalidError,
    SendCodeUnavailableError,
)
from pathlib import Path
import os

# ---------------------------------------------------------------------------
# Env loader
# ---------------------------------------------------------------------------

def _load_env_file(base_dir: Path) -> None:
    env_path = base_dir / ".env"
    if not env_path.exists():
        return
    for raw_line in env_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


BASE_DIR = Path(__file__).resolve().parent.parent
_load_env_file(BASE_DIR)

api_id = os.getenv("API_ID") or os.getenv("TELEGRAM_API_ID")
api_hash = os.getenv("API_HASH") or os.getenv("TELEGRAM_API_HASH")

if not api_id or not api_hash:
    raise RuntimeError(
        "Credenciais do Telegram nao configuradas.\n"
        "1. Verifique se o arquivo .env existe com API_ID e API_HASH\n"
        "2. Ou use TELEGRAM_API_ID e TELEGRAM_API_HASH (https://my.telegram.org/apps)\n"
        "3. Reinicie a API"
    )

try:
    api_id = int(api_id)
except (TypeError, ValueError) as error:
    raise RuntimeError("API_ID deve ser um numero inteiro valido.") from error

# ---------------------------------------------------------------------------
# Filtro automático de qualidade de grupos
# Elimina grupos de bots, spam, crypto, adult etc. antes de monitorar.
# ---------------------------------------------------------------------------

GROUP_QUALITY_BLOCKLIST: list[re.Pattern] = [re.compile(p, re.IGNORECASE) for p in [
    # ---- Série numerada / canais clones ----
    r"\b(v|grupo|group|canal|sala|room|chat)\s*\d{1,3}$",
    r"_(q|p|m|a|ww|qq)\d{1,3}$",
    r"-canal\s+oficial",
    r"canal\s+oficial",
    r"\boficial_",

    # ---- Códigos alfanuméricos de esquemas (KK76, P933, 688XT…) ----
    r"^[a-z0-9]{4,6}\s+(brasil|oficial|club)",
    r"\b(kk76|p933|688xt|kkn)\b",
    r"^[A-Z]{2,4}\d{1,3}$",

    # ---- Trading / signals / quant / financeiro suspeito ----
    r"\bquant(um)?\b",
    r"\bsignal(s)?\b",
    r"\bexchange\b",
    r"\bforecast\b",
    r"\bwealth\s+learning\b",
    r"\bhall\s+(planning|analysis)\b",
    r"\bresultados\s+reais\b",
    r"\bcrypt(o|omoeda)s?\b",
    r"\bbitcoin\b",
    r"\btoken\b",
    r"\bairdrop\b",
    r"\bforex\b",
    r"\binvestimento(s)?\b",
    r"\bganho(s)?\b",
    r"\brenda\s*(extra|passiva)\b",

    # ---- Cassino / apostas / sorte ----
    r"\bsorte\d*\b",
    r"\bvip\s+expert\b",
    r"\bcassino\b",
    r"\bapostas?\b",
    r"\bbetting\b",
    r"\bsorteio\b",

    # ---- Pirataria / rateio ----
    r"\brateio\b",
    r"\bfilmes?\s+(in\s+drive|drive)\b",
    r"\bin\s+drive\b",
    r"\bmestre\s+dos\s+cursos\b",
    r"\bcatálogo\b",

    # ---- Bot farms numerados ----
    r"^\d{1,3}\s+gruh$",
    r"^\d{2,4}$",

    # ---- Links no nome ----
    r"https?://",
    r"t\.me/",

    # ---- Steam / pirataria de games ----
    r"\bsteam\b",
    r"\bgiveaway\b",

    # ---- Hacking / invasão (fora de contexto de promoções) ----
    r"\bhack(er|ing|ado)?\b",
    r"\binvas[aã]o\b",
    r"\bcybersecurity\b",
    r"\bciberseguran[cç]a\b",
    r"\bbounty\b",
    r"\bhackersec\b",
    r"\bacademy\b",
    r"\bai\s+strategy\b",

    # ---- Adult / spam ----
    r"18\s*\+",
    r"\badult\b",
    r"\bxxx\b",
    r"\bnude(s)?\b",
    r"\bspam\b",
    r"\bpropaganda\b",
    r"\bpublicidade\b",
    r"\bgrátis\b",
    r"\bfree\s*money\b",

    # ---- Scripts não-PT/EN em massa ----
    r"[\u0600-\u06FF\u0750-\u077F]{3,}",
    r"[\u0400-\u04FF]{4,}",
    r"[\u4E00-\u9FFF]{2,}",
]]


def _is_spam_name(title: str) -> bool:
    if " " in title.strip():
        return False
    clean = re.sub(r"[^a-zA-Z]", "", title)
    if not clean:
        return False
    if len(clean) < 4:
        return True
    t = clean.lower()
    vowels = sum(1 for c in t if c in "aeiou")
    ratio = vowels / len(t)

    if ratio < 0.30:
        return True
    if re.search(r"(.{2,4})\1", t):
        return True
    if re.search(r"[^aeiou]{4,}", t):
        return True
    if len(t) >= 7 and ratio < 0.45 and re.search(r"[^aeiou]{3,}", t):
        return True
    return False


def group_passes_quality_filter(title: str) -> bool:
    for pattern in GROUP_QUALITY_BLOCKLIST:
        if pattern.search(title):
            return False
    if _is_spam_name(title):
        return False
    return True


# ---------------------------------------------------------------------------
# Sistema de Níveis de Monitoramento
# ---------------------------------------------------------------------------

WATCH_CONFIG: dict = {
    "level": "broad",  # "broad" | "mid" | "specific"
    "active_categories": ["celulares"], # <-- (FIX 1) Agora a API sabe por padrão qual buscar
    "specific_models": [],   
    "mid_brands": [],        
    "broad_keywords": [],    
    "price_max": None,       
    "min_score": 2,
    "relaxed_mode": False,
    "require_offer_match": True,  
    "self_monitor": True,  
}

CATEGORY_RULES = {
    "celulares": {
        "strong_keywords": [r"\bcelular(es)?\b", r"\bsmartphone(s)?\b", r"\biphone\b", r"\bgalaxy\b", r"\bpoco\b", r"\bredmi\b"],
        "ambiguous_brands": [r"\bsamsung\b", r"\bmotorola\b", r"\bxiaomi\b", r"\blg\b", r"\basus\b", r"\bapple\b"],
        "context_modifiers": [r"\b[a-z]\d{2,3}\b", r"\bedge\b", r"\bnote\b", r"\bpro\b", r"\bultra\b"], 
        "exclude": [r"\btab\b", r"\btablet\b", r"\bwatch\b", r"\bbook\b", r"\bfone\b", r"\bbuds\b", r"\bmacbook\b", r"\btv\b", r"\bcapa(s)?\b", r"\bcase(s)?\b", r"\bpel[ií]cula(s)?\b"]
    },
    "tvs": {
        "strong_keywords": [r"\btv(s)?\b", r"\bsmart\s?tv\b", r"\bsmartv\b", r"\btelevis[aã]o\b"],
        "ambiguous_brands": [r"\bsamsung\b", r"\blg\b", r"\bphilips\b", r"\btcl\b", r"\baoc\b"],
        "context_modifiers": [r"\b\d{2}\s?(polegadas|pol|\"|'')\b", r"\b4k\b", r"\b8k\b", r"\boled\b", r"\bqled\b"],
        "exclude": [r"\bmonitor\b", r"\bcelular\b", r"\bsmartphone\b"]
    },
    "audio": {
        "strong_keywords": [r"\bfone(s)?\b", r"\bheadset\b", r"\bearbuds\b", r"\bairpods\b"],
        "ambiguous_brands": [r"\bjbl\b", r"\bsony\b", r"\bedifier\b", r"\bapple\b", r"\bsamsung\b"],
        "context_modifiers": [r"\bbluetooth\b", r"\bsem\s*fio\b", r"\banc\b", r"\bnoise\s*cancelling\b"],
        "exclude": [r"\bcaixa\s*vazia\b", r"\bcapa\b", r"\bcase\b"]
    },
    "higiene": {
        "strong_keywords": [r"\bshampoo\b", r"\bdesodorante\b", r"\bpast[aã]o\b", r"\bgillette\b", r"\bsabonete\b", r"\bfralda\b", r"\bpampers\b"],
        "ambiguous_brands": [r"\bdove\b", r"\bl[oó]re[aá]l\b", r"\bnivea\b", r"\brexona\b"],
        "context_modifiers": [r"\bml\b", r"\bunidades\b", r"\bkit\b", r"\bpack\b"],
        "exclude": []
    },
    "informatica": {
        "strong_keywords": [r"\bnotebook(s)?\b", r"\blaptop(s)?\b", r"\bmacbook\b", r"\bpc\s+gamer\b", r"\bplaca\s+de\s+v[ií]deo\b", r"\brtx\b", r"\brx\b"],
        "ambiguous_brands": [r"\bdell\b", r"\blenovo\b", r"\bacer\b", r"\bavell\b", r"\basus\b"],
        "context_modifiers": [r"\bram\b", r"\bgb\b", r"\btb\b", r"\bintel\b", r"\bryzen\b"],
        "exclude": [r"\bcabo\b", r"\badaptador\b"]
    },
    "casa": {
        "strong_keywords": [r"\bair\s?fryer\b", r"\bmicro-ondas\b", r"\bgeladeira\b", r"\bliquidificador\b", r"\baspirador\b"],
        "ambiguous_brands": [r"\bmondial\b", r"\belectrolux\b", r"\bphilco\b", r"\boster\b"],
        "context_modifiers": [r"\blitros\b", r"\bw\b", r"\bwatts\b", r"\bvolts\b", r"\b110v\b", r"\b220v\b"],
        "exclude": [r"\bpe[çc]a\b", r"\bconserto\b"]
    }
}

def _remove_accents(text: str) -> str:
    """Remove acentos para facilitar o match de regex."""
    import unicodedata
    return unicodedata.normalize('NFKD', text).encode('ASCII', 'ignore').decode('utf-8')

def _validate_category(text: str, category: str) -> bool:
    """Validador contextual com logs imunes a sobreposição."""
    rules = CATEGORY_RULES.get(category)
    if not rules:
        return False
        
    print(f"\n[🔍 ANALISANDO CATEGORIA: {category.upper()}]", flush=True)
    
    # Remove acentos do texto para o validador não escorregar
    t_clean = _remove_accents(text.lower())
        
    # 0. Caiu na exclusão?
    for exc in rules.get("exclude", []):
        if re.search(exc, t_clean):
            print(f" ❌ BLOQUEADO: Contém exclusão '{exc}'", flush=True)
            return False

    # 1. Identificador Forte?
    for kw in rules.get("strong_keywords", []):
        if re.search(kw, t_clean):
            print(f" ✅ APROVADO: Identificador forte '{kw}'", flush=True)
            return True

    # 2. Marca Ambígua precisa de contexto
    for b in rules.get("ambiguous_brands", []):
        if re.search(b, t_clean):
            print(f" ⚠️ ATENÇÃO: Marca ambígua '{b}'. Buscando contexto...", flush=True)
            for mod in rules.get("context_modifiers", []):
                if re.search(mod, t_clean):
                    print(f" ✅ APROVADO: Modificador '{mod}' validou '{b}'!", flush=True)
                    return True
            print(f" ❌ REJEITADO: Marca '{b}' sem contexto (falso positivo).", flush=True)

    print(f" ➖ IGNORADO: Texto não pertence a {category.upper()}.", flush=True)
    return False

_MID_DEFAULTS = [
    r"galaxy\s*[as]\d{1,2}",
    r"iphone\s*(1[3-9]|2\d)",
    r"motorola\s*edge",
    r"xiaomi\s*(1[0-9]|redmi\s*note)",
    r"poco\s*[fx]\d",
]

# ---------------------------------------------------------------------------
# Padrões de identificação de ofertas reais
# ---------------------------------------------------------------------------

OFFER_PATTERNS: dict[str, list[re.Pattern]] = {
    "price": [re.compile(p, re.IGNORECASE) for p in [
        r"r\$\s*[\d\.]+",
        r"por\s+apenas\s+r\$",
        r"de\s+r\$[\d\.,]+\s+por\s+r\$",
        r"(preço|valor|custa|custando|saindo|sai)\s+(a\s+)?r\$",
        r"parcel(a|ado|amento)\s+em\s+\d+x",
        r"\d+x\s+(sem\s+juros|s\.j\.)",
        r"\b\d{3,5}\b",
        r"\b\d{3,5}\s*reais\b",
        r"\bfa[cç]o\s+r\$?\s*\d+",
    ]],
    "discount": [re.compile(p, re.IGNORECASE) for p in [
        r"\d+\s*%\s*(off|de\s+desc(onto)?|desconto)",
        r"desconto\s+de\s+\d+",
        r"cupom[:\s]+\w+",
        r"c[oó]digo[:\s]+\w+",
        r"frete\s+(gr[aá]tis|free|0)",
        r"economize\s+r\$",
        r"promo(ção|cao|cional)",
    ]],
    "urgency": [re.compile(p, re.IGNORECASE) for p in [
        r"[uú]ltimas?\s+\d+\s+(unidades?|vagas?|pe[cç]as?)",
        r"(restam|s[oó]|apenas)\s+\d+",
        r"acab(a|ou|ando|ará)",
        r"oferta\s*(relâmpago|rel[aâ]mpago|flash|limitada|imperdível)",
        r"v[aá]lid[ao]\s+(at[eé]|por)\s+",
        r"(hoje|agora|urgente|última hora)",
        r"estoque\s+(acabando|baixo|limitado)",
    ]],
    "store": [re.compile(p, re.IGNORECASE) for p in [
        r"\bamazon(\.com\.br)?\b",
        r"\bmagalu\b|\bmagazine\s*luiza\b",
        r"\bamericanas\b",
        r"\bshopee\b",
        r"\bmercado\s*livre\b|\bml\b",
        r"\bkabum\b",
        r"\bcasas\s*bahia\b",
        r"\bponto\s*(frio)?\b",
        r"\bfast\s*shop\b",
        r"\bsubarama\b",
        r"\baliexpress\b",
        r"\bali\s*express\b",
    ]],
    "condition": [re.compile(p, re.IGNORECASE) for p in [
        r"\bnovo\b",
        r"\bsemi.?novo\b",
        r"\busado\b",
        r"\blacrado\b",
        r"\bna\s*caixa\b",
        r"\boriginal\b",
        r"\bgarantia\b",
        r"\bnf\b|\bnota\s*fiscal\b",
        r"\bvendo\b",
        r"\bto\s+vendendo\b",
        r"\bpassando\b",
    ]],
}

alert_history: list[dict] = []
monitoring_active: bool = False
monitoring_task: asyncio.Task | None = None

# ---------------------------------------------------------------------------
# Helpers de filtragem de mensagem
# ---------------------------------------------------------------------------

# <-- (FIX 2) Validador contextual estruturado

# <-- (FIX 3) Novo _matches_level limpo e utilizando o validador
def _matches_level(text: str, level: str) -> bool:
    """Verifica se o texto bate no nível configurado, com Raio-X de Debug."""
    t = text.lower()

    # --- RAIO-X: Mostra o que o Python acha que é a sua configuração ---
    print(f"\n--- 🐛 DEBUG DE MENSAGEM ---", flush=True)
    print(f"Nível ativo no Python: '{level}'", flush=True)
    print(f"Categorias selecionadas: {WATCH_CONFIG.get('active_categories')}", flush=True)
    
    if level == "broad":
        active_cats = WATCH_CONFIG.get("active_categories", [])
        
        if not active_cats:
            print(" ⚠️ AVISO: Nenhuma categoria ativa no backend! Pulando validador.", flush=True)

        for cat in active_cats:
            if _validate_category(t, cat):
                return True
                
        user_keywords = WATCH_CONFIG.get("broad_keywords", [])
        if user_keywords:
            print(f"Palavras extras do usuário: {user_keywords}", flush=True)
            patterns = [rf"\b{re.escape(kw)}\b" for kw in user_keywords]
            if any(re.search(p, t) for p in patterns):
                print(" ✅ APROVADO: Bateu numa palavra extra digitada pelo usuário.", flush=True)
                return True
                
        return False

    if level == "mid":
        mid_brands = WATCH_CONFIG.get("mid_brands", [])
        print(f"Marcas digitadas (Mid): {mid_brands}", flush=True)
        patterns = _MID_DEFAULTS + [rf"\b{re.escape(b)}\b" for b in mid_brands]
        if any(re.search(p, t, re.IGNORECASE) for p in patterns):
            print(" ✅ APROVADO: Bateu na regra de Marcas (Nível Mid).", flush=True)
            return True

    if level == "specific":
        models = WATCH_CONFIG.get("specific_models", [])
        print(f"Modelos digitados (Specific): {models}", flush=True)
        if not models:
            return False
        if any(re.search(m, t, re.IGNORECASE) for m in models):
            print(" ✅ APROVADO: Bateu na regra de Modelos (Nível Específico).", flush=True)
            return True

    return False

def _offer_score(text: str) -> tuple[int, list[str]]:
    matched: list[str] = []
    for category, patterns in OFFER_PATTERNS.items():
        if any(p.search(text) for p in patterns):
            matched.append(category)
    return len(matched), matched


def _extract_price(text: str) -> float | None:
    match = re.search(r"r\$\s*([\d\.]+(?:,\d{2})?)", text, re.IGNORECASE)
    if not match:
        return None
    try:
        return float(match.group(1).replace(".", "").replace(",", "."))
    except ValueError:
        return None


def should_alert(text: str) -> tuple[bool, dict]:
    level = WATCH_CONFIG.get("level", "broad")
    price_max = WATCH_CONFIG.get("price_max")

    if not _matches_level(text, level):
        return False, {}

    score, categories = _offer_score(text)
    min_score = WATCH_CONFIG.get("min_score", 2)
    relaxed = WATCH_CONFIG.get("relaxed_mode", False)
    require_offer_match = WATCH_CONFIG.get("require_offer_match", True)

    if require_offer_match:
        if relaxed:
            if score < 1:
                return False, {}
        else:
            if score < min_score:
                return False, {}

    extracted_price = _extract_price(text)
    if price_max and extracted_price and extracted_price > price_max:
        return False, {}

    return True, {
        "offer_score": score,
        "offer_categories": categories,
        "extracted_price": extracted_price,
    }

# ---------------------------------------------------------------------------
# Telegram client
# ---------------------------------------------------------------------------

phone_number = None
phone_code_hash = None

SESSION_PATH = BASE_DIR / "sessions" / "users"

def create_client() -> TelegramClient:
    return TelegramClient(str(SESSION_PATH), api_id, api_hash)

client = create_client()
client_lock = asyncio.Lock()

from contextlib import asynccontextmanager

@asynccontextmanager
async def lifespan(app: FastAPI):
    await ensure_client_connected()
    yield

app = FastAPI(lifespan=lifespan)

async def ensure_client_connected() -> None:
    global client
    async with client_lock:
        if client.is_connected():
            return
        try:
            await client.connect()
        except ValueError as error:
            if "cannot be reused after logging out" not in str(error):
                raise
            client = create_client()
            await client.connect()
        if not client.is_connected():
            raise HTTPException(
                status_code=503,
                detail="Nao foi possivel conectar na API do Telegram.",
            )

# ---------------------------------------------------------------------------
# Monitoramento ativo
# ---------------------------------------------------------------------------

async def _run_monitoring(group_ids: list[int]) -> None:
    global alert_history

    @client.on(events.NewMessage())
    async def handler(event):
        text = event.message.message or ""
        chat_id = event.chat_id
        self_monitor = WATCH_CONFIG.get("self_monitor", False)
        is_self = event.is_private and event.sender_id == (await client.get_me()).id
        is_selected_group = chat_id in group_ids

        if not (is_selected_group or (self_monitor and is_self)):
            return

        ok, meta = should_alert(text)

        if ok:
            chat = await event.get_chat()
            username = getattr(chat, "username", None)
            
            # --- NOVA LÓGICA DE GERAÇÃO DE LINK ---
            if username:
                # Se for grupo público, o link usa o username e o ID da mensagem
                msg_link = f"https://t.me/{username}/{event.message.id}"
            elif str(chat_id).startswith("-100"):
                # Se for supergrupo/canal privado, a API do Telegram usa o prefixo -100
                # Removemos o -100 e usamos o formato /c/ID/MSG
                clean_id = str(chat_id)[4:]
                msg_link = f"https://t.me/c/{clean_id}/{event.message.id}"
            else:
                msg_link = None
            # --------------------------------------

            alert_history.append({
                "group_id": chat_id,
                "group_title": getattr(chat, "title", "Saved Messages"),
                "username": username if not is_self else None,
                "message": text[:500],
                "message_id": event.message.id,
                "offer_score": meta.get("offer_score"),
                "offer_categories": meta.get("offer_categories"),
                "extracted_price": meta.get("extracted_price"),
                "link": msg_link, # <-- Aqui agora recebe a nossa variável inteligente
            })
            print(f"ALERTA: {chat_id} - {chat.title if hasattr(chat, 'title') else 'Saved Messages'} - {text[:100]}...")
            
            if len(alert_history) > 200:
                alert_history[:] = alert_history[-200:]

    await client.run_until_disconnected()

# ---------------------------------------------------------------------------
# Startup / Shutdown / Auth / Groups
# ---------------------------------------------------------------------------


@app.on_event("shutdown")
async def shutdown() -> None:
    global monitoring_task
    if monitoring_task and not monitoring_task.done():
        monitoring_task.cancel()
    if client.is_connected():
        await client.disconnect()

@app.get("/")
async def root():
    return {"status": "ok"}

@app.post("/send.code")
async def send_code(data: dict):
    global phone_number, phone_code_hash
    phone = (data.get("phone") or "").strip()
    if not phone:
        raise HTTPException(status_code=400, detail="Telefone é obrigatorio.")
    if phone_number == phone and phone_code_hash:
        return {"status": "code already sent"}
    phone_number = phone
    await ensure_client_connected()
    try:
        result = await client.send_code_request(phone_number)
        phone_code_hash = result.phone_code_hash
        return {"status": "code sent"}
    except ConnectionError:
        raise HTTPException(status_code=503, detail="Telegram desconectado.")
    except SendCodeUnavailableError:
        raise HTTPException(status_code=429, detail="Limite de envio atingido.")
    except PhoneNumberInvalidError:
        raise HTTPException(status_code=400, detail="Numero invalido.")

@app.post("/login")
async def login(data: dict):
    global phone_code_hash
    code = (data.get("code") or "").strip()
    if not code:
        raise HTTPException(status_code=400, detail="Codigo é obrigatorio.")
    if not phone_number:
        raise HTTPException(status_code=400, detail="Solicite o codigo antes.")
    await ensure_client_connected()
    try:
        await client.sign_in(phone=phone_number, code=code, phone_code_hash=phone_code_hash)
        phone_code_hash = None
        return {"status": "logged"}
    except ConnectionError:
        raise HTTPException(status_code=503, detail="Telegram desconectado.")
    except PhoneCodeInvalidError:
        raise HTTPException(status_code=400, detail="Codigo invalido.")
    except SessionPasswordNeededError:
        raise HTTPException(status_code=400, detail="Conta requer 2FA.")

@app.post("/logout")
async def logout():
    global client, phone_number, phone_code_hash
    await ensure_client_connected()
    if not await client.is_user_authorized():
        phone_number = None
        phone_code_hash = None
        return {"status": "not logged"}
    await client.log_out()
    client = create_client()
    phone_number = None
    phone_code_hash = None
    return {"status": "logged out"}

@app.get("/me")
async def get_me():
    await ensure_client_connected()
    if not await client.is_user_authorized():
        return {"logged": False}
    me = await client.get_me()
    return {
        "logged": True,
        "id": me.id,
        "first_name": me.first_name,
        "last_name": me.last_name,
        "username": me.username,
        "phone": me.phone,
    }

@app.get("/groups")
async def get_groups():
    await ensure_client_connected()
    if not await client.is_user_authorized():
        return {"groups": []}

    dialogs = await client.get_dialogs()
    groups = []
    for d in dialogs:
        if not (d.is_group or d.is_channel):
            continue
        title = d.title or ""
        passed = group_passes_quality_filter(title)
        groups.append({
            "id": d.id,
            "title": title,
            "username": getattr(d.entity, "username", None), 
            "link": f"https://t.me/{d.entity.username}" if getattr(d.entity, "username", None) else None,
            "auto_filtered": not passed,
        })

    return {"groups": groups}

@app.get("/groups/filter-preview")
async def filter_preview():
    await ensure_client_connected()
    if not await client.is_user_authorized():
        return {"groups": []}

    dialogs = await client.get_dialogs()
    result = []
    for d in dialogs:
        if not (d.is_group or d.is_channel):
            continue
        title = d.title or ""
        blocked_by = []
        for pattern in GROUP_QUALITY_BLOCKLIST:
            if pattern.search(title):
                blocked_by.append(pattern.pattern)
        if not blocked_by and _is_spam_name(title):
            blocked_by.append("spam_name_heuristic")
        result.append({
            "id": d.id,
            "title": title,
            "auto_filtered": len(blocked_by) > 0,
            "blocked_by": blocked_by,
        })

    return {"groups": result}

# ---------------------------------------------------------------------------
# Configuração de monitoramento por nível
# ---------------------------------------------------------------------------

@app.post("/watch/config")
async def set_watch_config(data: dict):
    allowed_levels = {"broad", "mid", "specific"}
    level = data.get("level", "broad")

    if level not in allowed_levels:
        raise HTTPException(status_code=400, detail=f"Nivel invalido. Use: {allowed_levels}")

    WATCH_CONFIG["level"] = level
    
    # <-- (FIX 4) Pega os cards que o usuário clicar no frontend e salva!
    if "active_categories" in data:
        WATCH_CONFIG["active_categories"] = data["active_categories"]
        
    WATCH_CONFIG["specific_models"] = [str(m) for m in data.get("specific_models", [])]
    WATCH_CONFIG["mid_brands"] = [str(b) for b in data.get("mid_brands", [])]
    WATCH_CONFIG["broad_keywords"] = [str(k) for k in data.get("broad_keywords", [])]

    price_raw = data.get("price_max")
    WATCH_CONFIG["price_max"] = float(price_raw) if price_raw else None

    if "min_score" in data:
        WATCH_CONFIG["min_score"] = int(data["min_score"])
    if "relaxed_mode" in data:
        WATCH_CONFIG["relaxed_mode"] = bool(data["relaxed_mode"])
    if "require_offer_match" in data:
        WATCH_CONFIG["require_offer_match"] = bool(data["require_offer_match"])

    return {"status": "config updated", "config": WATCH_CONFIG}

@app.get("/watch/config")
async def get_watch_config():
    return {"config": WATCH_CONFIG}

# ---------------------------------------------------------------------------
# Iniciar / Parar monitoramento / Teste
# ---------------------------------------------------------------------------

@app.post("/watch/start")
async def start_watch(data: dict):
    global monitoring_active, monitoring_task

    await ensure_client_connected()
    if not await client.is_user_authorized():
        raise HTTPException(status_code=401, detail="Nao autenticado.")

    if monitoring_active:
        return {"status": "already running"}

    group_ids = data.get("group_ids", [])
    if not group_ids:
        raise HTTPException(status_code=400, detail="Informe ao menos um grupo.")

    monitoring_active = True
    monitoring_task = asyncio.create_task(_run_monitoring(group_ids))

    return {"status": "monitoring started", "groups": len(group_ids), "config": WATCH_CONFIG}

@app.post("/watch/stop")
async def stop_watch():
    global monitoring_active, monitoring_task

    if not monitoring_active:
        return {"status": "not running"}

    if monitoring_task and not monitoring_task.done():
        monitoring_task.cancel()
        try:
            await monitoring_task
        except asyncio.CancelledError:
            pass

    monitoring_active = False
    monitoring_task = None
    client.remove_event_handler(None)

    return {"status": "monitoring stopped"}

@app.get("/watch/status")
async def watch_status():
    return {
        "active": monitoring_active,
        "config": WATCH_CONFIG,
        "alerts_count": len(alert_history),
    }

@app.get("/alerts")
async def get_alerts(limit: int = 50):
    return {"alerts": alert_history[-limit:]}

@app.delete("/alerts")
async def clear_alerts():
    global alert_history
    alert_history = []
    return {"status": "cleared"}

@app.post("/offers/test")
async def test_offer(data: dict):
    text = data.get("text", "")
    ok, meta = should_alert(text)
    score, categories = _offer_score(text)

    return {
        "would_alert": ok,
        "offer_score": score,
        "offer_categories": categories,
        "extracted_price": _extract_price(text),
        "level_match": _matches_level(text, WATCH_CONFIG["level"]),
        "current_level": WATCH_CONFIG["level"],
    }