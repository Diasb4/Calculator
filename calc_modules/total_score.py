from __future__ import annotations

from aiogram import F, Router
from aiogram.fsm.context import FSMContext
from aiogram.types import CallbackQuery, Message
from aiogram.utils.keyboard import InlineKeyboardBuilder

from calc_modules.base import BotModule
from calculators import calculate_total
from i18n import t
from keyboards import menu_keyboard, nav_keyboard
from states import BaseStates, TotalStates
from utils import parse_float

router = Router()


def _regterm_keyboard(lang: str):
    builder = InlineKeyboardBuilder()
    builder.button(text=t(lang, "regterm_yes"), callback_data="regterm_yes")
    builder.button(text=t(lang, "regterm_no"), callback_data="regterm_no")
    builder.button(text=t(lang, "cancel"), callback_data="cancel")
    builder.adjust(1)
    return builder.as_markup()


async def start(callback: CallbackQuery, state: FSMContext) -> None:
    data = await state.get_data()
    lang = data.get("lang", "ru")
    await callback.answer()
    await state.update_data(regterm=None, regmid=None, regend=None)
    await callback.message.edit_text(t(lang, "total_has_regterm"), reply_markup=_regterm_keyboard(lang))
    await state.set_state(TotalStates.has_regterm)


@router.callback_query(TotalStates.has_regterm, F.data.in_({"regterm_yes", "regterm_no"}))
async def total_has_regterm(callback: CallbackQuery, state: FSMContext) -> None:
    data = await state.get_data()
    lang = data.get("lang", "ru")
    await callback.answer()

    await state.update_data(regterm=None, regmid=None, regend=None)
    if callback.data == "regterm_yes":
        await state.set_state(TotalStates.regterm)
        await callback.message.edit_text(t(lang, "total_regterm"), reply_markup=nav_keyboard(lang))
        return

    await state.set_state(TotalStates.regmid)
    await callback.message.edit_text(t(lang, "total_regmid"), reply_markup=nav_keyboard(lang))


@router.message(TotalStates.regterm, F.text)
async def total_regterm(message: Message, state: FSMContext) -> None:
    data = await state.get_data()
    lang = data.get("lang", "ru")

    regterm = parse_float(message.text or "")
    if regterm is None or regterm < 0 or regterm > 100:
        await message.answer(t(lang, "invalid_0_100"), reply_markup=nav_keyboard(lang))
        return

    await state.update_data(regterm=regterm)
    await state.set_state(TotalStates.final)
    await message.answer(t(lang, "total_final"), reply_markup=nav_keyboard(lang))


@router.message(TotalStates.regmid, F.text)
async def total_regmid(message: Message, state: FSMContext) -> None:
    data = await state.get_data()
    lang = data.get("lang", "ru")

    regmid = parse_float(message.text or "")
    if regmid is None or regmid < 0 or regmid > 100:
        await message.answer(t(lang, "invalid_0_100"), reply_markup=nav_keyboard(lang))
        return
    if regmid < 25:
        await message.answer(t(lang, "regmid_too_low"))
        await state.set_state(BaseStates.menu)
        await message.answer(t(lang, "choose_calc"), reply_markup=menu_keyboard(lang))
        return

    await state.update_data(regmid=regmid)
    await state.set_state(TotalStates.regend)
    await message.answer(t(lang, "total_regend"), reply_markup=nav_keyboard(lang))


@router.message(TotalStates.regend, F.text)
async def total_regend(message: Message, state: FSMContext) -> None:
    data = await state.get_data()
    lang = data.get("lang", "ru")

    regend = parse_float(message.text or "")
    if regend is None or regend < 0 or regend > 100:
        await message.answer(t(lang, "invalid_0_100"), reply_markup=nav_keyboard(lang))
        return
    if regend < 25:
        await message.answer(t(lang, "regend_too_low"))
        await state.set_state(BaseStates.menu)
        await message.answer(t(lang, "choose_calc"), reply_markup=menu_keyboard(lang))
        return

    await state.update_data(regend=regend)
    await state.set_state(TotalStates.final)
    await message.answer(t(lang, "total_final"), reply_markup=nav_keyboard(lang))


@router.message(TotalStates.final, F.text)
async def total_final(message: Message, state: FSMContext) -> None:
    data = await state.get_data()
    lang = data.get("lang", "ru")

    final = parse_float(message.text or "")
    if final is None or final < 0 or final > 100:
        await message.answer(t(lang, "invalid_0_100"), reply_markup=nav_keyboard(lang))
        return
    if final != 0 and final < 50:
        await message.answer(t(lang, "invalid_50_100_or_0"), reply_markup=nav_keyboard(lang))
        return

    payload = {
        "regterm": data.get("regterm"),
        "regmid": data.get("regmid"),
        "regend": data.get("regend"),
        "final": final,
    }

    try:
        result = calculate_total(**payload)
    except Exception as exc:
        await message.answer(t(lang, "calc_error", err=exc))
        await state.set_state(BaseStates.menu)
        await message.answer(t(lang, "choose_calc"), reply_markup=menu_keyboard(lang))
        return

    if result["kind"] == "prediction":
        if result.get("fail_reason_key"):
            await message.answer(t(lang, "total_pred_fail", reason=result["fail_reason_key"]))
        else:
            pred = result["prediction"]
            sch_needed = float(pred["min_final_for_scholarship"])
            high_needed = float(pred["min_final_for_high_scholarship"])
            if sch_needed > 100 and high_needed > 100:
                pred_key = "total_pred_sch_high_unreachable"
            elif sch_needed > 100:
                pred_key = "total_pred_sch_unreachable"
            elif high_needed > 100:
                pred_key = "total_pred_high_unreachable"
            else:
                pred_key = "total_pred"
            msg = t(
                lang,
                pred_key,
                regterm=result["regterm"],
                **{
                    "pass": pred["min_final_for_pass"],
                    "sch": pred["min_final_for_scholarship"],
                    "high": pred["min_final_for_high_scholarship"],
                },
            )
            await message.answer(msg)
    else:
        msg = t(lang, "total_result", regterm=result["regterm"], total=result["total"], status=result["status"])
        await message.answer(msg)

    await state.set_state(BaseStates.menu)
    await message.answer(t(lang, "choose_calc"), reply_markup=menu_keyboard(lang))


MODULE = BotModule(
    module_id="total",
    menu_key="menu_total",
    start=start,
    router=router,
)
