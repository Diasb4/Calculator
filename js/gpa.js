// Переключение темы
document.getElementById('theme-toggle').addEventListener('click', function () {
    document.body.classList.toggle('dark-mode');
    const darkModeText = getTranslation ? (document.body.classList.contains('dark-mode') ? '☀️ Theme' : '🌙 Theme') : (document.body.classList.contains('dark-mode') ? '☀️ Тема' : '🌙 Тема');
    this.textContent = darkModeText;

    // Сохраняем настройку темы в localStorage
    localStorage.setItem('theme', document.body.classList.contains('dark-mode') ? 'dark' : 'light');
});

// Загружаем сохраненную тему
if (localStorage.getItem('theme') === 'dark') {
    document.body.classList.add('dark-mode');
    const darkModeTextButton = getTranslation ? '☀️ Theme' : '☀️ Тема';
    document.getElementById('theme-toggle').textContent = darkModeTextButton;
}

// Функция для определения GPA по проценту
//P.S Привет всем тем кто лазит в моем коде :)
function percentageToGPA(percentage) {
    if (percentage >= 95) return 4.0;
    if (percentage >= 90) return 3.67;
    if (percentage >= 85) return 3.33;
    if (percentage >= 80) return 3.0;
    if (percentage >= 75) return 2.67;
    if (percentage >= 70) return 2.33;
    if (percentage >= 65) return 2.0;
    if (percentage >= 60) return 1.67;
    if (percentage >= 55) return 1.33;
    if (percentage >= 50) return 1.0;
    return 0.0;
}

// Генерация формы для предметов
document.getElementById('generate-subjects').addEventListener('click', function () {
    const subjectsCount = parseInt(document.getElementById('subjects-count').value);
    const container = document.getElementById('subjects-container');

    if (isNaN(subjectsCount) || subjectsCount < 1 || subjectsCount > 20) {
        showResult(getTranslation('gpa_correct_count'), 'error');
        return;
    }

    // Очищаем контейнер
    container.innerHTML = '';

    // Создаем поля для каждого предмета
    for (let i = 0; i < subjectsCount; i++) {
        const subjectDiv = document.createElement('div');
        subjectDiv.className = 'subject-input';
        subjectDiv.innerHTML = `
                    <input type="text" class="subject-name" placeholder="Название предмета ${i + 1}">
                    <input type="number" class="subject-credits" placeholder="Кредиты" min="0" step="0.5" value="">
                    <input type="number" class="subject-grade" placeholder="Оценка (%)" min="0" max="100" value="">
                    <button class="remove-subject">×</button>
                `;
        container.appendChild(subjectDiv);

        // Добавляем обработчик для кнопки удаления
        subjectDiv.querySelector('.remove-subject').addEventListener('click', function () {
            container.removeChild(subjectDiv);
        });
    }

    // Показываем кнопку расчета
    document.getElementById('calculate-gpa').style.display = 'block';
});

// Функция для отображения результата
function showResult(message, type) {
    const resultDiv = document.getElementById('result');
    resultDiv.className = `result ${type} show`;
    resultDiv.innerHTML = `<p>${message}</p>`;
}

// Расчет GPA
document.getElementById('calculate-gpa').addEventListener('click', function () {
    const subjectInputs = document.querySelectorAll('.subject-input');
    let totalWeightedGPA = 0;
    let totalCredits = 0;
    let hasErrors = false;

    // Создаем таблицу для результатов
    let resultsHTML = `
                <h2>📋 Результаты расчета</h2>
                <div class="subjects-table-wrapper">
                    <table class="subjects-table">
                        <thead>
                            <tr>
                                <th>Предмет</th>
                                <th>Кредиты</th>
                                <th>Оценка (%)</th>
                                <th>GPA</th>
                                <th>GPA × Кредиты</th>
                            </tr>
                        </thead>
                        <tbody>
            `;

    // Проверяем каждую строку и рассчитываем GPA
    subjectInputs.forEach((input, index) => {
        const name = input.querySelector('.subject-name').value || `Предмет ${index + 1}`;
        const credits = parseFloat(input.querySelector('.subject-credits').value);
        const grade = parseFloat(input.querySelector('.subject-grade').value);

        // Проверяем валидность данных
        if (isNaN(credits) || credits <= 0) {
            input.querySelector('.subject-credits').style.borderColor = '#dc3545';
            hasErrors = true;
        } else {
            input.querySelector('.subject-credits').style.borderColor = '';
        }

        if (isNaN(grade) || grade < 0 || grade > 100) {
            input.querySelector('.subject-grade').style.borderColor = '#dc3545';
            hasErrors = true;
        } else {
            input.querySelector('.subject-grade').style.borderColor = '';
        }

        // Если данные валидны, добавляем к расчетам
        if (!isNaN(credits) && credits > 0 && !isNaN(grade) && grade >= 0 && grade <= 100) {
            const gpa = percentageToGPA(grade);
            const weightedGPA = gpa * credits;
            totalWeightedGPA += weightedGPA;
            totalCredits += credits;

            // Добавляем строку в таблицу результатов
            resultsHTML += `
                        <tr>
                            <td>${name}</td>
                            <td>${credits}</td>
                            <td>${grade}%</td>
                            <td>${gpa.toFixed(2)}</td>
                            <td>${weightedGPA.toFixed(2)}</td>
                        </tr>
                    `;
        }
    });

    resultsHTML += `</tbody></table></div>`;

    if (hasErrors) {
        showResult(getTranslation('gpa_fill_all'), 'error');
        return;
    }

    if (totalCredits === 0) {
        showResult(getTranslation('gpa_insufficient'), 'error');
        return;
    }

    const overallGPA = totalWeightedGPA / totalCredits;

    // Добавляем общий GPA к результатам
    resultsHTML += `
                <div class="total-gpa">
                    <h3>${getTranslation('gpa_overall')}</h3>
                    <div class="gpa-value">${overallGPA.toFixed(2)}</div>
                    <p>Σ(GPA × кредиты) = ${totalWeightedGPA.toFixed(2)}</p>
                    <p>Σ(кредиты) = ${totalCredits}</p>
                    <p>${totalWeightedGPA.toFixed(2)} / ${totalCredits} = ${overallGPA.toFixed(2)}</p>
                </div>
            `;

    const resultDiv = document.getElementById('result');
    resultDiv.className = 'result success show';
    resultDiv.innerHTML = resultsHTML;
});

// Обработчик нажатия Enter в полях ввода
document.addEventListener('keypress', function (e) {
    if (e.key === 'Enter') {
        document.getElementById('calculate-gpa').click();
    }
});

// Автоматическая генерация формы при загрузке
document.addEventListener('DOMContentLoaded', function () {
    document.getElementById('generate-subjects').click();
});
