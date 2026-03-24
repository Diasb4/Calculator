from __future__ import annotations


def calculate_cumulative_gpa(*, terms: list[dict]) -> dict:
    total_weighted = 0.0
    total_credits = 0.0
    out_terms: list[dict] = []

    for idx, term in enumerate(terms):
        credits = float(term["credits"])
        gpa = float(term["gpa"])
        name = term.get("name") or f"Term {idx + 1}"

        if credits <= 0:
            raise ValueError("credits must be > 0")
        if gpa < 0 or gpa > 4:
            raise ValueError("gpa must be within 0..4")

        weighted = gpa * credits
        total_weighted += weighted
        total_credits += credits
        out_terms.append(
            {
                "name": name,
                "credits": credits,
                "gpa": round(gpa, 2),
                "weighted_gpa": round(weighted, 2),
            }
        )

    if total_credits == 0:
        raise ValueError("total credits must be > 0")

    overall = total_weighted / total_credits
    return {
        "total_weighted_gpa": round(total_weighted, 2),
        "total_credits": total_credits,
        "overall_gpa": round(overall, 2),
        "terms": out_terms,
    }

