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

// Добавление нового компонента
function addComponent(sectionId) {
    const section = document.getElementById(sectionId);
    const componentCount = section.querySelectorAll('.component-item').length + 1;

    const componentDiv = document.createElement('div');
    componentDiv.className = 'component-item';
    componentDiv.innerHTML = `
                <input type="text" class="component-name" placeholder="${getComponentPrefix(sectionId)} ${componentCount}" value="${getComponentPrefix(sectionId)} ${componentCount}">
                <input type="number" class="component-grade" placeholder="Оценка (0-100)" min="0" max="100">
                <button class="remove-btn" onclick="removeComponent(this)">×</button>
            `;
    section.appendChild(componentDiv);
}

// Удаление компонента
function removeComponent(button) {
    const componentItem = button.parentElement;
    componentItem.remove();
    calculateAll(); // Пересчет после удаления
}

// Получение префикса для имени компонента
function getComponentPrefix(sectionId) {
    switch (sectionId) {
        case 'assignmentsList': return 'Assignment';
        case 'quizzesList': return 'Quiz';
        case 'examsList': return 'Exam';
        default: return 'Component';
    }
}

// Расчет всех результатов
function calculateAll() {
    // Проверка суммы весов
    const assignmentsWeight = parseInt(document.getElementById('assignmentsWeight').value) || 0;
    const quizzesWeight = parseInt(document.getElementById('quizzesWeight').value) || 0;
    const examsWeight = parseInt(document.getElementById('examsWeight').value) || 0;

    const totalWeight = assignmentsWeight + quizzesWeight + examsWeight;
    const weightError = document.getElementById('weightError');
    const currentWeightSpan = document.getElementById('currentWeight');

    if (totalWeight !== 100) {
        currentWeightSpan.textContent = totalWeight;
        weightError.style.display = 'block';
        return;
    } else {
        weightError.style.display = 'none';
    }

    // Расчет по секциям
    const assignmentsTotal = calculateSection('assignmentsList', assignmentsWeight);
    const quizzesTotal = calculateSection('quizzesList', quizzesWeight);
    const examsTotal = calculateSection('examsList', examsWeight);

    // Общий результат
    const overallTotal = assignmentsTotal + quizzesTotal + examsTotal;

    // Обновление отображения
    document.getElementById('assignmentsTotal').textContent = `Assignments: ${assignmentsTotal.toFixed(2)}`;
    document.getElementById('quizzesTotal').textContent = `Quizzes: ${quizzesTotal.toFixed(2)}`;
    document.getElementById('examsTotal').textContent = `Exams: ${examsTotal.toFixed(2)}`;
    document.getElementById('overallTotal').textContent = `Общий результат: ${overallTotal.toFixed(2)}`;

    // Показ результата с оценкой
    showResult(overallTotal);
}

// Расчет одной секции
function calculateSection(sectionId, sectionWeight) {
    const section = document.getElementById(sectionId);
    const components = section.querySelectorAll('.component-item');

    if (components.length === 0) return 0;

    let sectionTotal = 0;
    let validComponents = 0;

    components.forEach(component => {
        const gradeInput = component.querySelector('.component-grade');
        const grade = parseFloat(gradeInput.value);

        if (!isNaN(grade) && grade >= 0 && grade <= 100) {
            sectionTotal += grade;
            validComponents++;
        }
    });

    if (validComponents === 0) return 0;

    // Средняя оценка по секции, умноженная на вес секции
    const averageGrade = sectionTotal / validComponents;
    return averageGrade * (sectionWeight / 100);
}

// Показать итоговый результат
function showResult(totalScore) {
    const resultDiv = document.getElementById('result');

    let status, message, comment;

    if (totalScore >= 90) {
        status = 'success';
        message = `✅ ${getTranslation('template_excellent')}`;
        comment = getTranslation('template_excellent_comment');
    } else if (totalScore >= 70) {
        status = 'success';
        message = `✅ ${getTranslation('template_good')}`;
        comment = getTranslation('template_good_comment');
    } else if (totalScore >= 50) {
        status = 'warning';
        message = `⚠️ ${getTranslation('template_satisfactory')}`;
        comment = getTranslation('template_satisfactory_comment');
    } else {
        status = 'danger';
        message = `❌ ${getTranslation('template_unsatisfactory')}`;
        comment = getTranslation('template_unsatisfactory_comment');
    }

    resultDiv.className = `result ${status} show`;
    resultDiv.innerHTML = `
                <h2>${message}</h2>
                <p>${comment}</p>
                <p class="score">${getTranslation('template_overall_result')} ${totalScore.toFixed(2)}</p>
            `;
}

// Автоматический расчет при изменении оценок
document.addEventListener('input', function (e) {
    if (e.target.classList.contains('component-grade') ||
        e.target.classList.contains('weight-input')) {
        calculateAll();
    }
});
function revealSecret() {
    const secrets = [
        getTranslation('secret_manual_check'),
        getTranslation('secret_rare_user'),
        getTranslation('secret_easter_egg'),
        getTranslation('secret_auto_passing'),
        getTranslation('secret_calculator_student'),
        getTranslation('secret_calculator_scholarship'),
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
        "Пасхалка уровня 'я должен был учиться, но ищу пасхалки'",
        getTranslation('secret_excuse')
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

// Инициализация - расчет при загрузке
document.addEventListener('DOMContentLoaded', function () {
    calculateAll();
});
// Дополнительные исправления для мобильных устройств
document.addEventListener('DOMContentLoaded', function () {
    // Улучшенные обработчики для кнопок на мобильных
    const calculateBtn = document.getElementById('calculate-all-btn');
    if (calculateBtn) {
        calculateBtn.addEventListener('touchstart', function (e) {
            e.preventDefault();
            calculateAll();
        });
    }

    // Улучшенные обработчики для кнопок добавления
    document.querySelectorAll('.add-btn').forEach(btn => {
        btn.addEventListener('touchstart', function (e) {
            e.preventDefault();
            const listId = this.getAttribute('onclick').match(/'([^']+)'/)[1];
            addComponent(listId);
        });
    });

    // Улучшенные обработчики для кнопок удаления
    document.querySelectorAll('.remove-btn').forEach(btn => {
        btn.addEventListener('touchstart', function (e) {
            e.preventDefault();
            removeComponent(this);
        });
    });

    // Улучшенные обработчики для полей ввода
    document.querySelectorAll('input').forEach(input => {
        input.addEventListener('touchstart', function (e) {
            // Позволяет полям ввода получать фокус на мобильных
            this.focus();
        });
    });

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

    // Обработчик touch для переключения темы
    toggle.addEventListener('touchstart', function (e) {
        e.preventDefault();
        body.classList.toggle("dark-mode");

        if (body.classList.contains("dark-mode")) {
            toggle.textContent = "☀️ Тема";
            localStorage.setItem("theme", "dark");
        } else {
            toggle.textContent = "🌙 Тема";
            localStorage.setItem("theme", "light");
        }
    });
});
document.head.insertAdjacentHTML('beforeend', `<style>${toastStyles}</style>`);