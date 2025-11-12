
let mode = "standard";

const modeNames = {
    serious: "Серьёзный режим",
    standard: "Стандартный режим",
    evil: "Злой старшекурсник"
};

function changeMode(newMode) {
    mode = newMode;
    updateModeDisplay();
    closeModeDropdown();

    const phrases = {
        serious: "Режим серьёзного аналитика.",
        standard: "Стандартный режим. Всё по делу.",
        evil: "Режим злого старшекурсника."
    };
    showComment(phrases[newMode], 'warning');
}

function updateModeDisplay() {
    const display = document.getElementById('currentModeDisplay');
    display.textContent = `Текущий режим: ${modeNames[mode]}`;
}

function showComment(text, type = 'warning') {
    const resultDiv = document.getElementById('result');
    resultDiv.className = `result ${type} show`;
    resultDiv.innerHTML = `<p>${text}</p>`;
}

// Функции для управления выпадающим меню
function toggleModeDropdown() {
    const dropdown = document.getElementById('modeDropdown');
    dropdown.classList.toggle('show');
}

function closeModeDropdown() {
    const dropdown = document.getElementById('modeDropdown');
    dropdown.classList.remove('show');
}

// Инициализация при загрузке страницы
document.addEventListener('DOMContentLoaded', function () {
    updateModeDisplay();

    // Обработчики для выпадающего меню режимов
    const modeToggle = document.getElementById('mode-toggle');
    const modeOptions = document.querySelectorAll('.mode-option');

    modeToggle.addEventListener('click', function (e) {
        e.stopPropagation();
        toggleModeDropdown();
    });

    modeOptions.forEach(option => {
        option.addEventListener('click', function () {
            const newMode = this.getAttribute('data-mode');
            changeMode(newMode);
        });
    });

    // Закрытие выпадающего меню при клике вне его
    document.addEventListener('click', function () {
        closeModeDropdown();
    });

    // Предотвращение закрытия при клике на само меню
    const dropdown = document.getElementById('modeDropdown');
    dropdown.addEventListener('click', function (e) {
        e.stopPropagation();
    });
});

function calculate() {
    const regmid = parseFloat(document.getElementById('regmid').value);
    const regend = parseFloat(document.getElementById('regend').value);
    const finalInput = document.getElementById('final').value;
    const final = finalInput === '' ? 0 : parseFloat(finalInput);
    const resultDiv = document.getElementById('result');

    const comments = {
        serious: {
            empty: [
                "Пожалуйста, введите все значения для расчёта.",
                "Все поля должны быть заполнены для точного результата."
            ],
            invalid: [
                "Введите корректные значения от 0 до 100.",
                "Некорректные данные, проверяйте диапазон оценок."
            ],
            pass: [
                "Вы прошли курс. Итоговая оценка в пределах нормы.",
                "Курс сдан успешно, поздравляем!"
            ],
            fail: [
                "К сожалению, результат ниже проходного балла.",
                "Летник неизбежен, пора пересдавать."
            ],
            scholarship: [
                "Поздравляем! Вы получаете стипендию.",
                "Стипендия у ваших ног, молодец!"
            ],
            high: [
                "Отличный результат! Вы показали высокий уровень знаний.",
                "Превосходно! Так держать."
            ],
            alreadyFailed: [
                "По текущим результатам сдать курс невозможно.",
                "Даже идеальный файнал не спасёт ситуацию."
            ],
            prediction: [
                "Прогноз необходимых баллов на финальном экзамене.",
                "Смотрим, сколько нужно набрать на файнале."
            ]
        },
        standard: {
            empty: [
                "Заполните все поля для расчёта.",
                "Не забудьте ввести все оценки."
            ],
            invalid: [
                "Оценки должны быть от 0 до 100.",
                "Некорректное значение, проверяйте диапазон."
            ],
            pass: [
                "Прошли, но без стипендии.",
                "Курс сдан, но пока без бонусов."
            ],
            fail: [
                "Летник. Придётся пересдавать.",
                "Результат ниже нормы, готовьтесь к пересдаче."
            ],
            scholarship: [
                "Стипендия! Хорошая работа.",
                "Поздравляем, вы получаете стипендию."
            ],
            high: [
                "Отлично! Высокий балл.",
                "Замечательный результат!"
            ],
            alreadyFailed: [
                "Даже 100 на файнале не спасёт. Летник неизбежен.",
                "С текущими оценками пересдача гарантирована."
            ],
            prediction: [
                "Расчёт необходимых баллов:",
                "Сколько нужно набрать на файнале:"
            ]
        },
        evil: {
            empty: [
                "Ты серьёзно забыл ввести числа? Или это тоже нужно объяснять?",
                "Ничего не введено. Серьёзно?"
            ],
            invalid: [
                "Оценки от 0 до 100, а не от минус бесконечности до 200. Математику учили?",
                "Некорректные данные. Ты точно на этом курсе?"
            ],
            pass: [
                "Выжил. Едва, но выжил. Поздравляю с минимальным результатом.",
                "Ну, ты сдал. Почти чудо."
            ],
            fail: [
                "Летник. Не плачь, я просто посчитал. Встретимся на пересдаче!",
                "Ты провалился. На счастье это было предсказуемо."
            ],
            scholarship: [
                "Со стипендией! Не растрать её на кофе в первый же день.",
                "Поздравляю, стипендия твоя!"
            ],
            high: [
                "Серьёзно? Такой балл? Ты точно не списывал? Шучу... или нет.",
                "Ого! Настоящий зверь."
            ],
            alreadyFailed: [
                "Поздравляю, ты провалился ДО экзамена! Это талант.",
                "Летник гарантирован. Но похвалю за настойчивость."
            ],
            prediction: [
                "ПРЕДСКАЗЫВАЮ ТВОЮ СУДЬБУ...",
                "Хмм, давай посмотрим, как плохо может быть."
            ]
        }
    };

    if (isNaN(regmid) || isNaN(regend)) {
        resultDiv.className = 'result danger show';
        resultDiv.innerHTML = `<h2>❌ Ошибка</h2><p>${pick(comments[mode].empty)}</p>`;
        return;
    }

    if (regmid < 0 || regmid > 100 || regend < 0 || regend > 100 || final < 0 || final > 100) {
        resultDiv.className = 'result danger show';
        resultDiv.innerHTML = `<h2>❌ Ошибка</h2><p>${pick(comments[mode].invalid)}</p>`;
        return;
    }

    const regterm = (regmid + regend) / 2;

    // РЕЖИМ ПРОГНОЗА
    if (final === 0 || finalInput === '') {
        let predictionHTML = `<h2>🔮 ${pick(comments[mode].prediction)}</h2>`;
        predictionHTML += `<p style="margin-bottom: 15px;"><strong>РегТерм: ${regterm.toFixed(2)}</strong></p>`;

        // Проверка критических условий
        if (regmid < 25) {
            resultDiv.className = 'result danger show';
            const msg = mode === 'evil'
                ? "РегМид < 25? Серьёзно? Вы вообще на пары ходили? 💀"
                : mode === 'serious'
                    ? "РегМид ниже минимального порога. Курс не может быть сдан."
                    : "РегМид меньше 25. Летник без вариантов.";
            predictionHTML += `<p>${msg}</p><p><strong>${comments[mode].alreadyFailed}</strong></p>`;
            resultDiv.innerHTML = predictionHTML;
            return;
        }

        if (regend < 25) {
            resultDiv.className = 'result danger show';
            const msg = mode === 'evil'
                ? "РегЭнд < 25... Кажется, кто-то пропустил пару важных лекций. Или все."
                : mode === 'serious'
                    ? "РегЭнд ниже минимального порога. Курс не может быть сдан."
                    : "РегЭнд меньше 25. Летник без вариантов.";
            predictionHTML += `<p>${msg}</p><p><strong>${comments[mode].alreadyFailed}</strong></p>`;
            resultDiv.innerHTML = predictionHTML;
            return;
        }

        if (regterm < 50) {
            resultDiv.className = 'result danger show';
            const msg = mode === 'evil'
                ? "РегТерм < 50. Поздравляю, вы провалили семестр ДО экзамена! 😏"
                : mode === 'serious'
                    ? "РегТерм ниже минимального порога. Курс не может быть сдан."
                    : "РегТерм меньше 50. Летник неизбежен.";
            predictionHTML += `<p>${msg}</p><p><strong>${pick(comments[mode].alreadyFailed)}</strong></p>`;
            resultDiv.innerHTML = predictionHTML;
            return;
        }

        // Расчёт необходимых баллов
        const regScore = (regmid * 0.3) + (regend * 0.3);

        // Для прохода (Total >= 50 и Final >= 50)
        const minForPass = Math.max(50, (50 - regScore) / 0.4);

        // Для стипендии (Total >= 70)
        const minForScholarship = (70 - regScore) / 0.4;

        resultDiv.className = 'result warning show';

        predictionHTML += '<div style="margin-top: 15px; padding: 15px; background: #f8f9fa; border-radius: 8px;">';

        // Для прохода
        predictionHTML += `<p style="margin-bottom: 10px;"><strong>📝 Для прохода курса:</strong></p>`;
        if (minForPass <= 100) {
            const passEmoji = minForPass >= 90 ? '🔥' : minForPass >= 70 ? '🟡' : '🟢';
            const passComment = mode === 'evil'
                ? (minForPass >= 90 ? ' (Ого! Это будет СЛОЖНО)' : minForPass >= 70 ? ' (Готовься жить в библиотеке)' : ' (Вполне реально)')
                : mode === 'serious'
                    ? ''
                    : (minForPass >= 90 ? ' (очень сложно)' : minForPass >= 70 ? ' (нужна хорошая подготовка)' : ' (достижимо)');
            predictionHTML += `<p>${passEmoji} Минимум <strong>${minForPass.toFixed(1)}</strong> баллов${passComment}</p>`;
        } else {
            predictionHTML += `<p>❌ Невозможно (нужно ${minForPass.toFixed(1)} > 100)</p>`;
        }

        predictionHTML += '<hr style="margin: 15px 0; border: none; border-top: 1px solid #ddd;">';

        // Для стипендии
        predictionHTML += `<p style="margin-bottom: 10px;"><strong>💰 Для стипендии:</strong></p>`;
        if (minForScholarship <= 100) {
            const schEmoji = minForScholarship >= 95 ? '💎' : minForScholarship >= 80 ? '⭐' : '✨';
            const schComment = mode === 'evil'
                ? (minForScholarship >= 95 ? ' (Начинай молиться 🙏)' : minForScholarship >= 80 ? ' (Выучи ВСЁ!)' : ' (Это реально!)')
                : mode === 'serious'
                    ? ''
                    : (minForScholarship >= 95 ? ' (очень высокая планка)' : minForScholarship >= 80 ? ' (серьёзная подготовка)' : ' (хороший шанс)');
            predictionHTML += `<p>${schEmoji} Минимум <strong>${Math.max(50, minForScholarship).toFixed(1)}</strong> баллов${schComment}</p>`;
        } else {
            const impossibleMsg = mode === 'evil'
                ? "Нужно больше 100 баллов. Может, попробуешь взятку? Шучу... или нет 🤔"
                : "Невозможно получить стипендию при текущих результатах.";
            predictionHTML += `<p>❌ ${impossibleMsg}</p>`;
        }

        predictionHTML += '</div>';

        if (mode === 'evil') {
            if (regScore <= 50) {
                predictionHTML += '<p style="margin-top: 15px; font-size: 13px; color: #666;">💡 Совет: Может, стоило больше учиться, а не листать мемы?</p>';
            }
            if (regScore > 50) {
                predictionHTML += '<p style="margin-top: 15px; font-size: 13px; color: #666;">💡 Совет: В этот раз повезло >:)'
            }
        }

        resultDiv.innerHTML = predictionHTML;
        return;
    }

    // ОБЫЧНЫЙ РАСЧЁТ С РЕАЛЬНЫМ ФАЙНАЛОМ
    const total = (regmid * 0.3) + (regend * 0.3) + (final * 0.4);

    let status = 'success';
    let message = '<h2>✅ Отличный результат!</h2>';
    let comment = "";

    if (regmid < 25 || regend < 25 || regterm < 50 || final < 25 || total < 50) {
        status = 'danger';
        message = '<h2>❌ Летник</h2>';
        comment = pick(comments[mode].fail);
    } else if (final >= 25 && final < 50) {
        status = 'warning';
        message = '<h2>⚠️ Пересдача</h2>';
        if (mode === 'evil') {
            comment = "Файнал между 25 и 50. Судьба дала второй шанс, не облажайся.";
        } else if (mode === 'serious') {
            comment = "Экзамен не сдан, но предоставляется возможность пересдачи.";
        } else {
            comment = "Пересдача. У вас есть второй шанс.";
        }
    } else if (total < 70) {
        status = 'warning';
        message = '<h2>⚠️ Без стипендии</h2>';
        comment = pick(comments[mode].pass);
    } else if (total >= 90) {
        message = '<h2>✅ Отличный результат!</h2>';
        comment = pick(comments[mode].high);
    } else {
        message = '<h2>✅ Успех!</h2>';
        comment = pick(comments[mode].scholarship);
    }

    const detailsText = mode === 'serious'
        ? `Детали расчёта: РегТерм = ${regterm.toFixed(2)}, Итоговый балл = ${total.toFixed(2)}`
        : `РегТерм: ${regterm.toFixed(2)} | Итого: ${total.toFixed(2)}`;

    resultDiv.className = `result ${status} show`;
    resultDiv.innerHTML = message + `<p>${comment}</p><p class="score">${detailsText}</p>`;
}

function pick(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
}

document.querySelectorAll('input').forEach(input => {
    input.addEventListener('keypress', function (e) {
        if (e.key === 'Enter') {
            calculate();
        }
    });
});