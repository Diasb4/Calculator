from __future__ import annotations

from typing import Any

from telegram import Update
from telegram.ext import ContextTypes

from calculators import calculate_gpa
from constants import GPA_COUNT, GPA_SUBJECT_CREDITS, GPA_SUBJECT_GRADE, GPA_SUBJECT_NAME
from i18n import t
from keyboards import nav_keyboard
from utils import parse_float, parse_int
from handlers.menu import back_to_menu


async def gpa_count(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    count = parse_int(update.message.text)
    if count is None or count < 1 or count > 20:
        await update.message.reply_text(t(context, "invalid_1_20"), reply_markup=nav_keyboard(context))
        return GPA_COUNT
    context.user_data["gpa_count"] = count
    context.user_data["gpa_subjects"] = []
    context.user_data["gpa_index"] = 0
    await update.message.reply_text(t(context, "gpa_name", n=1), reply_markup=nav_keyboard(context))
    return GPA_SUBJECT_NAME


async def gpa_subject_name(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    context.user_data["gpa_current_name"] = update.message.text.strip()[:80]
    await update.message.reply_text(t(context, "gpa_credits"), reply_markup=nav_keyboard(context))
    return GPA_SUBJECT_CREDITS


async def gpa_subject_credits(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    credits = parse_float(update.message.text)
    if credits is None or credits <= 0 or credits > 50:
        await update.message.reply_text(t(context, "invalid_credits_range"), reply_markup=nav_keyboard(context))
        return GPA_SUBJECT_CREDITS
    context.user_data["gpa_current_credits"] = credits
    await update.message.reply_text(t(context, "gpa_grade"), reply_markup=nav_keyboard(context))
    return GPA_SUBJECT_GRADE


async def gpa_subject_grade(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    grade = parse_float(update.message.text)
    if grade is None or grade < 0 or grade > 100:
        await update.message.reply_text(t(context, "invalid_0_100"), reply_markup=nav_keyboard(context))
        return GPA_SUBJECT_GRADE

    subjects: list[dict[str, Any]] = context.user_data["gpa_subjects"]
    index = context.user_data["gpa_index"]
    subject_name = context.user_data.get("gpa_current_name") or t(context, "gpa_default_subject", n=index + 1)
    subjects.append({"name": subject_name, "credits": context.user_data["gpa_current_credits"], "grade": grade})

    index += 1
    count = context.user_data["gpa_count"]
    context.user_data["gpa_index"] = index

    if index < count:
        await update.message.reply_text(t(context, "gpa_name", n=index + 1), reply_markup=nav_keyboard(context))
        return GPA_SUBJECT_NAME

    try:
        result = calculate_gpa(subjects=subjects)
    except Exception as exc:
        await update.message.reply_text(t(context, "calc_error", err=exc))
        return await back_to_menu(update, context)

    await update.message.reply_text(t(context, "gpa_result", gpa=result["overall_gpa"], credits=result["total_credits"]))
    return await back_to_menu(update, context)

