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

    // Улучшенные обработчики для мобильных устройств
    modeToggle.addEventListener('click', function (e) {
        e.stopPropagation();
        e.preventDefault();
        toggleModeDropdown();
    });

    modeOptions.forEach(option => {
        option.addEventListener('click', function (e) {
            e.preventDefault();
            const newMode = this.getAttribute('data-mode');
            changeMode(newMode);
        });

        // Добавляем обработчик touch для лучшей реакции на мобильных
        option.addEventListener('touchstart', function (e) {
            e.preventDefault();
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
    if (dropdown) {
        dropdown.addEventListener('click', function (e) {
            e.stopPropagation();
        });
    }

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

    // Устойчивый обработчик нажатий для мобильных и десктопа
    let lastTouchTime = 0;

    function addTapHandler(element, handler) {
        if (!element) return;

        element.addEventListener('touchend', function (e) {
            e.preventDefault();
            lastTouchTime = Date.now();
            handler();
        });

        element.addEventListener('click', function (e) {
            if (Date.now() - lastTouchTime < 500) {
                e.preventDefault();
                return;
            }
            handler();
        });
    }

    // Обработчик для кнопки расчета
    const calculateBtn = document.getElementById('calculate-btn');
    addTapHandler(calculateBtn, calculate);

    // Обработчик нажатия Enter в полях ввода
    document.querySelectorAll('input').forEach(input => {
        input.addEventListener('keypress', function (e) {
            if (e.key === 'Enter') {
                calculate();
            }
        });
    });

    // Улучшенный обработчик для полей ввода на мобильных
    document.querySelectorAll('input').forEach(input => {
        input.addEventListener('touchstart', function (e) {
            // Позволяет полям ввода получать фокус на мобильных
            this.focus();
        });
    });
    // Добавьте эту переменную в начало файла с другими переменными
    let shareLinks = JSON.parse(localStorage.getItem('gradeMaster_shareLinks') || '{}');

    // Функция для создания уникального ID
    function generateShareId() {
        return 'share_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    }

    // Функция для создания ссылки общего доступа
    function createShareLink() {
        const regmid = document.getElementById('regmid').value;
        const regend = document.getElementById('regend').value;
        const regterm = document.getElementById('regterm').value;
        const final = document.getElementById('final').value;

        // Собираем данные для сохранения
        const shareData = {
            regmid: regmid || null,
            regend: regend || null,
            regterm: regterm || null,
            final: final || null,
            mode: mode,
            timestamp: Date.now(),
            expires: Date.now() + (24 * 60 * 60 * 1000) // 24 часа
        };

        // Генерируем уникальный ID
        const shareId = generateShareId();

        // Сохраняем в localStorage
        shareLinks[shareId] = shareData;
        localStorage.setItem('gradeMaster_shareLinks', JSON.stringify(shareLinks));

        // Создаем ссылку
        const shareUrl = `${window.location.origin}${window.location.pathname}?share=${shareId}`;

        // Показываем ссылку пользователю
        document.getElementById('share-link').value = shareUrl;
        document.getElementById('shareSection').style.display = 'block';

        // Прокручиваем к разделу с ссылкой
        document.getElementById('shareSection').scrollIntoView({ behavior: 'smooth' });

        showComment('✅ Ссылка создана! Она будет активна 24 часа.', 'success');
    }

    // Функция для загрузки данных из ссылки
    function loadFromShareLink() {
        const urlParams = new URLSearchParams(window.location.search);
        const shareId = urlParams.get('share');

        if (!shareId) return false;

        const shareData = shareLinks[shareId];

        if (!shareData) {
            showComment('❌ Ссылка недействительна или устарела', 'danger');
            return false;
        }

        // Проверяем срок действия
        if (Date.now() > shareData.expires) {
            delete shareLinks[shareId];
            localStorage.setItem('gradeMaster_shareLinks', JSON.stringify(shareLinks));
            showComment('❌ Срок действия ссылки истёк', 'danger');
            return false;
        }

        // Заполняем поля данными из ссылки
        if (shareData.regmid) document.getElementById('regmid').value = shareData.regmid;
        if (shareData.regend) document.getElementById('regend').value = shareData.regend;
        if (shareData.regterm) document.getElementById('regterm').value = shareData.regterm;
        if (shareData.final) document.getElementById('final').value = shareData.final;

        // Устанавливаем режим
        if (shareData.mode) {
            changeMode(shareData.mode);
        }

        showComment('📥 Данные загружены из общей ссылки!', 'success');

        // Автоматически рассчитываем если есть достаточно данных
        const hasRegData = (shareData.regmid && shareData.regend) || shareData.regterm;
        if (hasRegData) {
            setTimeout(() => {
                calculate();
            }, 1000);
        }

        return true;
    }

    // Функция для копирования ссылки в буфер обмена
    function copyShareLink() {
        const shareLinkInput = document.getElementById('share-link');
        shareLinkInput.select();
        shareLinkInput.setSelectionRange(0, 99999); // Для мобильных устройств

        try {
            navigator.clipboard.writeText(shareLinkInput.value).then(() => {
                showComment('✅ Ссылка скопирована в буфер обмена!', 'success');
            }).catch(() => {
                // Fallback для старых браузеров
                document.execCommand('copy');
                showComment('✅ Ссылка скопирована в буфер обмена!', 'success');
            });
        } catch (err) {
            // Резервный вариант
            document.execCommand('copy');
            showComment('✅ Ссылка скопирована в буфер обмена!', 'success');
        }
    }

    // Функция для очистки устаревших ссылок
    function cleanupExpiredLinks() {
        const now = Date.now();
        let updated = false;

        Object.keys(shareLinks).forEach(shareId => {
            if (now > shareLinks[shareId].expires) {
                delete shareLinks[shareId];
                updated = true;
            }
        });

        if (updated) {
            localStorage.setItem('gradeMaster_shareLinks', JSON.stringify(shareLinks));
        }
    }
    // Очистка устаревших ссылок
    cleanupExpiredLinks();

    // Загрузка данных из share-ссылки если есть
    loadFromShareLink();

    // Обработчики для кнопок общего доступа
    const shareBtn = document.getElementById('share-btn');
    const copyLinkBtn = document.getElementById('copy-link-btn');

    addTapHandler(shareBtn, createShareLink);
    addTapHandler(copyLinkBtn, copyShareLink);
});

function calculate() {
    const regmid = parseFloat(document.getElementById('regmid').value);
    const regend = parseFloat(document.getElementById('regend').value);
    const regtermInput = document.getElementById('regterm').value;
    const regtermDirect = regtermInput === '' ? null : parseFloat(regtermInput);
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
            highScholarship: [
                "Превосходно! Вы получаете повышенную стипендию!",
                "Высший результат! Повышенная стипендия гарантирована!"
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
            highScholarship: [
                "Отлично! Повышенная стипендия твоя!",
                "Вау! Повышенная стипендия обеспечена!"
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
            highScholarship: [
                "Серьёзно? Повышенная стипендия? Ты точно не списывал?",
                "Ого! Повышенная стипендия! Может, поделишься? Шучу... или нет."
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

    // Определяем РегТерм - либо напрямую, либо вычисляем из РегМида и РегЭнда
    let regterm;
    let regtermSource = "";

    if (regtermDirect !== null && !isNaN(regtermDirect)) {
        // Используем прямой ввод РегТерма
        regterm = regtermDirect;
        regtermSource = " (введён напрямую)";

        // Проверяем валидность прямого ввода РегТерма
        if (regterm < 0 || regterm > 100) {
            resultDiv.className = 'result danger show';
            resultDiv.innerHTML = `<h2>❌ Ошибка</h2><p>${pick(comments[mode].invalid)}</p>`;
            return;
        }
    } else {
        // Вычисляем РегТерм из РегМида и РегЭнда
        if (isNaN(regmid) || isNaN(regend)) {
            resultDiv.className = 'result danger show';
            resultDiv.innerHTML = `<h2>❌ Ошибка</h2><p>${pick(comments[mode].empty)}</p>`;
            return;
        }

        if (regmid < 0 || regmid > 100 || regend < 0 || regend > 100) {
            resultDiv.className = 'result danger show';
            resultDiv.innerHTML = `<h2>❌ Ошибка</h2><p>${pick(comments[mode].invalid)}</p>`;
            return;
        }

        regterm = (regmid + regend) / 2;
        regtermSource = " (вычислен из РегМида и РегЭнда)";
    }

    // РЕЖИМ ПРОГНОЗА
    if (final === 0 || finalInput === '') {
        let predictionHTML = `<h2>🔮 ${pick(comments[mode].prediction)}</h2>`;
        predictionHTML += `<p style="margin-bottom: 15px;"><strong>РегТерм: ${regterm.toFixed(2)}${regtermSource}</strong></p>`;

        // Проверка критических условий
        if (regtermDirect === null) {
            // Только при вычислении из РегМида и РегЭнда проверяем отдельные компоненты
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
        }

        if (regterm < 50) {
            resultDiv.className = 'result danger show';
            const msg = mode === 'evil'
                ? "РегТерм < 50. Поздравляю, ты даже до файнала не добрался а уже летка!"
                : mode === 'serious'
                    ? "РегТерм ниже минимального порога. Курс не может быть сдан."
                    : "РегТерм меньше 50. Летник неизбежен.";
            predictionHTML += `<p>${msg}</p><p><strong>${pick(comments[mode].alreadyFailed)}</strong></p>`;
            resultDiv.innerHTML = predictionHTML;
            return;
        }

        // Расчёт необходимых баллов
        let regScore;
        if (regtermDirect !== null) {
            // Если РегТерм введён напрямую, используем его для расчёта
            regScore = regterm * 0.6; // 30% + 30% = 60%
        } else {
            // Если РегТерм вычислен, используем исходные компоненты
            regScore = (regmid * 0.3) + (regend * 0.3);
        }

        // Для прохода (Total >= 50 и Final >= 50)
        const minForPass = Math.max(50, (50 - regScore) / 0.4);

        // Для обычной стипендии (Total >= 70)
        const minForScholarship = (70 - regScore) / 0.4;

        // Для повышенной стипендии (Total >= 90)
        const minForHighScholarship = (90 - regScore) / 0.4;

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

        // Для обычной стипендии
        predictionHTML += `<p style="margin-bottom: 10px;"><strong>💰 Для обычной стипендии:</strong></p>`;
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

        predictionHTML += '<hr style="margin: 15px 0; border: none; border-top: 1px solid #ddd;">';

        // Для повышенной стипендии
        predictionHTML += `<p style="margin-bottom: 10px;"><strong>💎 Для повышенной стипендии:</strong></p>`;
        if (minForHighScholarship <= 100) {
            const highSchEmoji = minForHighScholarship >= 95 ? '🚀' : minForHighScholarship >= 85 ? '💎' : '⭐';
            const highSchComment = mode === 'evil'
                ? (minForHighScholarship >= 95 ? ' (Это уже из области фантастики!)' : minForHighScholarship >= 85 ? ' (На грани возможного!)' : ' (Потребуются невероятные усилия)')
                : mode === 'serious'
                    ? (minForHighScholarship >= 95 ? ' (экстремально сложно)' : minForHighScholarship >= 85 ? ' (очень высокая сложность)' : ' (высокая сложность)')
                    : (minForHighScholarship >= 95 ? ' (практически нереально)' : minForHighScholarship >= 85 ? ' (очень сложно)' : ' (сложно, но возможно)');
            predictionHTML += `<p>${highSchEmoji} Минимум <strong>${Math.max(50, minForHighScholarship).toFixed(1)}</strong> баллов${highSchComment}</p>`;
        } else {
            const impossibleHighMsg = mode === 'evil'
                ? "Повышенная стипендия? С такими оценками? Мечтать не вредно! 😂"
                : "Невозможно получить повышенную стипендию при текущих результатах.";
            predictionHTML += `<p>❌ ${impossibleHighMsg}</p>`;
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
    let total;
    if (regtermDirect !== null) {
        // Если РегТерм введён напрямую
        total = (regterm * 0.6) + (final * 0.4);
    } else {
        // Если РегТерм вычислен из РегМида и РегЭнда
        total = (regmid * 0.3) + (regend * 0.3) + (final * 0.4);
    }

    let status = 'success';
    let message = '<h2>✅ Отличный результат!</h2>';
    let comment = "";

    // Проверка условий сдачи
    let failed = false;

    if (regtermDirect === null) {
        // Проверяем отдельные компоненты только если они были введены
        if (regmid < 25 || regend < 25) {
            failed = true;
        }
    }

    if (regterm < 50 || final < 25 || total < 50 || failed) {
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
        status = 'success';
        message = '<h2>💎 Превосходно! Повышенная стипендия!</h2>';
        comment = pick(comments[mode].highScholarship);
    } else if (total >= 70) {
        status = 'success';
        message = '<h2>✅ Успех! Обычная стипендия!</h2>';
        comment = pick(comments[mode].scholarship);
    }

    const detailsText = mode === 'serious'
        ? `Детали расчёта: РегТерм = ${regterm.toFixed(2)}${regtermSource}, Итоговый балл = ${total.toFixed(2)}`
        : `РегТерм: ${regterm.toFixed(2)}${regtermSource} | Итого: ${total.toFixed(2)}`;

    resultDiv.className = `result ${status} show`;
    resultDiv.innerHTML = message + `<p>${comment}</p><p class="score">${detailsText}</p>`;
}


function pick(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
}

function revealSecret() {
    const secrets = [
        "Пасхалка! Ты нашел секрет! 🥚",
        "Разработчик этого калькулятора тоже иногда заваливает экзамены 😅",
        "Знаешь ли ты, что первый калькулятор был создан в 17 веке?",
        "Этот калькулятор был сделан с ♥ и большим количеством кофе ☕",
        "Секретный совет: всегда проверяйте расчеты вручную!",
        "Ты - 1 из 1000 пользователей, который нашел эту пасхалку!",
        "Мои поздравления пасхантер, может и на других страницах что то есть?)",
        "Внимание! Обнаружена утечка: файнал составляет 40% от оценки!",
        "Хакерский совет: чтобы сдать экзамен, нужно на него прийти 😉",
        "Секрет успеха: 10% везение, 20% навыки, 70% этот калькулятор!",
        "Предупреждение: чрезмерное использование калькулятора может привести к... хорошим оценкам!",
        "Знаете разницу между студентом и этим калькулятором? Калькулятор всегда считает правильно!",
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
