from fastapi import FastAPI, HTTPException
from telethon import TelegramClient
from telethon.errors import SessionPasswordNeededError
from telethon.errors.rpcerrorlist import (
    PhoneCodeInvalidError,
    PhoneNumberInvalidError,
    SendCodeUnavailableError,
)
from pathlib import Path
import os

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

api_id = os.getenv("TELEGRAM_API_ID")
api_hash = os.getenv("TELEGRAM_API_HASH")

if not api_id or not api_hash:
    raise RuntimeError("Defina TELEGRAM_API_ID e TELEGRAM_API_HASH no ambiente ou no arquivo .env")

phone_number = None
phone_code_hash = None

SESSION_PATH = BASE_DIR / "sessions" / "users"

client = TelegramClient(str(SESSION_PATH), api_id, api_hash)

app = FastAPI()


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
        return {
            "status": "code already sent",
            "message": "Codigo ja enviado. Use o codigo atual antes de solicitar novamente.",
        }

    phone_number = phone

    await client.connect()

    try:
        result = await client.send_code_request(phone_number)
        phone_code_hash = result.phone_code_hash
        return {"status": "code sent"}
    except SendCodeUnavailableError:
        raise HTTPException(
            status_code=429,
            detail="Limite de envio atingido para este numero. Aguarde e tente novamente depois.",
        )
    except PhoneNumberInvalidError:
        raise HTTPException(
            status_code=400, 
            detail="Numero de telefone invalido.")

@app.post("/login")
async def login(data: dict):
    global phone_code_hash

    code = (data.get("code") or "").strip()
    if not code:
        raise HTTPException(status_code=400, detail="Codigo é obrigatorio.")

    if not phone_number:
        raise HTTPException(status_code=400, detail="Solicite o codigo antes de fazer login.")

    await client.connect()

    try:
        await client.sign_in(phone=phone_number, code=code, phone_code_hash=phone_code_hash)
        phone_code_hash = None
        return {"status": "logged"}
    except PhoneCodeInvalidError:
        raise HTTPException(status_code=400, detail="Codigo invalido.")
    except SessionPasswordNeededError:
        raise HTTPException(
            status_code=400,
            detail="Esta conta requer senha de 2 fatores. Fluxo de senha ainda nao implementado.",
        )

@app.get("/me")
async def get_me():
    await client.connect()
    
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
    await client.connect()
    
    if not await client.is_user_authorized():
        return {"groups": []}
    
    dialogs = await client.get_dialogs()
    
    groups =  []
    
    for d in dialogs:
        if d.is_group or d.is_channel:
            groups.append({
                "id": d.id,
                "title": d.title,
                "username": d.entity.username if hasattr(d.entity, "username") else None,
            })
    
    return {"groups": groups}