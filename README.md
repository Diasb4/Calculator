# GradeMaster Telegram Bot

Interactive Telegram bot (aiogram) for calculators (GPA, attendance, total score, template).

## Setup

```powershell
cd telegram_bot
python -m venv .venv
.\\.venv\\Scripts\\Activate.ps1
pip install -r requirements.txt
copy .env.example .env
```

Set `BOT_TOKEN` in `.env`.

## Run

```powershell
python main.py
```

## Docker (24/7)

Make sure `.env` contains `BOT_TOKEN`, then:

```powershell
docker compose up -d --build
docker compose logs -f
```
