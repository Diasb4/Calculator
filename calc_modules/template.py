from __future__ import annotations

from aiogram import F, Router
from aiogram.fsm.context import FSMContext
from aiogram.types import CallbackQuery, Message

from calc_modules.base import BotModule
from calculators import calculate_template
from i18n import t
from keyboards import menu_keyboard, nav_keyboard
from states import BaseStates, TemplateStates
from utils import parse_float_list, parse_int

router = Router()

MAX_TEMPLATE_VALUES = 50


def _validate_grades(grades: list[float | None]) -> str | None:
    if len(grades) > MAX_TEMPLATE_VALUES:
        return "invalid_too_many"
    if any(g is None for g in grades):
        return "invalid_number"
    if any((g is not None and (g < 0 or g > 100)) for g in grades):
        return "invalid_grade_range"
    return None


async def start(callback: CallbackQuery, state: FSMContext) -> None:
    data = await state.get_data()
    lang = data.get("lang", "ru")
    await callback.answer()
    await callback.message.edit_text(t(lang, "template_weights"), reply_markup=nav_keyboard(lang))
    await state.set_state(TemplateStates.weights)


@router.message(TemplateStates.weights, F.text)
async def template_weights(message: Message, state: FSMContext) -> None:
    data = await state.get_data()
    lang = data.get("lang", "ru")

    parts = (message.text or "").strip().split()
    if len(parts) != 3:
        await message.answer(t(lang, "invalid_three"), reply_markup=nav_keyboard(lang))
        return

    weights = [parse_int(p) for p in parts]
    if any(w is None or w < 0 or w > 100 for w in weights):
        await message.answer(t(lang, "invalid_weights"), reply_markup=nav_keyboard(lang))
        return
    if sum(w for w in weights if w is not None) != 100:
        await message.answer(t(lang, "invalid_weights_sum"), reply_markup=nav_keyboard(lang))
        return

    await state.update_data(weights=weights)
    await state.set_state(TemplateStates.assign_grades)
    await message.answer(t(lang, "template_assign"), reply_markup=nav_keyboard(lang))


@router.message(TemplateStates.assign_grades, F.text)
async def template_assign_grades(message: Message, state: FSMContext) -> None:
    data = await state.get_data()
    lang = data.get("lang", "ru")

    grades = parse_float_list(message.text or "")
    error_key = _validate_grades(grades)
    if error_key == "invalid_too_many":
        await message.answer(t(lang, error_key, max=MAX_TEMPLATE_VALUES), reply_markup=nav_keyboard(lang))
        return
    if error_key:
        await message.answer(t(lang, error_key), reply_markup=nav_keyboard(lang))
        return

    await state.update_data(assign_grades=grades)
    await state.set_state(TemplateStates.quiz_grades)
    await message.answer(t(lang, "template_quiz"), reply_markup=nav_keyboard(lang))


@router.message(TemplateStates.quiz_grades, F.text)
async def template_quiz_grades(message: Message, state: FSMContext) -> None:
    data = await state.get_data()
    lang = data.get("lang", "ru")

    grades = parse_float_list(message.text or "")
    error_key = _validate_grades(grades)
    if error_key == "invalid_too_many":
        await message.answer(t(lang, error_key, max=MAX_TEMPLATE_VALUES), reply_markup=nav_keyboard(lang))
        return
    if error_key:
        await message.answer(t(lang, error_key), reply_markup=nav_keyboard(lang))
        return

    await state.update_data(quiz_grades=grades)
    await state.set_state(TemplateStates.exam_grades)
    await message.answer(t(lang, "template_exam"), reply_markup=nav_keyboard(lang))


@router.message(TemplateStates.exam_grades, F.text)
async def template_exam_grades(message: Message, state: FSMContext) -> None:
    data = await state.get_data()
    lang = data.get("lang", "ru")

    grades = parse_float_list(message.text or "")
    error_key = _validate_grades(grades)
    if error_key == "invalid_too_many":
        await message.answer(t(lang, error_key, max=MAX_TEMPLATE_VALUES), reply_markup=nav_keyboard(lang))
        return
    if error_key:
        await message.answer(t(lang, error_key), reply_markup=nav_keyboard(lang))
        return

    weights = data.get("weights") or [0, 0, 0]
    try:
        result = calculate_template(
            assignments_weight=weights[0],
            assignments_grades=data.get("assign_grades") or [],
            quizzes_weight=weights[1],
            quizzes_grades=data.get("quiz_grades") or [],
            exams_weight=weights[2],
            exams_grades=grades,
        )
    except Exception as exc:
        await message.answer(t(lang, "calc_error", err=exc))
        await state.set_state(BaseStates.menu)
        await message.answer(t(lang, "choose_calc"), reply_markup=menu_keyboard(lang))
        return

    msg = t(
        lang,
        "template_result",
        overall=result["overall_total"],
        a=result["assignments"]["weighted_total"],
        q=result["quizzes"]["weighted_total"],
        e=result["exams"]["weighted_total"],
        status=result["status"],
    )
    await message.answer(msg)
    await state.set_state(BaseStates.menu)
    await message.answer(t(lang, "choose_calc"), reply_markup=menu_keyboard(lang))


MODULE = BotModule(
    module_id="template",
    menu_key="menu_template",
    start=start,
    router=router,
)

