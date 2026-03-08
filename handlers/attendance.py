from __future__ import annotations

from telegram import Update
from telegram.ext import ContextTypes

from calculators import calculate_attendance
from constants import ATT_LESSONS
from i18n import t
from keyboards import nav_keyboard
from utils import parse_int
from handlers.menu import back_to_menu


async def att_lessons(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    lessons = parse_int(update.message.text)
    if lessons is None or lessons < 1 or lessons > 50:
        await update.message.reply_text(t(context, "invalid_1_50"), reply_markup=nav_keyboard(context))
        return ATT_LESSONS
    try:
        result = calculate_attendance(lessons_per_week=lessons)
    except Exception as exc:
        await update.message.reply_text(t(context, "calc_error", err=exc))
        return await back_to_menu(update, context)

    msg = t(
        context,
        "att_result",
        weeks=result["weeks"],
        per_week=result["lessons_per_week"],
        total=result["total_lessons"],
        missed=result["allowed_missed"],
        percent=result["allowed_percentage"],
    )
    await update.message.reply_text(msg)
    return await back_to_menu(update, context)

