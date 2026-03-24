from __future__ import annotations

import asyncio
import logging
import os
import random

from aiohttp import ClientError
from dotenv import load_dotenv
from aiogram import Bot, Dispatcher
from aiogram.client.session.aiohttp import AiohttpSession
from aiogram.exceptions import TelegramNetworkError
from aiogram.fsm.storage.memory import MemoryStorage

from calc_modules.loader import load_modules
from calc_modules.registry import set_modules
from routers.menu import router as menu_router

load_dotenv()


DEFAULT_MODULES = [
    "calc_modules.gpa",
    "calc_modules.attendance",
    "calc_modules.cumulative_gpa",
    "calc_modules.total_score",
    "calc_modules.template",
]

logger = logging.getLogger(__name__)


async def _start_polling_with_retries(dp: Dispatcher, bot: Bot) -> None:
    delay_s = 1.0
    while True:
        try:
            await dp.start_polling(bot, allowed_updates=["message", "callback_query"])
            return
        except (TelegramNetworkError, ClientError) as exc:
            jitter = random.uniform(0, 0.5)
            sleep_for = min(delay_s + jitter, 30.0)
            logger.warning("Network error while polling: %s; retrying in %.1fs", exc, sleep_for)
            await asyncio.sleep(sleep_for)
            delay_s = min(delay_s * 2, 30.0)


async def main() -> None:
    log_level = os.getenv("LOG_LEVEL", "WARNING").upper()
    logging.basicConfig(level=log_level, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

    token = os.getenv("BOT_TOKEN")
    if not token:
        raise RuntimeError("BOT_TOKEN is not set")

    modules = load_modules(DEFAULT_MODULES)
    set_modules(modules)

    session = AiohttpSession(timeout=30)
    bot = Bot(token=token, session=session)
    dp = Dispatcher(storage=MemoryStorage())

    dp.include_router(menu_router)
    for module in modules:
        dp.include_router(module.router)

    await bot.delete_webhook(drop_pending_updates=True)
    try:
        await _start_polling_with_retries(dp, bot)
    finally:
        await bot.session.close()


if __name__ == "__main__":
    try:
        if os.getenv("USE_UVLOOP", "0") == "1":
            try:
                import uvloop  # type: ignore[import-not-found]

                uvloop.install()
            except Exception:
                pass
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
