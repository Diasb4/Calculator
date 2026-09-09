// Инициализация при загрузке страницы
document.addEventListener('DOMContentLoaded', function () {
    // Обработчик нажатия Enter в полях ввода
    document.querySelectorAll('input').forEach(input => {
        input.addEventListener('keypress', function (e) {
            if (e.key === 'Enter') {
                calculateAttendance();
            }
        });
    });
});

function calculateAttendance() {
    // Получаем значения из полей ввода
    const lessonsInput = document.getElementById('lessonsPerWeek');
    const missedInput = document.getElementById('alreadyMissed');
    const resultDiv = document.getElementById('result');

    const lessonsPerWeek = Number(lessonsInput.value);
    const allowedPercentage = 30;

    // Проверяем корректность введенных данных
    if (lessonsInput.value.trim() === '') {
        resultDiv.className = 'result danger show';
        resultDiv.innerHTML = `<h2>❌ ${translationHTML('att_error')}</h2><p>${translationHTML('att_please_enter')}</p>`;
        return;
    }

    if (!Number.isInteger(lessonsPerWeek) || lessonsPerWeek < 1 || lessonsPerWeek > 20) {
        resultDiv.className = 'result danger show';
        resultDiv.innerHTML = `<h2>❌ ${translationHTML('att_error')}</h2><p>${translationHTML('att_range_error')}</p>`;
        return;
    }

    let alreadyMissed = 0;
    const hasMissedInput = missedInput && missedInput.value.trim() !== '';
    if (hasMissedInput) {
        const parsedMissed = Number(missedInput.value);
        if (!Number.isInteger(parsedMissed) || parsedMissed < 0 || parsedMissed > 200) {
            resultDiv.className = 'result danger show';
            resultDiv.innerHTML = `<h2>❌ ${translationHTML('att_error')}</h2><p>${translationHTML('att_range_error')}</p>`;
            return;
        }
        alreadyMissed = parsedMissed;
    }

    // Выполняем расчеты
    const totalLessons = lessonsPerWeek * 10;
    const allowedMissed = Math.floor(totalLessons * (allowedPercentage / 100));
    const currentPercent = totalLessons > 0 ? (alreadyMissed / totalLessons) * 100 : 0;
    const remainingSafe = allowedMissed - alreadyMissed;

    let statusClass = 'success';
    let statusText = 'att_status_safe';

    if (hasMissedInput) {
        if (alreadyMissed > allowedMissed || currentPercent >= 30) {
            statusClass = 'danger';
            statusText = 'att_status_danger';
        } else if (currentPercent > 15 || remainingSafe <= 1) {
            statusClass = 'warning';
            statusText = 'att_status_warning';
        }
    }

    // Формируем результат
    resultDiv.className = `result ${statusClass} show`;

    let statusBadgeHTML = '';
    if (hasMissedInput) {
        statusBadgeHTML = `
        <div class="att-status-badge ${statusClass}">
            <span class="att-status-text">${translationHTML(statusText)}</span>
            <div class="att-details-row">
                <span>${translationHTML('att_current_percent')} <strong>${currentPercent.toFixed(1)}%</strong></span>
                <span>${translationHTML('att_remaining_safe')} <strong>${remainingSafe >= 0 ? remainingSafe : 0}</strong></span>
            </div>
        </div>`;
    }

    const markerPos = Math.min(98, Math.max(2, (alreadyMissed / (totalLessons * 0.4 || 1)) * 100));

    const progressMeterHTML = `
    <div class="att-meter-container" aria-label="Attendance scale">
        <div class="att-meter-title">${translationHTML('att_visual_scale_title')}</div>
        <div class="att-bar-track">
            <div class="att-zone att-zone-safe" style="width: 37.5%;" title="${escapeHTML(getTranslation('att_scale_safe'))}"></div>
            <div class="att-zone att-zone-warning" style="width: 37.5%;" title="${escapeHTML(getTranslation('att_scale_warning'))}"></div>
            <div class="att-zone att-zone-danger" style="width: 25%;" title="${escapeHTML(getTranslation('att_scale_danger'))}"></div>
            ${hasMissedInput ? `<div class="att-current-marker" style="left: ${markerPos}%;" title="${alreadyMissed} / ${totalLessons}">📍</div>` : ''}
        </div>
        <div class="att-scale-labels">
            <span>0%</span>
            <span>15%</span>
            <span class="att-limit-label">30% (${allowedMissed} max)</span>
            <span>40%+</span>
        </div>
    </div>`;

    const resultHTML = `
        <h2>${translationHTML('att_done')}</h2>
        <p>${translationHTML('att_summary', { weekly: lessonsPerWeek })}</p>
        <p class="highlight">${translationHTML('att_missed', { count: allowedMissed })}</p>
        ${statusBadgeHTML}
        ${progressMeterHTML}
        <div class="calculation">
            <h3>${translationHTML('att_how')}</h3>
            <p>1. ${translationHTML('att_total')} ${lessonsPerWeek} × 10 = ${totalLessons}</p>
            <p>2. ${translationHTML('att_percentage')} ${allowedPercentage}%</p>
            <p>3. ${translationHTML('att_calculation')} ${totalLessons} × ${allowedPercentage}% = ${(totalLessons * allowedPercentage / 100).toFixed(2)}</p>
            <p>4. ${translationHTML('att_rounding')} ${allowedMissed}</p>
        </div>
        <div class="info">${translationHTML('att_note')}</div>`;

    resultDiv.innerHTML = resultHTML;
}

