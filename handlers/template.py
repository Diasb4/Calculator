from __future__ import annotations

from telegram import Update
from telegram.ext import ContextTypes

from calculators import calculate_template
from constants import TEMPLATE_ASSIGN_GRADES, TEMPLATE_EXAM_GRADES, TEMPLATE_QUIZ_GRADES, TEMPLATE_WEIGHTS
from i18n import t
from keyboards import nav_keyboard
from utils import parse_float_list, parse_int
from handlers.menu import back_to_menu

MAX_TEMPLATE_VALUES = 50


def _validate_grades(grades: list[float | None]) -> str | None:
    if len(grades) > MAX_TEMPLATE_VALUES:
        return "invalid_too_many"
    if any(g is None for g in grades):
        return "invalid_number"
    if any((g is not None and (g < 0 or g > 100)) for g in grades):
        return "invalid_grade_range"
    return None


async def template_weights(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    parts = update.message.text.strip().split()
    if len(parts) != 3:
        await update.message.reply_text(t(context, "invalid_three"), reply_markup=nav_keyboard(context))
        return TEMPLATE_WEIGHTS

    weights = [parse_int(p) for p in parts]
    if any(w is None or w < 0 or w > 100 for w in weights):
        await update.message.reply_text(t(context, "invalid_weights"), reply_markup=nav_keyboard(context))
        return TEMPLATE_WEIGHTS
    if sum(w for w in weights if w is not None) != 100:
        await update.message.reply_text(t(context, "invalid_weights_sum"), reply_markup=nav_keyboard(context))
        return TEMPLATE_WEIGHTS

    context.user_data["weights"] = weights
    await update.message.reply_text(t(context, "template_assign"), reply_markup=nav_keyboard(context))
    return TEMPLATE_ASSIGN_GRADES


async def template_assign_grades(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    grades = parse_float_list(update.message.text)
    error_key = _validate_grades(grades)
    if error_key == "invalid_too_many":
        await update.message.reply_text(t(context, error_key, max=MAX_TEMPLATE_VALUES), reply_markup=nav_keyboard(context))
        return TEMPLATE_ASSIGN_GRADES
    if error_key:
        await update.message.reply_text(t(context, error_key), reply_markup=nav_keyboard(context))
        return TEMPLATE_ASSIGN_GRADES
    context.user_data["assign_grades"] = grades
    await update.message.reply_text(t(context, "template_quiz"), reply_markup=nav_keyboard(context))
    return TEMPLATE_QUIZ_GRADES


async def template_quiz_grades(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    grades = parse_float_list(update.message.text)
    error_key = _validate_grades(grades)
    if error_key == "invalid_too_many":
        await update.message.reply_text(t(context, error_key, max=MAX_TEMPLATE_VALUES), reply_markup=nav_keyboard(context))
        return TEMPLATE_QUIZ_GRADES
    if error_key:
        await update.message.reply_text(t(context, error_key), reply_markup=nav_keyboard(context))
        return TEMPLATE_QUIZ_GRADES
    context.user_data["quiz_grades"] = grades
    await update.message.reply_text(t(context, "template_exam"), reply_markup=nav_keyboard(context))
    return TEMPLATE_EXAM_GRADES


async def template_exam_grades(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    grades = parse_float_list(update.message.text)
    error_key = _validate_grades(grades)
    if error_key == "invalid_too_many":
        await update.message.reply_text(t(context, error_key, max=MAX_TEMPLATE_VALUES), reply_markup=nav_keyboard(context))
        return TEMPLATE_EXAM_GRADES
    if error_key:
        await update.message.reply_text(t(context, error_key), reply_markup=nav_keyboard(context))
        return TEMPLATE_EXAM_GRADES

    weights = context.user_data["weights"]
    try:
        result = calculate_template(
            assignments_weight=weights[0],
            assignments_grades=context.user_data["assign_grades"],
            quizzes_weight=weights[1],
            quizzes_grades=context.user_data["quiz_grades"],
            exams_weight=weights[2],
            exams_grades=grades,
        )
    except Exception as exc:
        await update.message.reply_text(t(context, "calc_error", err=exc))
        return await back_to_menu(update, context)

    msg = t(
        context,
        "template_result",
        overall=result["overall_total"],
        a=result["assignments"]["weighted_total"],
        q=result["quizzes"]["weighted_total"],
        e=result["exams"]["weighted_total"],
        status=result["status"],
    )
    await update.message.reply_text(msg)
    return await back_to_menu(update, context)

