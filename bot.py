from __future__ import annotations

import os

from dotenv import load_dotenv
from telegram.ext import (
    Application,
    CallbackQueryHandler,
    CommandHandler,
    ConversationHandler,
    MessageHandler,
    filters,
)

from constants import (
    ATT_LESSONS,
    GPA_COUNT,
    GPA_SUBJECT_CREDITS,
    GPA_SUBJECT_GRADE,
    GPA_SUBJECT_NAME,
    LANG,
    MENU,
    TEMPLATE_ASSIGN_GRADES,
    TEMPLATE_EXAM_GRADES,
    TEMPLATE_QUIZ_GRADES,
    TEMPLATE_WEIGHTS,
    TOTAL_FINAL,
    TOTAL_HAS_REGTERM,
    TOTAL_REGEND,
    TOTAL_REGMID,
    TOTAL_REGTERM,
)
from handlers.attendance import att_lessons
from handlers.gpa import gpa_count, gpa_subject_credits, gpa_subject_grade, gpa_subject_name
from handlers.menu import cancel, choose_language, handle_nav, menu_choice, on_error, start
from handlers.template import template_assign_grades, template_exam_grades, template_quiz_grades, template_weights
from handlers.total import total_final, total_has_regterm, total_regend, total_regmid, total_regterm


load_dotenv()


def main() -> None:
    token = os.getenv("BOT_TOKEN")
    if not token:
        raise RuntimeError("BOT_TOKEN is not set")

    app = Application.builder().token(token).build()
    app.add_error_handler(on_error)

    conv = ConversationHandler(
        entry_points=[CommandHandler("start", start)],
        states={
            LANG: [
                CallbackQueryHandler(handle_nav, pattern="^(back|cancel)$"),
                CallbackQueryHandler(choose_language, pattern="^lang_"),
            ],
            MENU: [
                CallbackQueryHandler(choose_language, pattern="^lang_"),
                CallbackQueryHandler(menu_choice),
            ],
            GPA_COUNT: [
                CallbackQueryHandler(handle_nav, pattern="^(back|cancel)$"),
                MessageHandler(filters.TEXT & ~filters.COMMAND, gpa_count),
            ],
            GPA_SUBJECT_NAME: [
                CallbackQueryHandler(handle_nav, pattern="^(back|cancel)$"),
                MessageHandler(filters.TEXT & ~filters.COMMAND, gpa_subject_name),
            ],
            GPA_SUBJECT_CREDITS: [
                CallbackQueryHandler(handle_nav, pattern="^(back|cancel)$"),
                MessageHandler(filters.TEXT & ~filters.COMMAND, gpa_subject_credits),
            ],
            GPA_SUBJECT_GRADE: [
                CallbackQueryHandler(handle_nav, pattern="^(back|cancel)$"),
                MessageHandler(filters.TEXT & ~filters.COMMAND, gpa_subject_grade),
            ],
            ATT_LESSONS: [
                CallbackQueryHandler(handle_nav, pattern="^(back|cancel)$"),
                MessageHandler(filters.TEXT & ~filters.COMMAND, att_lessons),
            ],
            TOTAL_HAS_REGTERM: [
                CallbackQueryHandler(handle_nav, pattern="^(back|cancel)$"),
                CallbackQueryHandler(total_has_regterm, pattern="^(regterm_yes|regterm_no)$"),
            ],
            TOTAL_REGTERM: [
                CallbackQueryHandler(handle_nav, pattern="^(back|cancel)$"),
                MessageHandler(filters.TEXT & ~filters.COMMAND, total_regterm),
            ],
            TOTAL_REGMID: [
                CallbackQueryHandler(handle_nav, pattern="^(back|cancel)$"),
                MessageHandler(filters.TEXT & ~filters.COMMAND, total_regmid),
            ],
            TOTAL_REGEND: [
                CallbackQueryHandler(handle_nav, pattern="^(back|cancel)$"),
                MessageHandler(filters.TEXT & ~filters.COMMAND, total_regend),
            ],
            TOTAL_FINAL: [
                CallbackQueryHandler(handle_nav, pattern="^(back|cancel)$"),
                MessageHandler(filters.TEXT & ~filters.COMMAND, total_final),
            ],
            TEMPLATE_WEIGHTS: [
                CallbackQueryHandler(handle_nav, pattern="^(back|cancel)$"),
                MessageHandler(filters.TEXT & ~filters.COMMAND, template_weights),
            ],
            TEMPLATE_ASSIGN_GRADES: [
                CallbackQueryHandler(handle_nav, pattern="^(back|cancel)$"),
                MessageHandler(filters.TEXT & ~filters.COMMAND, template_assign_grades),
            ],
            TEMPLATE_QUIZ_GRADES: [
                CallbackQueryHandler(handle_nav, pattern="^(back|cancel)$"),
                MessageHandler(filters.TEXT & ~filters.COMMAND, template_quiz_grades),
            ],
            TEMPLATE_EXAM_GRADES: [
                CallbackQueryHandler(handle_nav, pattern="^(back|cancel)$"),
                MessageHandler(filters.TEXT & ~filters.COMMAND, template_exam_grades),
            ],
        },
        fallbacks=[CommandHandler("cancel", cancel)],
    )

    app.add_handler(conv)
    app.run_polling()


if __name__ == "__main__":
    main()

