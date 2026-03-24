from __future__ import annotations

from aiogram import F, Router
from aiogram.filters import CommandStart
from aiogram.filters.state import StateFilter
from aiogram.fsm.context import FSMContext
from aiogram.types import CallbackQuery, Message

from calc_modules.registry import get_module
from i18n import t
from keyboards import language_keyboard, menu_keyboard
from states import BaseStates

router = Router()


async def _lang(state: FSMContext) -> str:
    data = await state.get_data()
    return data.get("lang", "ru")


@router.message(CommandStart())
async def start(message: Message, state: FSMContext) -> None:
    data = await state.get_data()
    lang = data.get("lang", "ru")
    if data.get("lang"):
        await state.set_state(BaseStates.menu)
        await message.answer(t(lang, "choose_calc"), reply_markup=menu_keyboard(lang))
        return

    await state.set_state(BaseStates.choosing_language)
    await message.answer(t(lang, "choose_lang"), reply_markup=language_keyboard(lang))


@router.callback_query(F.data.in_({"lang_ru", "lang_en"}))
async def choose_language(callback: CallbackQuery, state: FSMContext) -> None:
    await callback.answer()
    lang = "ru" if callback.data == "lang_ru" else "en"
    await state.update_data(lang=lang)
    await state.set_state(BaseStates.menu)
    await callback.message.edit_text(t(lang, "choose_calc"), reply_markup=menu_keyboard(lang))


@router.callback_query(F.data == "lang")
async def open_language_menu(callback: CallbackQuery, state: FSMContext) -> None:
    await callback.answer()
    lang = await _lang(state)
    await state.set_state(BaseStates.choosing_language)
    await callback.message.edit_text(t(lang, "choose_lang"), reply_markup=language_keyboard(lang))


@router.callback_query(F.data.in_({"back", "cancel"}))
async def nav(callback: CallbackQuery, state: FSMContext) -> None:
    await callback.answer()
    lang = await _lang(state)
    await state.set_state(BaseStates.menu)
    await callback.message.edit_text(t(lang, "choose_calc"), reply_markup=menu_keyboard(lang))


@router.callback_query(StateFilter(BaseStates.menu))
async def menu_choice(callback: CallbackQuery, state: FSMContext) -> None:
    module = get_module(callback.data or "")
    if not module:
        await callback.answer()
        lang = await _lang(state)
        await callback.message.edit_text(t(lang, "choose_calc"), reply_markup=menu_keyboard(lang))
        return

    await module.start(callback, state)
