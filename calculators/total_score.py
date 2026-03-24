from __future__ import annotations


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
