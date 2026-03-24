from __future__ import annotations

from typing import Any

from aiogram import F, Router
from aiogram.fsm.context import FSMContext
from aiogram.types import CallbackQuery, Message

from calc_modules.base import BotModule
from calculators import calculate_cumulative_gpa
from i18n import t
from keyboards import menu_keyboard, nav_keyboard
from states import BaseStates, CumulativeStates
from utils import parse_float, parse_int

router = Router()


async def start(callback: CallbackQuery, state: FSMContext) -> None:
    data = await state.get_data()
    lang = data.get("lang", "ru")
    await callback.answer()
    await callback.message.edit_text(t(lang, "cumulative_count"), reply_markup=nav_keyboard(lang))
    await state.update_data(cum_count=None, cum_terms=[], cum_index=0)
    await state.set_state(CumulativeStates.count)


@router.message(CumulativeStates.count, F.text)
async def cumulative_count(message: Message, state: FSMContext) -> None:
    data = await state.get_data()
    lang = data.get("lang", "ru")

    count = parse_int(message.text or "")
    if count is None or count < 1 or count > 9:
        await message.answer(t(lang, "invalid_1_20"), reply_markup=nav_keyboard(lang))
        return

    await state.update_data(cum_count=count, cum_terms=[], cum_index=0)
    await state.set_state(CumulativeStates.term_gpa)
    await message.answer(t(lang, "cumulative_term_gpa", n=1), reply_markup=nav_keyboard(lang))


@router.message(CumulativeStates.term_gpa, F.text)
async def cumulative_term_gpa(message: Message, state: FSMContext) -> None:
    data = await state.get_data()
    lang = data.get("lang", "ru")

    gpa = parse_float(message.text or "")
    if gpa is None or gpa < 0 or gpa > 4:
        await message.answer(t(lang, "invalid_0_4"), reply_markup=nav_keyboard(lang))
        return

    await state.update_data(cum_current_gpa=gpa)
    await state.set_state(CumulativeStates.term_credits)
    idx = int(data.get("cum_index") or 0)
    await message.answer(t(lang, "cumulative_term_credits", n=idx + 1), reply_markup=nav_keyboard(lang))


@router.message(CumulativeStates.term_credits, F.text)
async def cumulative_term_credits(message: Message, state: FSMContext) -> None:
    data = await state.get_data()
    lang = data.get("lang", "ru")

    credits = parse_float(message.text or "")
    if credits is None or credits <= 0 or credits > 240:
        await message.answer(t(lang, "invalid_credits_range"), reply_markup=nav_keyboard(lang))
        return

    terms: list[dict[str, Any]] = list(data.get("cum_terms") or [])
    index = int(data.get("cum_index") or 0)
    count = int(data.get("cum_count") or 0)
    terms.append({"name": f"Term {index + 1}", "gpa": data["cum_current_gpa"], "credits": credits})

    index += 1
    await state.update_data(cum_terms=terms, cum_index=index)

    if index < count:
        await state.set_state(CumulativeStates.term_gpa)
        await message.answer(t(lang, "cumulative_term_gpa", n=index + 1), reply_markup=nav_keyboard(lang))
        return

    try:
        result = calculate_cumulative_gpa(terms=terms)
    except Exception as exc:
        await message.answer(t(lang, "calc_error", err=exc))
        await state.set_state(BaseStates.menu)
        await message.answer(t(lang, "choose_calc"), reply_markup=menu_keyboard(lang))
        return

    await message.answer(t(lang, "cumulative_result", gpa=result["overall_gpa"], credits=result["total_credits"]))
    await state.set_state(BaseStates.menu)
    await message.answer(t(lang, "choose_calc"), reply_markup=menu_keyboard(lang))


MODULE = BotModule(
    module_id="cumulative",
    menu_key="menu_cumulative",
    start=start,
    router=router,
)

