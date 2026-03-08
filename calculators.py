from __future__ import annotations

import math


def _percentage_to_gpa(percentage: float) -> float:
    if percentage >= 95:
        return 4.0
    if percentage >= 90:
        return 3.67
    if percentage >= 85:
        return 3.33
    if percentage >= 80:
        return 3.0
    if percentage >= 75:
        return 2.67
    if percentage >= 70:
        return 2.33
    if percentage >= 65:
        return 2.0
    if percentage >= 60:
        return 1.67
    if percentage >= 55:
        return 1.33
    if percentage >= 50:
        return 1.0
    return 0.0


def calculate_gpa(*, subjects: list[dict]) -> dict:
    total_weighted_gpa = 0.0
    total_credits = 0.0
    out_subjects: list[dict] = []

    for idx, subj in enumerate(subjects):
        credits = float(subj["credits"])
        grade = float(subj["grade"])
        name = subj.get("name") or f"Subject {idx + 1}"

        gpa = _percentage_to_gpa(grade)
        weighted = gpa * credits

        total_weighted_gpa += weighted
        total_credits += credits
        out_subjects.append(
            {
                "name": name,
                "credits": credits,
                "grade": grade,
                "gpa": round(gpa, 2),
                "weighted_gpa": round(weighted, 2),
            }
        )

    if total_credits == 0:
        raise ValueError("total credits must be > 0")

    overall = total_weighted_gpa / total_credits
    return {
        "total_weighted_gpa": round(total_weighted_gpa, 2),
        "total_credits": total_credits,
        "overall_gpa": round(overall, 2),
        "subjects": out_subjects,
    }


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


def _regterm_from_payload(regmid: float | None, regend: float | None, regterm: float | None) -> tuple[float, str]:
    if regterm is not None:
        return regterm, "direct"
    if regmid is None or regend is None:
        raise ValueError("regmid and regend are required when regterm is not provided")
    return (regmid + regend) / 2, "computed"


def calculate_total(
    *,
    regmid: float | None = None,
    regend: float | None = None,
    regterm: float | None = None,
    final: float | None = None,
) -> dict:
    regterm_value, regterm_source = _regterm_from_payload(regmid, regend, regterm)

    if final is None or final == 0:
        if regterm_source == "computed":
            if regmid is not None and regmid < 25:
                return {
                    "kind": "prediction",
                    "regterm": round(regterm_value, 2),
                    "regterm_source": regterm_source,
                    "fail_reason_key": "regmid_below_25",
                }
            if regend is not None and regend < 25:
                return {
                    "kind": "prediction",
                    "regterm": round(regterm_value, 2),
                    "regterm_source": regterm_source,
                    "fail_reason_key": "regend_below_25",
                }

        if regterm_value < 50:
            return {
                "kind": "prediction",
                "regterm": round(regterm_value, 2),
                "regterm_source": regterm_source,
                "fail_reason_key": "regterm_below_50",
            }

        if regterm_source == "direct":
            reg_score = regterm_value * 0.6
        else:
            reg_score = (regmid * 0.3) + (regend * 0.3)  # type: ignore[operator]

        min_for_pass = max(50, (50 - reg_score) / 0.4)
        min_for_scholarship = max(50, (70 - reg_score) / 0.4)
        min_for_high_scholarship = max(50, (90 - reg_score) / 0.4)

        return {
            "kind": "prediction",
            "regterm": round(regterm_value, 2),
            "regterm_source": regterm_source,
            "prediction": {
                "reg_score": round(reg_score, 2),
                "min_final_for_pass": round(min_for_pass, 2),
                "min_final_for_scholarship": round(min_for_scholarship, 2),
                "min_final_for_high_scholarship": round(min_for_high_scholarship, 2),
            },
        }

    if regterm_source == "direct":
        total = (regterm_value * 0.6) + (final * 0.4)
    else:
        total = (regmid * 0.3) + (regend * 0.3) + (final * 0.4)  # type: ignore[operator]

    failed_by_components = False
    if regterm_source == "computed":
        if regmid is not None and regend is not None and (regmid < 25 or regend < 25):
            failed_by_components = True

    if regterm_value < 50 or final < 25 or total < 50 or failed_by_components:
        status = "failed"
    elif 25 <= final < 50:
        status = "retake"
    elif total < 70:
        status = "pass"
    elif total >= 90:
        status = "high_scholarship"
    else:
        status = "scholarship"

    return {
        "kind": "result",
        "regterm": round(regterm_value, 2),
        "regterm_source": regterm_source,
        "total": round(total, 2),
        "status": status,
        "failed_by_components": failed_by_components,
    }


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

