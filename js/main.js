// Добавляем анимацию появления карточек и инициализируем обработчики
document.addEventListener('DOMContentLoaded', function () {
    const cards = document.querySelectorAll('.option-card');
    cards.forEach((card, index) => {
        card.style.opacity = '0';
        card.style.transform = 'translateY(20px)';

        setTimeout(() => {
            card.style.transition = 'all 0.5s ease';
            card.style.opacity = '1';
            card.style.transform = 'translateY(0)';
        }, index * 200);
    });

    // Управление темной темой
    const toggle = document.getElementById("theme-toggle");
    const body = document.body;

    // Проверяем сохраненную тему
    if (localStorage.getItem("theme") === "dark") {
        body.classList.add("dark-mode");
    }

    // Обработчик переключения темы
    if (toggle) {
        toggle.addEventListener("click", () => {
            body.classList.toggle("dark-mode");

            if (body.classList.contains("dark-mode")) {
                localStorage.setItem("theme", "dark");
            } else {
                localStorage.setItem("theme", "light");
            }
        });
    }

    // Специальные пасхалки для разных действий
    let clickCount = 0;
    let lastClickTime = 0;

    // Пасхалка по тройному клику на заголовок
    const h1 = document.querySelector('h1');
    if (h1) {
        h1.addEventListener('click', function () {
            const currentTime = new Date().getTime();

            if (currentTime - lastClickTime < 500) {
                clickCount++;
            } else {
                clickCount = 1;
            }

            lastClickTime = currentTime;

            if (clickCount === 3) {
                showSpecialToast("🎉 Тройной клик! Ты явно заскучал на парах!");
                clickCount = 0;
            }
        });
    }

    // Пасхалка при наведении на подзаголовок
    const subtitle = document.querySelector('.subtitle');
    if (subtitle) {
        subtitle.addEventListener('mouseover', function () {
            if (!this.dataset.easterShown) {
                setTimeout(() => {
                    showSpecialToast("👀 Ты что, ищешь скрытый смысл? Его нет!");
                    this.dataset.easterShown = true;
                }, 2000);
            }
        });
    }

    // Пасхалка при быстром переключении темы
    let themeSwitchCount = 0;
    let themeSwitchTimer;

    if (toggle) {
        toggle.addEventListener('click', function () {
            themeSwitchCount++;

            if (!themeSwitchTimer) {
                themeSwitchTimer = setTimeout(() => {
                    if (themeSwitchCount >= 5) {
                        showSpecialToast("🎨 Художник? Так быстро переключаешь темы!");
                    }
                    themeSwitchCount = 0;
                    clearTimeout(themeSwitchTimer);
                    themeSwitchTimer = null;
                }, 3000);
            }
        });
    }
});

function revealSecret() {
    const secrets = [
        "Пасхалка! Ты нашел секрет! 🥚",
        "Разработчик этого калькулятора тоже иногда заваливает экзамены 😅",
        "Знаешь ли ты, что первый калькулятор был создан в 17 веке?",
        "Этот калькулятор был сделан с ♥ и большим количеством кофе ☕",
        "Секретный совет: всегда проверяйте расчеты вручную!",
        "Ты - 1 из 1000 пользователей, который нашел эту пасхалку!",
        "Мои поздравления пасхантер, может и на других страницах что то есть?)",
        "Функция 'автоматического прохождения экзамена' еще в разработке...",
        "Знаете, почему калькулятор такой точный? Он не списывал на экзаменах!",
        "Если бы этот калькулятор был студентом, у него была бы стипендия!",
        "Интересный факт: 87% студентов находят пасхалки во время подготовки к экзаменам",
        "Пссс... между нами, РегМид весит 30%, но все делают вид, что это не так",
        "Разработчик рекомендует: одна пасхалка в день - и сессия не страшна!",
        getTranslation('secret_leak'),
        getTranslation('secret_hack'),
        getTranslation('secret_success'),
        getTranslation('secret_warning'),
        getTranslation('secret_difference'),
        "Факт: 100% пользователей этого калькулятора успешно отвлекаются от учебы!",
        "Секретная формула: сон + еда + этот калькулятор = успешная сессия!",
        "Разработчик был здесь 🐛",
        "Это сообщение самоликвидируется через 5... 4... 3... шучу!",
        "Пасхалка уровня 'я должен был учиться, но ищу пасхалки'",
        getTranslation('secret_excuse'),
        "Инсайдерская информация: преподы тоже пользуются калькуляторами!",
        "Секретный ингредиент хорошей оценки - уверенность (и этот калькулятор)",
        "Функция 'автопропуск пар' временно отключена... к сожалению",
        "Знаете, что общего у этого калькулятора и хорошей оценки? Оба требуют правильных входных данных!",
        "Внимание! Обнаружена корреляция между использованием калькулятора и снижением уровня паники!"
    ];

    const randomSecret = secrets[Math.floor(Math.random() * secrets.length)];
    showSpecialToast(randomSecret);
}

function showSpecialToast(message) {
    // Создаем красивый тост
    const toast = document.createElement('div');
    toast.textContent = message;
    toast.style.cssText = `
                position: fixed;
                bottom: 20px;
                right: 20px;
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                color: white;
                padding: 15px 20px;
                border-radius: 10px;
                z-index: 10000;
                box-shadow: 0 5px 15px rgba(0,0,0,0.3);
                animation: toastSlideIn 0.5s ease;
                max-width: 300px;
                text-align: center;
                font-weight: 500;
                border: 2px solid rgba(255,255,255,0.2);
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