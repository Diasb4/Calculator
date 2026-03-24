from __future__ import annotations

import importlib
import logging
from typing import Any

from calc_modules.base import BotModule

logger = logging.getLogger(__name__)


def _coerce_module(obj: Any) -> BotModule | None:
    if isinstance(obj, BotModule):
        return obj
    return None


def load_modules(module_paths: list[str]) -> list[BotModule]:
    loaded: list[BotModule] = []
    for path in module_paths:
        try:
            mod = importlib.import_module(path)
        except Exception:
            logger.exception("Failed to import module %s", path)
            continue

        candidate = getattr(mod, "MODULE", None)
        if candidate is None and hasattr(mod, "build_module"):
            try:
                candidate = mod.build_module()
            except Exception:
                logger.exception("Failed to build module %s", path)
                candidate = None

        bot_module = _coerce_module(candidate)
        if bot_module is None:
            logger.warning("Module %s does not expose BotModule as MODULE/build_module()", path)
            continue

        loaded.append(bot_module)

    return loaded

