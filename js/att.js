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
    const lessonsPerWeek = Number(document.getElementById('lessonsPerWeek').value);
    const resultDiv = document.getElementById('result');

    // Фиксированный процент пропусков
    const allowedPercentage = 30;

    // Проверяем корректность введенных данных
    if (document.getElementById('lessonsPerWeek').value === '') {
        resultDiv.className = 'result danger show';
        resultDiv.innerHTML = `<h2>❌ ${translationHTML('att_error')}</h2><p>${translationHTML('att_please_enter')}</p>`;
        return;
    }

    if (!Number.isInteger(lessonsPerWeek) || lessonsPerWeek < 1 || lessonsPerWeek > 20) {
        resultDiv.className = 'result danger show';
        resultDiv.innerHTML = `<h2>❌ ${translationHTML('att_error')}</h2><p>${translationHTML('att_range_error')}</p>`;
        return;
    }

    // Выполняем расчеты
    const totalLessons = lessonsPerWeek * 10;
    const allowedMissed = Math.floor(totalLessons * (allowedPercentage / 100));

    // Формируем результат
    resultDiv.className = `result success show`;

    const resultHTML = `
        <h2>${translationHTML('att_done')}</h2>
        <p>${translationHTML('att_summary', {weekly: lessonsPerWeek})}</p>
        <p class="highlight">${translationHTML('att_missed', {count: allowedMissed})}</p>
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
function revealSecret() {
    const secrets = [
        getTranslation('secret_extra_1'),
        getTranslation('secret_extra_2'),
        getTranslation('secret_extra_3'),
        getTranslation('secret_rare_user'),
        getTranslation('secret_easter_egg'),
        getTranslation('secret_auto_passing'),
        getTranslation('secret_calculator_student'),
        getTranslation('secret_calculator_scholarship'),
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
