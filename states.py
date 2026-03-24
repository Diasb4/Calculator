from __future__ import annotations

from aiogram.fsm.state import State, StatesGroup


class BaseStates(StatesGroup):
    choosing_language = State()
    menu = State()


class GPAStates(StatesGroup):
    count = State()
    subject_name = State()
    subject_credits = State()
    subject_grade = State()


class AttendanceStates(StatesGroup):
    lessons = State()


class CumulativeStates(StatesGroup):
    count = State()
    term_gpa = State()
    term_credits = State()


class TotalStates(StatesGroup):
    has_regterm = State()
    regterm = State()
    regmid = State()
    regend = State()
    final = State()


class TemplateStates(StatesGroup):
    weights = State()
    assign_grades = State()
    quiz_grades = State()
    exam_grades = State()
