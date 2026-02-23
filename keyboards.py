from __future__ import annotations

from telegram import InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import ContextTypes

from i18n import t


def menu_keyboard(context: ContextTypes.DEFAULT_TYPE) -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        [
            [InlineKeyboardButton(t(context, "menu_gpa"), callback_data="gpa")],
            [InlineKeyboardButton(t(context, "menu_attendance"), callback_data="attendance")],
            [InlineKeyboardButton(t(context, "menu_total"), callback_data="total")],
            [InlineKeyboardButton(t(context, "menu_template"), callback_data="template")],
            [InlineKeyboardButton(t(context, "menu_lang"), callback_data="lang")],
        ]
    )


def nav_keyboard(context: ContextTypes.DEFAULT_TYPE) -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        [
            [InlineKeyboardButton(t(context, "back"), callback_data="back")],
            [InlineKeyboardButton(t(context, "cancel"), callback_data="cancel")],
        ]
    )


def language_keyboard(context: ContextTypes.DEFAULT_TYPE) -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        [
            [InlineKeyboardButton(t(context, "lang_ru"), callback_data="lang_ru")],
            [InlineKeyboardButton(t(context, "lang_en"), callback_data="lang_en")],
        ]
    )

