from __future__ import annotations


def _compute_section_average(grades: list[float | None]) -> tuple[float, int]:
    valid = [g for g in grades if g is not None and 0 <= g <= 100]
    if not valid:
        return 0.0, 0
    return (sum(valid) / len(valid)), len(valid)


def calculate_template(
    *,
    assignments_weight: int,
    assignments_grades: list[float | None],
    quizzes_weight: int,
    quizzes_grades: list[float | None],
    exams_weight: int,
    exams_grades: list[float | None],
) -> dict:
    total_weight = assignments_weight + quizzes_weight + exams_weight
    if total_weight != 100:
        raise ValueError("weights must sum to 100")

    a_avg, a_valid = _compute_section_average(assignments_grades)
    q_avg, q_valid = _compute_section_average(quizzes_grades)
    e_avg, e_valid = _compute_section_average(exams_grades)

    a_total = a_avg * (assignments_weight / 100)
    q_total = q_avg * (quizzes_weight / 100)
    e_total = e_avg * (exams_weight / 100)

    overall = a_total + q_total + e_total
    if overall >= 90:
        status = "excellent"
    elif overall >= 70:
        status = "good"
    elif overall >= 50:
        status = "satisfactory"
    else:
        status = "unsatisfactory"

    return {
        "overall_total": round(overall, 2),
        "assignments": {
            "average_grade": round(a_avg, 2),
            "weighted_total": round(a_total, 2),
            "weight": assignments_weight,
            "valid_components": a_valid,
        },
        "quizzes": {
            "average_grade": round(q_avg, 2),
            "weighted_total": round(q_total, 2),
            "weight": quizzes_weight,
            "valid_components": q_valid,
        },
        "exams": {
            "average_grade": round(e_avg, 2),
            "weighted_total": round(e_total, 2),
            "weight": exams_weight,
            "valid_components": e_valid,
        },
        "status": status,
    }

