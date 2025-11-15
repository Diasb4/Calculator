// Инициализация при загрузке страницы
document.addEventListener('DOMContentLoaded', function () {
    // Управление темной темой
    const toggle = document.getElementById("theme-toggle");
    const body = document.body;

    // Проверяем сохраненную тему
    if (localStorage.getItem("theme") === "dark") {
        body.classList.add("dark-mode");
        toggle.textContent = "☀️ Тема";
    } else {
        toggle.textContent = "🌙 Тема";
    }

    // Обработчик переключения темы
    toggle.addEventListener("click", () => {
        body.classList.toggle("dark-mode");

        if (body.classList.contains("dark-mode")) {
            toggle.textContent = "☀️ Тема";
            localStorage.setItem("theme", "dark");
        } else {
            toggle.textContent = "🌙 Тема";
            localStorage.setItem("theme", "light");
        }
    });

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
    const lessonsPerWeek = parseInt(document.getElementById('lessonsPerWeek').value);
    const resultDiv = document.getElementById('result');

    // Фиксированный процент пропусков
    const allowedPercentage = 30;

    // Проверяем корректность введенных данных
    if (isNaN(lessonsPerWeek)) {
        resultDiv.className = 'result danger show';
        resultDiv.innerHTML = `<h2>❌ Ошибка</h2><p>Пожалуйста, введите количество пар в неделю.</p>`;
        return;
    }

    if (lessonsPerWeek < 1 || lessonsPerWeek > 50) {
        resultDiv.className = 'result danger show';
        resultDiv.innerHTML = `<h2>❌ Ошибка</h2><p>Количество пар должно быть от 1 до 50.</p>`;
        return;
    }

    // Выполняем расчеты
    const totalLessons = lessonsPerWeek * 10;
    const allowedMissed = Math.floor(totalLessons * (allowedPercentage / 100));

    // Формируем результат
    resultDiv.className = `result success show`;

    let resultHTML = '<h2>✅ Расчет завершен</h2>';
    resultHTML += `<p>За 10 недель семестра при <span class="highlight">${lessonsPerWeek}</span> парах в неделю:</p>`;
    resultHTML += `<p>Вы можете пропустить <span class="highlight">${allowedMissed}</span> пар.</p>`;

    resultHTML += '<div class="calculation">';
    resultHTML += '<h3>Как это рассчитывается:</h3>';
    resultHTML += `<p>1. Всего пар за 10 недель: <span class="highlight">${lessonsPerWeek} × 10 = ${totalLessons}</span></p>`;
    resultHTML += `<p>2. Допустимый процент пропусков: <span class="highlight">${allowedPercentage}%</span></p>`;
    resultHTML += `<p>3. Расчет: <span class="highlight">${totalLessons} × ${allowedPercentage}% = ${(totalLessons * (allowedPercentage / 100)).toFixed(2)}</span></p>`;
    resultHTML += `<p>4. Округление до целого числа: <span class="highlight">${allowedMissed}</span></p>`;
    resultHTML += '</div>';

    resultHTML += '<div class="info">';
    resultHTML += '<strong>Примечание:</strong> Фактическое количество допустимых пропусков может зависеть от конкретного предмета, сверьтесь с силлабусом данного курса.';
    resultHTML += '</div>';

    resultDiv.innerHTML = resultHTML;
}