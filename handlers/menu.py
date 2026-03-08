from __future__ import annotations

import logging

from telegram import InlineKeyboardButton, InlineKeyboardMarkup, Update
from telegram.ext import ContextTypes

from constants import ATT_LESSONS, GPA_COUNT, LANG, MENU, TEMPLATE_WEIGHTS, TOTAL_HAS_REGTERM
from i18n import t
from keyboards import language_keyboard, menu_keyboard, nav_keyboard

logger = logging.getLogger(__name__)


async def start(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    if context.user_data.get("lang"):
        await update.message.reply_text(t(context, "choose_calc"), reply_markup=menu_keyboard(context))
        return MENU
    await update.message.reply_text(t(context, "choose_lang"), reply_markup=language_keyboard(context))
    return LANG


async def choose_language(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    query = update.callback_query
    await query.answer()
    if query.data == "lang_ru":
        context.user_data["lang"] = "ru"
    elif query.data == "lang_en":
        context.user_data["lang"] = "en"
    await query.edit_message_text(t(context, "choose_calc"), reply_markup=menu_keyboard(context))
    return MENU


async def menu_choice(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    query = update.callback_query
    await query.answer()
    choice = query.data

    if choice == "lang":
        base = language_keyboard(context).inline_keyboard
        keyboard = InlineKeyboardMarkup(list(base) + [[InlineKeyboardButton(t(context, "back"), callback_data="back")]])
        await query.edit_message_text(t(context, "choose_lang"), reply_markup=keyboard)
        return LANG

    if choice == "gpa":
        await query.edit_message_text(t(context, "gpa_count"), reply_markup=nav_keyboard(context))
        return GPA_COUNT
    if choice == "attendance":
        await query.edit_message_text(t(context, "att_lessons"), reply_markup=nav_keyboard(context))
        return ATT_LESSONS
    if choice == "total":
        keyboard = InlineKeyboardMarkup(
            [
                [InlineKeyboardButton(t(context, "regterm_yes"), callback_data="regterm_yes")],
                [InlineKeyboardButton(t(context, "regterm_no"), callback_data="regterm_no")],
                [InlineKeyboardButton(t(context, "cancel"), callback_data="cancel")],
            ]
        )
        await query.edit_message_text(t(context, "total_has_regterm"), reply_markup=keyboard)
        return TOTAL_HAS_REGTERM
    if choice == "template":
        await query.edit_message_text(t(context, "template_weights"), reply_markup=nav_keyboard(context))
        return TEMPLATE_WEIGHTS

    await query.edit_message_text(t(context, "choose_calc"), reply_markup=menu_keyboard(context))
    return MENU


async def handle_nav(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    query = update.callback_query
    await query.answer()
    if query.data == "cancel":
        await query.edit_message_text(t(context, "cancelled"))
    return await back_to_menu(update, context)


async def cancel(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    await update.message.reply_text(t(context, "cancelled"))
    return await back_to_menu(update, context)


async def back_to_menu(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    if update.message:
        await update.message.reply_text(t(context, "choose_calc"), reply_markup=menu_keyboard(context))
    elif update.callback_query:
        await update.callback_query.edit_message_text(t(context, "choose_calc"), reply_markup=menu_keyboard(context))
    return MENU


async def on_error(update: object, context: ContextTypes.DEFAULT_TYPE) -> None:
    logger.exception("Unhandled error", exc_info=context.error)
    if isinstance(update, Update) and update.effective_message:
        try:
            await update.effective_message.reply_text(t(context, "unhandled_error"))
        except Exception:
            logger.exception("Failed to send error message")

