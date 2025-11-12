
// База данных шаблонов
const templates = {
    // 1 курс
    "1": {
        "Computer Science": {
            "Calculus 1": {
                type: "calculus",
                midterm: {
                    assignments: [
                        { name: "Assignment 1", weight: 20 },
                        { name: "Assignment 2", weight: 20 }
                    ],
                    quizzes: [
                        { name: "Quiz 1", weight: 20 }
                    ],
                    exam: { name: "Midterm", weight: 40 }
                },
                endterm: {
                    assignments: [
                        { name: "Assignment 3", weight: 20 },
                        { name: "Assignment 4", weight: 20 }
                    ],
                    quizzes: [
                        { name: "Quiz 2", weight: 20 }
                    ],
                    exam: { name: "Endterm", weight: 40 }
                }
            },
        }
    }
};

let currentTemplate = null;

function updatePrograms() {
    const course = document.getElementById('course').value;
    const programSelect = document.getElementById('program');
    const subjectSelect = document.getElementById('subject');

    programSelect.innerHTML = '<option value="">Выберите программу</option>';
    subjectSelect.innerHTML = '<option value="">Сначала выберите программу</option>';
    subjectSelect.disabled = true;

    if (course && templates[course]) {
        programSelect.disabled = false;
        Object.keys(templates[course]).forEach(program => {
            const option = document.createElement('option');
            option.value = program;
            option.textContent = program;
            programSelect.appendChild(option);
        });
    } else {
        programSelect.disabled = true;
    }

    resetCalculator();
}

function updateSubjects() {
    const course = document.getElementById('course').value;
    const program = document.getElementById('program').value;
    const subjectSelect = document.getElementById('subject');

    subjectSelect.innerHTML = '<option value="">Выберите предмет</option>';

    if (course && program && templates[course][program]) {
        subjectSelect.disabled = false;
        Object.keys(templates[course][program]).forEach(subject => {
            const option = document.createElement('option');
            option.value = subject;
            option.textContent = subject;
            subjectSelect.appendChild(option);
        });
    } else {
        subjectSelect.disabled = true;
    }

    resetCalculator();
}

function loadTemplate() {
    const course = document.getElementById('course').value;
    const program = document.getElementById('program').value;
    const subject = document.getElementById('subject').value;

    if (course && program && subject && templates[course][program][subject]) {
        currentTemplate = templates[course][program][subject];
        displayTemplateInfo();
        createInputFields();
        document.getElementById('calculateBtn').disabled = false;
    } else {
        resetCalculator();
    }
}

function displayTemplateInfo() {
    const infoDiv = document.getElementById('templateInfo');
    const weightList = document.getElementById('weightList');
    const currentTemplateDiv = document.getElementById('currentTemplate');

    weightList.innerHTML = '';

    if (currentTemplate.type === "calculus") {
        // Для Calculus 1
        const liMid = document.createElement('li');
        liMid.innerHTML = `<strong>РегМид:</strong> Assignments (40%) + Quiz (20%) + Midterm (40%)`;
        weightList.appendChild(liMid);

        const liEnd = document.createElement('li');
        liEnd.innerHTML = `<strong>РегЭнд:</strong> Assignments (40%) + Quiz (20%) + Endterm (40%)`;
        weightList.appendChild(liEnd);
    } else {
        // Для обычных шаблонов
        Object.keys(currentTemplate.weights).forEach(field => {
            const li = document.createElement('li');
            li.innerHTML = `<strong>${field}:</strong> ${currentTemplate.weights[field]}%`;
            weightList.appendChild(li);
        });
    }

    infoDiv.style.display = 'block';
    currentTemplateDiv.textContent = `Текущий шаблон: ${document.getElementById('subject').value}`;
}

function createInputFields() {
    const inputFields = document.getElementById('inputFields');
    inputFields.innerHTML = '';

    if (currentTemplate.type === "calculus") {
        // Создаем поля для Calculus 1
        createCalculusFields();
    } else {
        // Для обычных шаблонов
        currentTemplate.fields.forEach(field => {
            const div = document.createElement('div');
            div.className = 'input-row';
            div.innerHTML = `
                        <label for="${field}">${field} (0-100)</label>
                        <input type="number" id="${field}" min="0" max="100" placeholder="Введите оценку">
                    `;
            inputFields.appendChild(div);
        });
    }
}

function createCalculusFields() {
    const inputFields = document.getElementById('inputFields');

    // Секция Midterm
    const midSection = document.createElement('div');
    midSection.innerHTML = '<div class="section-title">📅 РегМид</div>';
    inputFields.appendChild(midSection);

    // Assignments для Midterm
    currentTemplate.midterm.assignments.forEach(assignment => {
        const div = document.createElement('div');
        div.className = 'input-row';
        div.innerHTML = `
                    <label for="${assignment.name}">${assignment.name} (${assignment.weight}%)</label>
                    <input type="number" id="${assignment.name}" min="0" max="100" placeholder="Введите оценку">
                `;
        inputFields.appendChild(div);
    });

    // Quizzes для Midterm
    currentTemplate.midterm.quizzes.forEach(quiz => {
        const div = document.createElement('div');
        div.className = 'input-row';
        div.innerHTML = `
                    <label for="${quiz.name}">${quiz.name} (${quiz.weight}%)</label>
                    <input type="number" id="${quiz.name}" min="0" max="100" placeholder="Введите оценку">
                `;
        inputFields.appendChild(div);
    });

    // Exam для Midterm
    const midExamDiv = document.createElement('div');
    midExamDiv.className = 'input-row';
    midExamDiv.innerHTML = `
                <label for="${currentTemplate.midterm.exam.name}">${currentTemplate.midterm.exam.name} (${currentTemplate.midterm.exam.weight}%)</label>
                <input type="number" id="${currentTemplate.midterm.exam.name}" min="0" max="100" placeholder="Введите оценку">
            `;
    inputFields.appendChild(midExamDiv);

    // Разделитель
    const divider = document.createElement('hr');
    divider.className = 'section-divider';
    inputFields.appendChild(divider);

    // Секция Endterm
    const endSection = document.createElement('div');
    endSection.innerHTML = '<div class="section-title">📅 РегЭнд</div>';
    inputFields.appendChild(endSection);

    // Assignments для Endterm
    currentTemplate.endterm.assignments.forEach(assignment => {
        const div = document.createElement('div');
        div.className = 'input-row';
        div.innerHTML = `
                    <label for="${assignment.name}">${assignment.name} (${assignment.weight}%)</label>
                    <input type="number" id="${assignment.name}" min="0" max="100" placeholder="Введите оценку">
                `;
        inputFields.appendChild(div);
    });

    // Quizzes для Endterm
    currentTemplate.endterm.quizzes.forEach(quiz => {
        const div = document.createElement('div');
        div.className = 'input-row';
        div.innerHTML = `
                    <label for="${quiz.name}">${quiz.name} (${quiz.weight}%)</label>
                    <input type="number" id="${quiz.name}" min="0" max="100" placeholder="Введите оценку">
                `;
        inputFields.appendChild(div);
    });

    // Exam для Endterm
    const endExamDiv = document.createElement('div');
    endExamDiv.className = 'input-row';
    endExamDiv.innerHTML = `
                <label for="${currentTemplate.endterm.exam.name}">${currentTemplate.endterm.exam.name} (${currentTemplate.endterm.exam.weight}%)</label>
                <input type="number" id="${currentTemplate.endterm.exam.name}" min="0" max="100" placeholder="Введите оценку">
            `;
    inputFields.appendChild(endExamDiv);
}

function resetCalculator() {
    document.getElementById('inputFields').innerHTML =
        '<div style="text-align: center; color: #666; padding: 40px;">Выберите предмет в боковой панели чтобы начать расчет</div>';
    document.getElementById('templateInfo').style.display = 'none';
    document.getElementById('currentTemplate').textContent = 'Выберите шаблон для начала работы';
    document.getElementById('calculateBtn').disabled = true;
    document.getElementById('result').className = 'result';
    currentTemplate = null;
}

function calculate() {
    if (!currentTemplate) return;

    const resultDiv = document.getElementById('result');

    if (currentTemplate.type === "calculus") {
        calculateCalculus();
    } else {
        calculateRegular();
    }
}

function calculateCalculus() {
    const resultDiv = document.getElementById('result');

    // Расчет РегМида
    let regMid = 0;
    let midFilled = true;

    // Assignments для Midterm
    currentTemplate.midterm.assignments.forEach(assignment => {
        const input = document.getElementById(assignment.name);
        const value = parseFloat(input.value);

        if (isNaN(value) || value < 0 || value > 100) {
            midFilled = false;
        } else {
            regMid += value * (assignment.weight / 100);
        }
    });

    // Quizzes для Midterm
    currentTemplate.midterm.quizzes.forEach(quiz => {
        const input = document.getElementById(quiz.name);
        const value = parseFloat(input.value);

        if (isNaN(value) || value < 0 || value > 100) {
            midFilled = false;
        } else {
            regMid += value * (quiz.weight / 100);
        }
    });

    // Exam для Midterm
    const midExamInput = document.getElementById(currentTemplate.midterm.exam.name);
    const midExamValue = parseFloat(midExamInput.value);

    if (isNaN(midExamValue) || midExamValue < 0 || midExamValue > 100) {
        midFilled = false;
    } else {
        regMid += midExamValue * (currentTemplate.midterm.exam.weight / 100);
    }

    // Расчет РегЭнда
    let regEnd = 0;
    let endFilled = true;

    // Assignments для Endterm
    currentTemplate.endterm.assignments.forEach(assignment => {
        const input = document.getElementById(assignment.name);
        const value = parseFloat(input.value);

        if (isNaN(value) || value < 0 || value > 100) {
            endFilled = false;
        } else {
            regEnd += value * (assignment.weight / 100);
        }
    });

    // Quizzes для Endterm
    currentTemplate.endterm.quizzes.forEach(quiz => {
        const input = document.getElementById(quiz.name);
        const value = parseFloat(input.value);

        if (isNaN(value) || value < 0 || value > 100) {
            endFilled = false;
        } else {
            regEnd += value * (quiz.weight / 100);
        }
    });

    // Exam для Endterm
    const endExamInput = document.getElementById(currentTemplate.endterm.exam.name);
    const endExamValue = parseFloat(endExamInput.value);

    if (isNaN(endExamValue) || endExamValue < 0 || endExamValue > 100) {
        endFilled = false;
    } else {
        regEnd += endExamValue * (currentTemplate.endterm.exam.weight / 100);
    }

    if (!midFilled || !endFilled) {
        resultDiv.className = 'result danger show';
        resultDiv.innerHTML = '<h2>❌ Ошибка</h2><p>Пожалуйста, введите все оценки от 0 до 100</p>';
        return;
    }

    const regTerm = (regMid + regEnd) / 2;

    resultDiv.className = 'result success show';
    resultDiv.innerHTML = `
                <h2>📊 Расчет завершен</h2>
                <p><strong>РегМид:</strong> ${regMid.toFixed(2)}</p>
                <p><strong>РегЭнд:</strong> ${regEnd.toFixed(2)}</p>
                <p><strong>РегТерм:</strong> ${regTerm.toFixed(2)}</p>
                <p style="margin-top: 15px; font-size: 14px; color: #666;">
                    Используйте эти значения в основном калькуляторе для расчета итоговой оценки с файналом.
                </p>
            `;
}

function calculateRegular() {
    let total = 0;
    let allFilled = true;
    const resultDiv = document.getElementById('result');

    // Проверяем и собираем оценки
    for (const field of currentTemplate.fields) {
        const input = document.getElementById(field);
        const value = parseFloat(input.value);

        if (isNaN(value) || value < 0 || value > 100) {
            allFilled = false;
            break;
        }

        total += value * (currentTemplate.weights[field] / 100);
    }

    if (!allFilled) {
        resultDiv.className = 'result danger show';
        resultDiv.innerHTML = '<h2>❌ Ошибка</h2><p>Пожалуйста, введите все оценки от 0 до 100</p>';
        return;
    }

    // Определяем статус
    let status, message, comment;

    if (total >= 90) {
        status = 'success';
        message = '<h2>✅ Отлично!</h2>';
        comment = 'Превосходный результат!';
    } else if (total >= 70) {
        status = 'success';
        message = '<h2>✅ Хорошо</h2>';
        comment = 'Курс успешно сдан!';
    } else if (total >= 50) {
        status = 'warning';
        message = '<h2>⚠️ Удовлетворительно</h2>';
        comment = 'Курс сдан, но есть куда расти';
    } else {
        status = 'danger';
        message = '<h2>❌ Неудовлетворительно</h2>';
        comment = 'Необходима пересдача';
    }

    resultDiv.className = `result ${status} show`;
    resultDiv.innerHTML = `${message}<p>${comment}</p><p class="score">Итоговый балл: ${total.toFixed(2)}</p>`;
}

// Обработка Enter в полях ввода
document.addEventListener('DOMContentLoaded', function () {
    document.addEventListener('keypress', function (e) {
        if (e.key === 'Enter' && !document.getElementById('calculateBtn').disabled) {
            calculate();
        }
    });
});