from __future__ import annotations

from typing import Any

from aiogram import F, Router
from aiogram.fsm.context import FSMContext
from aiogram.types import CallbackQuery, Message

from calc_modules.base import BotModule
from calculators import calculate_gpa
from i18n import t
from keyboards import menu_keyboard, nav_keyboard
from states import BaseStates, GPAStates
from utils import parse_float, parse_int

router = Router()


async def start(callback: CallbackQuery, state: FSMContext) -> None:
    data = await state.get_data()
    lang = data.get("lang", "ru")
    await callback.answer()
    await callback.message.edit_text(t(lang, "gpa_count"), reply_markup=nav_keyboard(lang))
    await state.update_data(gpa_count=None, gpa_subjects=[], gpa_index=0)
    await state.set_state(GPAStates.count)


@router.message(GPAStates.count, F.text)
async def gpa_count(message: Message, state: FSMContext) -> None:
    data = await state.get_data()
    lang = data.get("lang", "ru")

    count = parse_int(message.text or "")
    if count is None or count < 1 or count > 20:
        await message.answer(t(lang, "invalid_1_20"), reply_markup=nav_keyboard(lang))
        return

    await state.update_data(gpa_count=count, gpa_subjects=[], gpa_index=0)
    await state.set_state(GPAStates.subject_name)
    await message.answer(t(lang, "gpa_name", n=1), reply_markup=nav_keyboard(lang))


@router.message(GPAStates.subject_name, F.text)
async def gpa_subject_name(message: Message, state: FSMContext) -> None:
    data = await state.get_data()
    lang = data.get("lang", "ru")
    await state.update_data(gpa_current_name=(message.text or "").strip()[:80])
    await state.set_state(GPAStates.subject_credits)
    await message.answer(t(lang, "gpa_credits"), reply_markup=nav_keyboard(lang))


@router.message(GPAStates.subject_credits, F.text)
async def gpa_subject_credits(message: Message, state: FSMContext) -> None:
    data = await state.get_data()
    lang = data.get("lang", "ru")

    credits = parse_float(message.text or "")
    if credits is None or credits <= 0 or credits > 50:
        await message.answer(t(lang, "invalid_credits_range"), reply_markup=nav_keyboard(lang))
        return

    await state.update_data(gpa_current_credits=credits)
    await state.set_state(GPAStates.subject_grade)
    await message.answer(t(lang, "gpa_grade"), reply_markup=nav_keyboard(lang))


@router.message(GPAStates.subject_grade, F.text)
async def gpa_subject_grade(message: Message, state: FSMContext) -> None:
    data = await state.get_data()
    lang = data.get("lang", "ru")

    grade = parse_float(message.text or "")
    if grade is None or grade < 0 or grade > 100:
        await message.answer(t(lang, "invalid_0_100"), reply_markup=nav_keyboard(lang))
        return

    subjects: list[dict[str, Any]] = list(data.get("gpa_subjects") or [])
    index = int(data.get("gpa_index") or 0)
    count = int(data.get("gpa_count") or 0)
    subject_name = (data.get("gpa_current_name") or "").strip() or t(lang, "gpa_default_subject", n=index + 1)
    subjects.append({"name": subject_name, "credits": data["gpa_current_credits"], "grade": grade})

    index += 1
    await state.update_data(gpa_subjects=subjects, gpa_index=index)

    if index < count:
        await state.set_state(GPAStates.subject_name)
        await message.answer(t(lang, "gpa_name", n=index + 1), reply_markup=nav_keyboard(lang))
        return

    try:
        result = calculate_gpa(subjects=subjects)
    except Exception as exc:
        await message.answer(t(lang, "calc_error", err=exc))
        await state.set_state(BaseStates.menu)
        await message.answer(t(lang, "choose_calc"), reply_markup=menu_keyboard(lang))
        return

    await message.answer(t(lang, "gpa_result", gpa=result["overall_gpa"], credits=result["total_credits"]))
    await state.set_state(BaseStates.menu)
    await message.answer(t(lang, "choose_calc"), reply_markup=menu_keyboard(lang))


MODULE = BotModule(
    module_id="gpa",
    menu_key="menu_gpa",
    start=start,
    router=router,
)

