from __future__ import annotations

from aiogram import F, Router
from aiogram.fsm.context import FSMContext
from aiogram.types import CallbackQuery, Message

from calc_modules.base import BotModule
from calculators import calculate_attendance
from i18n import t
from keyboards import menu_keyboard, nav_keyboard
from states import AttendanceStates, BaseStates
from utils import parse_int

router = Router()


async def start(callback: CallbackQuery, state: FSMContext) -> None:
    data = await state.get_data()
    lang = data.get("lang", "ru")
    await callback.answer()
    await callback.message.edit_text(t(lang, "att_lessons"), reply_markup=nav_keyboard(lang))
    await state.set_state(AttendanceStates.lessons)


@router.message(AttendanceStates.lessons, F.text)
async def att_lessons(message: Message, state: FSMContext) -> None:
    data = await state.get_data()
    lang = data.get("lang", "ru")

    lessons = parse_int(message.text or "")
    if lessons is None or lessons < 1 or lessons > 50:
        await message.answer(t(lang, "invalid_1_50"), reply_markup=nav_keyboard(lang))
        return

    try:
        result = calculate_attendance(lessons_per_week=lessons)
    except Exception as exc:
        await message.answer(t(lang, "calc_error", err=exc))
        await state.set_state(BaseStates.menu)
        await message.answer(t(lang, "choose_calc"), reply_markup=menu_keyboard(lang))
        return

    msg = t(
        lang,
        "att_result",
        weeks=result["weeks"],
        per_week=result["lessons_per_week"],
        total=result["total_lessons"],
        missed=result["allowed_missed"],
        percent=result["allowed_percentage"],
    )
    await message.answer(msg)
    await state.set_state(BaseStates.menu)
    await message.answer(t(lang, "choose_calc"), reply_markup=menu_keyboard(lang))


MODULE = BotModule(
    module_id="attendance",
    menu_key="menu_attendance",
    start=start,
    router=router,
)

