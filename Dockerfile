FROM python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    LOG_LEVEL=WARNING \
    USE_UVLOOP=1 \
    PYTHONOPTIMIZE=1

WORKDIR /app

# System deps (kept minimal). uvloop needs build tools on some platforms; we install it via pip only if it has wheels.
RUN pip install --no-cache-dir --upgrade pip

COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt

COPY . /app

# Optional: faster event loop on Linux. If install fails (no wheels), container still works.
RUN pip install --no-cache-dir uvloop || true

CMD ["python", "main.py"]
