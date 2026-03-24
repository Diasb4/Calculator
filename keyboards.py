from __future__ import annotations

from aiogram.types import InlineKeyboardMarkup
from aiogram.utils.keyboard import InlineKeyboardBuilder

from calc_modules.registry import get_modules
from i18n import t


def menu_keyboard(lang: str) -> InlineKeyboardMarkup:
    builder = InlineKeyboardBuilder()
    for m in get_modules():
        builder.button(text=t(lang, m.menu_key), callback_data=m.module_id)
    builder.button(text=t(lang, "menu_lang"), callback_data="lang")
    builder.adjust(1)
    return builder.as_markup()


def nav_keyboard(lang: str) -> InlineKeyboardMarkup:
    builder = InlineKeyboardBuilder()
    builder.button(text=t(lang, "back"), callback_data="back")
    builder.button(text=t(lang, "cancel"), callback_data="cancel")
    builder.adjust(1)
    return builder.as_markup()


def language_keyboard(lang: str) -> InlineKeyboardMarkup:
    builder = InlineKeyboardBuilder()
    builder.button(text=t(lang, "lang_ru"), callback_data="lang_ru")
    builder.button(text=t(lang, "lang_en"), callback_data="lang_en")
    builder.adjust(1)
    return builder.as_markup()
