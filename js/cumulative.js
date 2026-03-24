
function applyTranslations() {
    const langData = translations[currentLanguage];
    
    // Обновляем все элементы с data-translate
    document.querySelectorAll('[data-translate]').forEach(element => {
        const key = element.getAttribute('data-translate');
        if (langData[key]) {
            if (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA') {
                if (element.getAttribute('data-translate-type') === 'placeholder') {
                    element.placeholder = langData[key];
                }
            } else if (element.tagName === 'OPTION') {
                element.textContent = langData[key];
            } else {
                element.textContent = langData[key];
            }
        }
    });
    
    // Обновляем плейсхолдеры для полей триместров (если они есть)
    document.querySelectorAll('.term-gpa').forEach((el, index) => {
        const base = langData?.term_gpa_placeholder || 'GPA триместра';
        el.placeholder = `${base} ${index+1}`;
    });
    document.querySelectorAll('.term-credits').forEach(el => {
        el.placeholder = langData?.term_credits_placeholder || 'Кредиты';
    });
    
    // Обновляем текст кнопки языка
    updateLanguageButton();
}
// Переключение темы
        document.getElementById('theme-toggle').addEventListener('click', function() {
            document.body.classList.toggle('dark-mode');
            this.textContent = document.body.classList.contains('dark-mode') ? '☀️ Тема' : '🌙 Тема';
            localStorage.setItem('theme', document.body.classList.contains('dark-mode') ? 'dark' : 'light');
        });

        // Загружаем сохраненную тему
        if (localStorage.getItem('theme') === 'dark') {
            document.body.classList.add('dark-mode');
            document.getElementById('theme-toggle').textContent = '☀️ Тема';
        }


function updateTableLanguage() {
    if (!document.getElementById('result').classList.contains('show')) return;
    
    const rows = document.querySelectorAll('.subjects-table tbody tr');
    rows.forEach((row, index) => {
        const firstCell = row.cells[0];
        if (firstCell) {
            const termWord = currentLanguage === 'ru' ? 'Триместр' : 'Trimester';
            firstCell.textContent = termWord + ' ' + (index + 1);
        }
    });
}

// Генерация полей для триместров
document.getElementById('generate-terms').addEventListener('click', function() {
    const termsCount = parseInt(document.getElementById('terms-count').value);
    const container = document.getElementById('terms-container');
    
    if (isNaN(termsCount) || termsCount < 1 || termsCount > 20) {
        showResult('❌ Пожалуйста, введите корректное количество триместров (1-20)', 'error');
        return;
    }
    
    container.innerHTML = '';
    
    for (let i = 0; i < termsCount; i++) {
        const termDiv = document.createElement('div');
        termDiv.className = 'subject-input';
        
        // Используем текущий язык для плейсхолдеров
        const gpaPlaceholder = (typeof translations !== 'undefined' && translations[currentLanguage]?.term_gpa_placeholder) || 'GPA триместра';
        const creditsPlaceholder = (typeof translations !== 'undefined' && translations[currentLanguage]?.term_credits_placeholder) || 'Кредиты';
        
        termDiv.innerHTML = `
            <input type="number" class="term-gpa" placeholder="${gpaPlaceholder} ${i+1}" min="0" max="4" step="0.01" value="3.0">
            <input type="number" class="term-credits" placeholder="${creditsPlaceholder}" min="0" step="0.5" value="30">
            <button class="remove-term">×</button>
        `;
        container.appendChild(termDiv);
        
        termDiv.querySelector('.remove-term').addEventListener('click', function() {
            container.removeChild(termDiv);
        });
    }
    
    document.getElementById('calculate-cumulative').style.display = 'block';
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
        
        if (isNaN(credits) || credits <= 0) {
            input.querySelector('.term-credits').style.borderColor = '#dc3545';
            hasErrors = true;
        } else {
            input.querySelector('.term-credits').style.borderColor = '';
        }
        
        if (!isNaN(gpa) && gpa >= 0 && gpa <= 4 && !isNaN(credits) && credits > 0) {
            const weighted = gpa * credits;
            totalWeighted += weighted;
            totalCredits += credits;
            
            // Для слова "Триместр" используем условный перевод, так как это динамический номер
            const termLabel = (currentLanguage === 'ru' ? 'Триместр' : 'Trimester') + ' ' + (index+1);
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
        showResult('❌ Пожалуйста, проверьте введенные данные. GPA должен быть от 0 до 4, кредиты больше 0.', 'error');
        return;
    }
    
    if (totalCredits === 0) {
        showResult('❌ Недостаточно данных для расчета.', 'error');
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
});




// Автоматическая генерация при загрузке
document.addEventListener('DOMContentLoaded', function() {
    document.getElementById('generate-terms').click();
});