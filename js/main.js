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

    const toggle = document.getElementById("theme-toggle");

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
                showSpecialToast(getTranslation('secret_triple'));
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
                    showSpecialToast(getTranslation('secret_subtitle'));
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
                        showSpecialToast(getTranslation('secret_theme'));
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
        getTranslation('secret_extra_1'),
        getTranslation('secret_extra_2'),
        getTranslation('secret_extra_3'),
        getTranslation('secret_extra_4'),
        getTranslation('secret_manual_check'),
        getTranslation('secret_rare_user'),
        getTranslation('secret_easter_egg'),
        getTranslation('secret_auto_passing'),
        getTranslation('secret_calculator_student'),
        getTranslation('secret_calculator_scholarship'),
        getTranslation('secret_extra_5'),
        getTranslation('secret_extra_6'),
        getTranslation('secret_extra_7'),
        getTranslation('secret_leak'),
        getTranslation('secret_hack'),
        getTranslation('secret_success'),
        getTranslation('secret_warning'),
        getTranslation('secret_difference'),
        getTranslation('secret_extra_8'),
        getTranslation('secret_extra_9'),
        getTranslation('secret_extra_10'),
        getTranslation('secret_extra_11'),
        getTranslation('secret_extra_12'),
        getTranslation('secret_excuse'),
        getTranslation('secret_extra_13'),
        getTranslation('secret_extra_14'),
        getTranslation('secret_extra_15'),
        getTranslation('secret_extra_16'),
        getTranslation('secret_extra_17')
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
