from __future__ import annotations

import math


def calculate_attendance(*, lessons_per_week: int, weeks: int = 10, allowed_percentage: int = 30) -> dict:
    total_lessons = lessons_per_week * weeks
    allowed_missed = math.floor(total_lessons * (allowed_percentage / 100))
    return {
        "weeks": weeks,
        "lessons_per_week": lessons_per_week,
        "total_lessons": total_lessons,
        "allowed_percentage": allowed_percentage,
        "allowed_missed": allowed_missed,
    }

