from __future__ import annotations

import re


def parse_int(text: str) -> int | None:
    try:
        return int(text.strip())
    except ValueError:
        return None


def parse_float(text: str) -> float | None:
    try:
        return float(text.replace(",", ".").strip())
    except ValueError:
        return None


def parse_float_list(text: str) -> list[float | None]:
    if not text.strip():
        return []
    parts = re.split(r"[,\s]+", text.strip())
    values: list[float | None] = []
    for part in parts:
        if part == "":
            continue
        values.append(parse_float(part))
    return values

