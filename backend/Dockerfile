# ── Build stage ───────────────────────────────────────────────────────────────
FROM python:3.12-slim AS builder

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir --upgrade -r requirements.txt

# uvloop: faster async event loop (replaces asyncio's default loop)
# httptools: faster HTTP parsing (used by uvicorn --http httptools)
RUN pip install --no-cache-dir uvloop httptools

# ── Runtime stage ─────────────────────────────────────────────────────────────
FROM python:3.12-slim

WORKDIR /app

COPY --from=builder /usr/local/lib/python3.12/site-packages /usr/local/lib/python3.12/site-packages
COPY --from=builder /usr/local/bin /usr/local/bin

COPY app/ ./app/

ENV PORT=8000

EXPOSE $PORT

# Single worker — required for SQLite + asyncio.create_task() to work correctly.
# Multiple workers = separate processes = tasks fired in one worker are invisible
# to others, and SQLite allows only one writer at a time anyway.
#
# --loop uvloop      : faster C-based event loop, handles more concurrent I/O
# --http httptools   : faster HTTP parsing
# --timeout-keep-alive 75 : keeps connections alive during long eval runs
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port $PORT --loop uvloop --http httptools --timeout-keep-alive 75"]
