// Инициализация при загрузке страницы
document.addEventListener('DOMContentLoaded', function () {
    // Управление темной темой
    const toggle = document.getElementById("theme-toggle");
    const body = document.body;

    // Проверяем сохраненную тему
    if (localStorage.getItem("theme") === "dark") {
        body.classList.add("dark-mode");
        const darkModeText = getTranslation ? '☀️ Theme' : '☀️ Тема';
        toggle.textContent = darkModeText;
    } else {
        const lightModeText = getTranslation ? '🌙 Theme' : '🌙 Тема';
        toggle.textContent = lightModeText;
    }

    // Обработчик переключения темы
    toggle.addEventListener("click", () => {
        body.classList.toggle("dark-mode");

        if (body.classList.contains("dark-mode")) {
            const darkModeText = getTranslation ? '☀️ Theme' : '☀️ Тема';
            toggle.textContent = darkModeText;
            localStorage.setItem("theme", "dark");
        } else {
            const lightModeText = getTranslation ? '🌙 Theme' : '🌙 Тема';
            toggle.textContent = lightModeText;
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
        resultDiv.innerHTML = `<h2>❌ ${getTranslation('att_error')}</h2><p>${getTranslation('att_please_enter')}</p>`;
        return;
    }

    if (lessonsPerWeek < 1 || lessonsPerWeek > 50) {
        resultDiv.className = 'result danger show';
        resultDiv.innerHTML = `<h2>❌ ${getTranslation('att_error')}</h2><p>${getTranslation('att_range_error')}</p>`;
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
    resultHTML += `<strong>Примечание:</strong> ${getTranslation('att_note')}`;
    resultHTML += '</div>';

    resultDiv.innerHTML = resultHTML;
}
function revealSecret() {
    const secrets = [
        "Пасхалка! Ты нашел секрет! 🥚",
        "Разработчик этого калькулятора тоже иногда заваливает экзамены 😅",
        "Знаешь ли ты, что первый калькулятор был создан в 17 веке?",
        "Ты - 1 из 1000 пользователей, который нашел эту пасхалку!",
        "Мои поздравления пасхантер, может и на других страницах что то есть?)",
        "Функция 'автоматического прохождения экзамена' еще в разработке...",
        "Знаете, почему калькулятор такой точный? Он не списывал на экзаменах!",
        "Если бы этот калькулятор был студентом, у него была бы стипендия!",
        "Секрет успеха: 10% везение, 20% навыки, 70% этот калькулятор!",
        "Предупреждение: чрезмерное использование калькулятора может привести к... хорошим оценкам!",
        "Знаете разницу между студентом и этим калькулятором? Калькулятор всегда считает правильно!",
        "Факт: 100% пользователей этого калькулятора успешно отвлекаются от учебы!",
        "Секретная формула: сон + еда + этот калькулятор = успешная сессия!",
        "Разработчик был здесь 🐛",
        "Это сообщение самоликвидируется через 5... 4... 3... шучу!",
        "Пасхалка уровня 'я должен был учиться, но ищу пасхалки'",
        "Поздравляю! Вы нашли оправдание не готовиться к экзамену!",
        "Инсайдерская информация: преподы тоже пользуются калькуляторами!",
        "Секретный ингредиент хорошей оценки - уверенность (и этот калькулятор)",
        "Функция 'автопропуск пар' временно отключена... к сожалению",
        "Знаете, что общего у этого калькулятора и хорошей оценки? Оба требуют правильных входных данных!",
        "Внимание! Обнаружена корреляция между использованием калькулятора и снижением уровня паники!"
    ];

    const randomSecret = secrets[Math.floor(Math.random() * secrets.length)];

    // Создаем красивый тост
    const toast = document.createElement('div');
    toast.textContent = randomSecret;
    toast.style.cssText = `
        position: fixed;
        bottom: 20px;
        right: 20px;
        background: #333;
        color: white;
        padding: 15px 20px;
        border-radius: 10px;
        z-index: 10000;
        box-shadow: 0 5px 15px rgba(0,0,0,0.3);
        animation: toastSlideIn 0.5s ease;
        max-width: 300px;
        text-align: center;
    `;

    document.body.appendChild(toast);

    setTimeout(() => {
        toast.style.animation = 'toastSlideOut 0.5s ease forwards';
        setTimeout(() => {
            document.body.removeChild(toast);
        }, 500);
    }, 4000);
}

// Добавьте анимации для тоста
const toastStyles = `
@keyframes toastSlideIn {
    from { transform: translateX(100%); opacity: 0; }
    to { transform: translateX(0); opacity: 1; }
}

@keyframes toastSlideOut {
    from { transform: translateX(0); opacity: 1; }
    to { transform: translateX(100%); opacity: 0; }
}
`;
document.head.insertAdjacentHTML('beforeend', `<style>${toastStyles}</style>`);