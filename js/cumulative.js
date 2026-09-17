// Генерация полей для триместров
document.getElementById('generate-terms').addEventListener('click', function() {
    const termsCount = Number(document.getElementById('terms-count').value);
    const container = document.getElementById('terms-container');

    if (!Number.isInteger(termsCount) || termsCount < 1 || termsCount > 20) {
        showResult(translationHTML('cumulative_count_error'), 'error');
        return;
    }

    container.innerHTML = '';
    document.getElementById('result').classList.remove('show');

    for (let i = 0; i < termsCount; i++) {
        const termDiv = document.createElement('div');
        termDiv.className = 'subject-input';

        // Используем текущий язык для плейсхолдеров
        const gpaPlaceholder = (typeof translations !== 'undefined' && translations[currentLanguage]?.term_gpa_placeholder) || 'GPA триместра';
        const creditsPlaceholder = (typeof translations !== 'undefined' && translations[currentLanguage]?.term_credits_placeholder) || 'Кредиты';

        termDiv.innerHTML = `
            <input type="number" class="term-gpa" placeholder="${gpaPlaceholder}" data-translate="term_gpa_placeholder" data-translate-type="placeholder" min="0" max="4" step="0.01" value="3.0">
            <input type="number" class="term-credits" placeholder="${creditsPlaceholder}" data-translate="term_credits_placeholder" data-translate-type="placeholder" min="0" step="0.5" value="30">
            <button class="remove-term" data-translate="remove_item" data-translate-type="aria-label">×</button>
        `;
        container.appendChild(termDiv);

        termDiv.querySelector('.remove-term').addEventListener('click', function() {
            container.removeChild(termDiv);
            document.getElementById('result').classList.remove('show');
        });
    }

    document.getElementById('calculate-cumulative').style.display = 'block';
    applyTranslations();
});

// Функция для отображения результата
function showResult(message, type) {
    const resultDiv = document.getElementById('result');
    resultDiv.className = `result ${type} show`;
    resultDiv.innerHTML = `<p>${message}</p>`;
}

// Расчет общего GPA
document.getElementById('calculate-cumulative').addEventListener('click', function() {
    const termInputs = document.querySelectorAll('.subject-input');
    let totalWeighted = 0;
    let totalCredits = 0;
    let hasErrors = false;

    // Формируем таблицу с data-translate атрибутами
    let resultsHTML = `
        <h2 data-translate="cumulative_results">📋 Результаты расчета</h2>
        <table class="subjects-table">
            <thead>
                <tr>
                    <th data-translate="cumulative_term">Триместр</th>
                    <th data-translate="cumulative_gpa">GPA</th>
                    <th data-translate="cumulative_credits">Кредиты</th>
                    <th data-translate="cumulative_weighted">GPA × Кредиты</th>
                </tr>
            </thead>
            <tbody>
    `;

    termInputs.forEach((input, index) => {
        const gpa = parseFloat(input.querySelector('.term-gpa').value);
        const credits = parseFloat(input.querySelector('.term-credits').value);

        // Валидация
        if (isNaN(gpa) || gpa < 0 || gpa > 4) {
            input.querySelector('.term-gpa').style.borderColor = '#dc3545';
            hasErrors = true;
        } else {
            input.querySelector('.term-gpa').style.borderColor = '';
        }

        if (!Number.isFinite(credits) || credits <= 0) {
            input.querySelector('.term-credits').style.borderColor = '#dc3545';
            hasErrors = true;
        } else {
            input.querySelector('.term-credits').style.borderColor = '';
        }

        if (!isNaN(gpa) && gpa >= 0 && gpa <= 4 && Number.isFinite(credits) && credits > 0) {
            const weighted = gpa * credits;
            totalWeighted += weighted;
            totalCredits += credits;

            // Для слова "Триместр" используем условный перевод, так как это динамический номер
            const termLabel = translationHTML('cumulative_term') + ' ' + (index+1);
            resultsHTML += `
                <tr>
                    <td>${termLabel}</td>
                    <td>${gpa.toFixed(2)}</td>
                    <td>${credits}</td>
                    <td>${weighted.toFixed(2)}</td>
                </tr>
            `;
        }
    });

    resultsHTML += `</tbody></table>`;

    if (hasErrors) {
        showResult(translationHTML('cumulative_data_error'), 'error');
        return;
    }

    if (totalCredits === 0) {
        showResult(translationHTML('gpa_insufficient'), 'error');
        return;
    }

    const cumulativeGPA = totalWeighted / totalCredits;

    // Итоговый блок с data-translate для всех текстовых элементов
    resultsHTML += `
        <div class="total-gpa">
            <h3 data-translate="cumulative_total">Общий GPA (средневзвешенный):</h3>
            <div class="gpa-value">${cumulativeGPA.toFixed(2)}</div>
            <p><span data-translate="sigma_gpa_credits">Σ(GPA × кредиты)</span> = ${totalWeighted.toFixed(2)}</p>
            <p><span data-translate="sigma_credits">Σ(кредиты)</span> = ${totalCredits}</p>
            <p>${totalWeighted.toFixed(2)} / ${totalCredits} = ${cumulativeGPA.toFixed(2)}</p>
        </div>
    `;

    const resultDiv = document.getElementById('result');
    resultDiv.className = 'result success show';
    resultDiv.innerHTML = resultsHTML;

    // Применяем переводы к только что вставленному HTML
    if (typeof applyTranslations === 'function') {
        applyTranslations();
    }
    if (typeof window.trackCalculation === 'function') {
        window.trackCalculation('cumulative');
    }
});




// Автоматическая генерация при загрузке
document.addEventListener('DOMContentLoaded', function() {
    document.getElementById('generate-terms').click();
});
