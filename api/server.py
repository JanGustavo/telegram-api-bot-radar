import asyncio

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

api_id = os.getenv("API_ID") or os.getenv("TELEGRAM_API_ID")
api_hash = os.getenv("API_HASH") or os.getenv("TELEGRAM_API_HASH")

if not api_id or not api_hash:
    raise RuntimeError(
        "Credenciais do Telegram nao configuradas.\n"
        "Passos:\n"
        "1. Verifique se o arquivo .env existe com API_ID e API_HASH\n"
        "2. Ou use TELEGRAM_API_ID e TELEGRAM_API_HASH (obtenha em https://my.telegram.org/apps)\n"
        "3. Reinicie a API"
    )

phone_number = None
phone_code_hash = None

try:
    api_id = int(api_id)
except (TypeError, ValueError) as error:
    raise RuntimeError("API_ID deve ser um numero inteiro valido.") from error

SESSION_PATH = BASE_DIR / "sessions" / "users"

def create_client() -> TelegramClient:
    return TelegramClient(str(SESSION_PATH), api_id, api_hash)


client = create_client()
client_lock = asyncio.Lock()

app = FastAPI()


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
                detail="Nao foi possivel conectar na API do Telegram no momento.",
            )


@app.on_event("startup")
async def startup() -> None:
    await ensure_client_connected()


@app.on_event("shutdown")
async def shutdown() -> None:
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
        return {
            "status": "code already sent",
            "message": "Codigo ja enviado. Use o codigo atual antes de solicitar novamente.",
        }

    phone_number = phone

    await ensure_client_connected()

    try:
        result = await client.send_code_request(phone_number)
        phone_code_hash = result.phone_code_hash
        return {"status": "code sent"}
    except ConnectionError:
        raise HTTPException(
            status_code=503,
            detail="Nao foi possivel enviar o codigo porque a API do Telegram ficou desconectada.",
        )
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

    await ensure_client_connected()

    try:
        await client.sign_in(phone=phone_number, code=code, phone_code_hash=phone_code_hash)
        phone_code_hash = None
        return {"status": "logged"}
    except ConnectionError:
        raise HTTPException(
            status_code=503,
            detail="Nao foi possivel validar o codigo porque a API do Telegram ficou desconectada.",
        )
    except PhoneCodeInvalidError:
        raise HTTPException(status_code=400, detail="Codigo invalido.")
    except SessionPasswordNeededError:
        raise HTTPException(
            status_code=400,
            detail="Esta conta requer senha de 2 fatores. Fluxo de senha ainda nao implementado.",
        )

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
    
    groups =  []
    
    for d in dialogs:
        if d.is_group or d.is_channel:
            groups.append({
                "id": d.id,
                "title": d.title,
                "username": d.entity.username if hasattr(d.entity, "username") else None,
            })
    
    return {"groups": groups}