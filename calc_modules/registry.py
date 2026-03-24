from __future__ import annotations

from typing import Final

from calc_modules.base import BotModule

_modules: list[BotModule] = []
_by_id: dict[str, BotModule] = {}

_RESERVED_IDS: Final[set[str]] = {"lang", "back", "cancel"}


def set_modules(modules: list[BotModule]) -> None:
    global _modules, _by_id

    seen: set[str] = set()
    cleaned: list[BotModule] = []
    by_id: dict[str, BotModule] = {}

    for m in modules:
        module_id = (m.module_id or "").strip()
        if not module_id or module_id in _RESERVED_IDS:
            continue
        if module_id in seen:
            continue
        seen.add(module_id)
        cleaned.append(m)
        by_id[module_id] = m

    _modules = cleaned
    _by_id = by_id


def get_modules() -> list[BotModule]:
    return list(_modules)


def get_module(module_id: str) -> BotModule | None:
    return _by_id.get(module_id)

