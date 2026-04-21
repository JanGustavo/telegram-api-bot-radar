# Usa uma versão leve do Python
FROM python:3.11-slim

# Define a pasta de trabalho dentro do contentor
WORKDIR /app

# Impede o Python de gravar ficheiros .pyc e força os logs a aparecerem no terminal
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

# Copia e instala as dependências
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copia o resto do código da API
COPY . .

# Expõe a porta 8000 para a rede externa
EXPOSE 8000

# O comando que mantém o servidor vivo
# IMPORTANTE: host 0.0.0.0 é obrigatório no Docker para aceitar ligações externas
CMD ["uvicorn", "api.server:app", "--host", "0.0.0.0", "--port", "8000"]