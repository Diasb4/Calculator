from __future__ import annotations

from typing import Any

from telegram.ext import ContextTypes


TEXT: dict[str, dict[str, str]] = {
    "ru": {
        "choose_lang": "Выберите язык:",
        "choose_calc": "Выберите калькулятор:",
        "menu_lang": "Язык",
        "menu_gpa": "GPA",
        "menu_attendance": "Посещаемость",
        "menu_total": "Итог",
        "menu_template": "Шаблон",
        "lang_ru": "Русский",
        "lang_en": "English",
        "gpa_count": "Сколько предметов? (1-20)",
        "gpa_name": "Название предмета {n}:",
        "gpa_default_subject": "Предмет {n}",
        "gpa_credits": "Кредиты:",
        "gpa_grade": "Оценка (%) 0-100:",
        "att_lessons": "Сколько пар в неделю? (1-50)",
        "total_has_regterm": "Есть RegTerm напрямую?",
        "total_regterm": "Введите RegTerm (0-100):",
        "total_regmid": "Введите RegMid (0-100):",
        "total_regend": "Введите RegEnd (0-100):",
        "total_final": "Введите Final (50-100) или 0 для прогноза:",
        "template_weights": "Введите веса через пробел (Задания Квизы Экзамены), сумма = 100. Пример: 30 30 40",
        "template_assign": "Оценки Заданий через пробел/запятую (можно пусто):",
        "template_quiz": "Оценки Квизов через пробел/запятую (можно пусто):",
        "template_exam": "Оценки Экзаменов через пробел/запятую (можно пусто):",
        "invalid_1_20": "Введите число от 1 до 20.",
        "invalid_1_50": "Введите число 1-50.",
        "invalid_0_100": "Введите 0-100.",
        "invalid_50_100_or_0": "Введите 50-100 или 0 для прогноза.",
        "invalid_gt0": "Введите корректное число > 0.",
        "invalid_credits_range": "Кредиты должны быть > 0 и не больше 50.",
        "invalid_three": "Введите три числа, например: 30 30 40",
        "invalid_weights": "Веса должны быть 0-100.",
        "invalid_weights_sum": "Сумма весов должна быть 100.",
        "invalid_number": "Некорректное число. Повторите.",
        "invalid_grade_range": "Оценки должны быть в диапазоне 0-100.",
        "invalid_too_many": "Слишком много значений (макс. {max}).",
        "calc_error": "Ошибка расчета: {err}",
        "unhandled_error": "Произошла ошибка. Попробуйте ещё раз.",
        "cancelled": "Отменено.",
        "back": "Назад",
        "cancel": "Отмена",
        "regterm_yes": "Есть RegTerm",
        "regterm_no": "Нет RegTerm",
        "regmid_too_low": "У вас РегМид слишком мал (меньше 25).",
        "regend_too_low": "У вас РегЭнд слишком мал (меньше 25).",
        "gpa_result": "GPA: {gpa}\nСумма кредитов: {credits}",
        "att_result": (
            "За {weeks} недель при {per_week} пар/нед:\n"
            "Всего пар: {total}\n"
            "Можно пропустить: {missed} ({percent}%)"
        ),
        "total_pred_fail": "Прогноз невозможен: {reason}",
        "total_pred": (
            "RegTerm: {regterm}\n"
            "Нужно для прохода: {pass}\n"
            "Нужно для стипендии: {sch}\n"
            "Нужно для повышенной: {high}"
        ),
        "total_result": "RegTerm: {regterm}\nИтого: {total}\nСтатус: {status}",
        "template_result": (
            "Итого: {overall}\n"
            "Задания: {a}\n"
            "Квизы: {q}\n"
            "Экзамены: {e}\n"
            "Статус: {status}"
        ),
    },
    "en": {
        "choose_lang": "Choose language:",
        "choose_calc": "Choose a calculator:",
        "menu_lang": "Language",
        "menu_gpa": "GPA",
        "menu_attendance": "Attendance",
        "menu_total": "Total Score",
        "menu_template": "Template",
        "lang_ru": "Русский",
        "lang_en": "English",
        "gpa_count": "How many subjects? (1-20)",
        "gpa_name": "Subject name {n}:",
        "gpa_default_subject": "Subject {n}",
        "gpa_credits": "Credits:",
        "gpa_grade": "Grade (%) 0-100:",
        "att_lessons": "Lessons per week? (1-50)",
        "total_has_regterm": "Do you have RegTerm directly?",
        "total_regterm": "Enter RegTerm (0-100):",
        "total_regmid": "Enter RegMid (0-100):",
        "total_regend": "Enter RegEnd (0-100):",
        "total_final": "Enter Final (50-100) or 0 for prediction:",
        "template_weights": "Enter weights (Assignments Quizzes Exams), sum = 100. Example: 30 30 40",
        "template_assign": "Assignments grades (space/comma separated, can be empty):",
        "template_quiz": "Quizzes grades (space/comma separated, can be empty):",
        "template_exam": "Exams grades (space/comma separated, can be empty):",
        "invalid_1_20": "Enter a number from 1 to 20.",
        "invalid_1_50": "Enter a number from 1 to 50.",
        "invalid_0_100": "Enter 0-100.",
        "invalid_50_100_or_0": "Enter 50-100 or 0 for prediction.",
        "invalid_gt0": "Enter a valid number > 0.",
        "invalid_credits_range": "Credits must be > 0 and at most 50.",
        "invalid_three": "Enter three numbers, e.g. 30 30 40",
        "invalid_weights": "Weights must be 0-100.",
        "invalid_weights_sum": "Weights must sum to 100.",
        "invalid_number": "Invalid number. Try again.",
        "invalid_grade_range": "Grades must be within 0-100.",
        "invalid_too_many": "Too many values (max {max}).",
        "calc_error": "Calculation error: {err}",
        "unhandled_error": "An error occurred. Please try again.",
        "cancelled": "Cancelled.",
        "back": "Back",
        "cancel": "Cancel",
        "regterm_yes": "Have RegTerm",
        "regterm_no": "No RegTerm",
        "regmid_too_low": "Your RegMid is too low (below 25).",
        "regend_too_low": "Your RegEnd is too low (below 25).",
        "gpa_result": "GPA: {gpa}\nTotal credits: {credits}",
        "att_result": (
            "For {weeks} weeks at {per_week} lessons/week:\n"
            "Total lessons: {total}\n"
            "Allowed missed: {missed} ({percent}%)"
        ),
        "total_pred_fail": "Prediction not available: {reason}",
        "total_pred": (
            "RegTerm: {regterm}\n"
            "Needed to pass: {pass}\n"
            "Needed for scholarship: {sch}\n"
            "Needed for high scholarship: {high}"
        ),
        "total_result": "RegTerm: {regterm}\nTotal: {total}\nStatus: {status}",
        "template_result": (
            "Overall: {overall}\n"
            "Assignments: {a}\n"
            "Quizzes: {q}\n"
            "Exams: {e}\n"
            "Status: {status}"
        ),
    },
}


def lang(context: ContextTypes.DEFAULT_TYPE) -> str:
    return context.user_data.get("lang", "ru")


def t(context: ContextTypes.DEFAULT_TYPE, key: str, **kwargs: Any) -> str:
    template = TEXT[lang(context)][key]
    return template.format(**kwargs)

