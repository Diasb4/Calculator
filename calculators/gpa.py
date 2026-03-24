from __future__ import annotations


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

