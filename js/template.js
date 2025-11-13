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
        message = '✅ Отлично!';
        comment = 'Превосходный результат!';
    } else if (totalScore >= 70) {
        status = 'success';
        message = '✅ Хорошо';
        comment = 'Курс успешно сдан!';
    } else if (totalScore >= 50) {
        status = 'warning';
        message = '⚠️ Удовлетворительно';
        comment = 'Курс сдан, но есть куда расти';
    } else {
        status = 'danger';
        message = '❌ Неудовлетворительно';
        comment = 'Необходима пересдача';
    }

    resultDiv.className = `result ${status} show`;
    resultDiv.innerHTML = `
                <h2>${message}</h2>
                <p>${comment}</p>
                <p class="score">Итоговый балл: ${totalScore.toFixed(2)}</p>
            `;
}

// Автоматический расчет при изменении оценок
document.addEventListener('input', function (e) {
    if (e.target.classList.contains('component-grade') ||
        e.target.classList.contains('weight-input')) {
        calculateAll();
    }
});

// Инициализация - расчет при загрузке
document.addEventListener('DOMContentLoaded', function () {
    calculateAll();
});