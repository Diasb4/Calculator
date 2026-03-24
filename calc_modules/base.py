from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from aiogram import Router
    from aiogram.fsm.context import FSMContext
    from aiogram.types import CallbackQuery

StartFn = Callable[["CallbackQuery", "FSMContext"], Awaitable[Any]]


@dataclass(frozen=True, slots=True)
class BotModule:
    module_id: str
    menu_key: str
    start: StartFn
    router: "Router"
