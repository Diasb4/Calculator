from __future__ import annotations

from telegram import Update
from telegram.ext import ContextTypes

from calculators import calculate_total
from constants import TOTAL_FINAL, TOTAL_HAS_REGTERM, TOTAL_REGEND, TOTAL_REGMID, TOTAL_REGTERM
from i18n import t
from keyboards import nav_keyboard
from utils import parse_float
from handlers.menu import back_to_menu


async def total_has_regterm(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    query = update.callback_query
    await query.answer()
    context.user_data.pop("regterm", None)
    context.user_data.pop("regmid", None)
    context.user_data.pop("regend", None)
    if query.data == "regterm_yes":
        await query.edit_message_text(t(context, "total_regterm"), reply_markup=nav_keyboard(context))
        return TOTAL_REGTERM
    if query.data == "regterm_no":
        await query.edit_message_text(t(context, "total_regmid"), reply_markup=nav_keyboard(context))
        return TOTAL_REGMID
    return await back_to_menu(update, context)


async def total_regterm(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    regterm = parse_float(update.message.text)
    if regterm is None or regterm < 0 or regterm > 100:
        await update.message.reply_text(t(context, "invalid_0_100"), reply_markup=nav_keyboard(context))
        return TOTAL_REGTERM
    context.user_data["regterm"] = regterm
    await update.message.reply_text(t(context, "total_final"), reply_markup=nav_keyboard(context))
    return TOTAL_FINAL


async def total_regmid(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    regmid = parse_float(update.message.text)
    if regmid is None or regmid < 0 or regmid > 100:
        await update.message.reply_text(t(context, "invalid_0_100"), reply_markup=nav_keyboard(context))
        return TOTAL_REGMID
    if regmid < 25:
        await update.message.reply_text(t(context, "regmid_too_low"))
        return await back_to_menu(update, context)
    context.user_data["regmid"] = regmid
    await update.message.reply_text(t(context, "total_regend"), reply_markup=nav_keyboard(context))
    return TOTAL_REGEND


async def total_regend(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    regend = parse_float(update.message.text)
    if regend is None or regend < 0 or regend > 100:
        await update.message.reply_text(t(context, "invalid_0_100"), reply_markup=nav_keyboard(context))
        return TOTAL_REGEND
    if regend < 25:
        await update.message.reply_text(t(context, "regend_too_low"))
        return await back_to_menu(update, context)
    context.user_data["regend"] = regend
    await update.message.reply_text(t(context, "total_final"), reply_markup=nav_keyboard(context))
    return TOTAL_FINAL


async def total_final(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    final = parse_float(update.message.text)
    if final is None or final < 0 or final > 100:
        await update.message.reply_text(t(context, "invalid_0_100"), reply_markup=nav_keyboard(context))
        return TOTAL_FINAL
    if final != 0 and final < 50:
        await update.message.reply_text(t(context, "invalid_50_100_or_0"), reply_markup=nav_keyboard(context))
        return TOTAL_FINAL

    payload = {
        "regterm": context.user_data.get("regterm"),
        "regmid": context.user_data.get("regmid"),
        "regend": context.user_data.get("regend"),
        "final": final,
    }
    try:
        result = calculate_total(**payload)
    except Exception as exc:
        await update.message.reply_text(t(context, "calc_error", err=exc))
        return await back_to_menu(update, context)

    if result["kind"] == "prediction":
        if result.get("fail_reason_key"):
            await update.message.reply_text(t(context, "total_pred_fail", reason=result["fail_reason_key"]))
        else:
            pred = result["prediction"]
            msg = t(
                context,
                "total_pred",
                regterm=result["regterm"],
                **{
                    "pass": pred["min_final_for_pass"],
                    "sch": pred["min_final_for_scholarship"],
                    "high": pred["min_final_for_high_scholarship"],
                },
            )
            await update.message.reply_text(msg)
    else:
        msg = t(context, "total_result", regterm=result["regterm"], total=result["total"], status=result["status"])
        await update.message.reply_text(msg)

    return await back_to_menu(update, context)

