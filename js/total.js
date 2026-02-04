let mode = "standard";

function changeMode(newMode) {
    mode = newMode;
    updateModeDisplay();
    closeModeDropdown();

    const modeKeys = {
        serious: 'mode_serious_msg',
        standard: 'mode_standard_msg',
        evil: 'mode_evil_msg'
    };
    showComment(getTranslation(modeKeys[newMode]), 'warning');
}

function updateModeDisplay() {
    const display = document.getElementById('currentModeDisplay');
    const modeKeys = {
        serious: 'mode_serious',
        standard: 'mode_standard',
        evil: 'mode_evil'
    };
    const currentMode = getTranslation(modeKeys[mode]);
    display.textContent = `${getTranslation('current_mode')} ${currentMode}`;
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

// Функция для получения случайного перевода из набора ключей
function getRandomTranslation(keys) {
    const randomKey = keys[Math.floor(Math.random() * keys.length)];
    return getTranslation(randomKey);
}

// Функция для выбора случайного элемента из массива
function pick(arr) {
    if (Array.isArray(arr)) {
        return arr[Math.floor(Math.random() * arr.length)];
    }
    return arr;
}

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
            empty: ['empty_msg_1', 'empty_msg_2'],
            invalid: ['invalid_msg_1', 'invalid_msg_2'],
            pass: ['pass_msg_1', 'pass_msg_2'],
            fail: ['standard_fail_1', 'standard_fail_2'],
            scholarship: ['standard_scholarship_1', 'standard_scholarship_2'],
            highScholarship: ['standard_high_scholarship_1', 'standard_high_scholarship_2'],
            high: ['standard_high_1', 'standard_high_2'],
            alreadyFailed: ['already_failed_1', 'already_failed_2'],
            prediction: ['prediction_msg_1', 'prediction_msg_2']
        },
        standard: {
            empty: ['standard_empty_1', 'standard_empty_2'],
            invalid: ['standard_invalid_1', 'standard_invalid_2'],
            pass: ['standard_pass_1', 'standard_pass_2'],
            fail: ['standard_fail_1', 'standard_fail_2'],
            scholarship: ['standard_scholarship_1', 'standard_scholarship_2'],
            highScholarship: ['standard_high_scholarship_1', 'standard_high_scholarship_2'],
            high: ['standard_high_1', 'standard_high_2'],
            alreadyFailed: ['already_failed_1', 'already_failed_2'],
            prediction: ['prediction_msg_1', 'prediction_msg_2']
        },
        evil: {
            empty: ['evil_empty_1', 'evil_empty_2'],
            invalid: ['evil_invalid_1', 'evil_invalid_2'],
            pass: ['evil_pass_1', 'evil_pass_2'],
            fail: ['evil_fail_1', 'evil_fail_2'],
            scholarship: ['evil_scholarship_1', 'evil_scholarship_2'],
            highScholarship: ['evil_high_scholarship_1', 'evil_high_scholarship_2'],
            high: ['evil_high_1', 'evil_high_2'],
            alreadyFailed: ['evil_already_failed_1', 'evil_already_failed_2'],
            prediction: ['prediction_msg_1', 'prediction_msg_2']
        }
    };

    // Создаем объект для перевода ключей в текст
    const commentTexts = {
        serious: {
            empty: [getTranslation('empty_msg_1'), getTranslation('empty_msg_2')],
            invalid: [getTranslation('invalid_msg_1'), getTranslation('invalid_msg_2')],
            pass: [getTranslation('pass_msg_1'), getTranslation('pass_msg_2')],
            fail: [getTranslation('standard_fail_1'), getTranslation('standard_fail_2')],
            scholarship: [getTranslation('standard_scholarship_1'), getTranslation('standard_scholarship_2')],
            highScholarship: [getTranslation('standard_high_scholarship_1'), getTranslation('standard_high_scholarship_2')],
            high: [getTranslation('standard_high_1'), getTranslation('standard_high_2')],
            alreadyFailed: [getTranslation('already_failed_1'), getTranslation('already_failed_2')],
            prediction: [getTranslation('prediction_msg_1'), getTranslation('prediction_msg_2')]
        },
        standard: {
            empty: [getTranslation('standard_empty_1'), getTranslation('standard_empty_2')],
            invalid: [getTranslation('standard_invalid_1'), getTranslation('standard_invalid_2')],
            pass: [getTranslation('standard_pass_1'), getTranslation('standard_pass_2')],
            fail: [getTranslation('standard_fail_1'), getTranslation('standard_fail_2')],
            scholarship: [getTranslation('standard_scholarship_1'), getTranslation('standard_scholarship_2')],
            highScholarship: [getTranslation('standard_high_scholarship_1'), getTranslation('standard_high_scholarship_2')],
            high: [getTranslation('standard_high_1'), getTranslation('standard_high_2')],
            alreadyFailed: [getTranslation('already_failed_1'), getTranslation('already_failed_2')],
            prediction: [getTranslation('prediction_msg_1'), getTranslation('prediction_msg_2')]
        },
        evil: {
            empty: [getTranslation('evil_empty_1'), getTranslation('evil_empty_2')],
            invalid: [getTranslation('evil_invalid_1'), getTranslation('evil_invalid_2')],
            pass: [getTranslation('evil_pass_1'), getTranslation('evil_pass_2')],
            fail: [getTranslation('evil_fail_1'), getTranslation('evil_fail_2')],
            scholarship: [getTranslation('evil_scholarship_1'), getTranslation('evil_scholarship_2')],
            highScholarship: [getTranslation('evil_high_scholarship_1'), getTranslation('evil_high_scholarship_2')],
            high: [getTranslation('evil_high_1'), getTranslation('evil_high_2')],
            alreadyFailed: [getTranslation('evil_already_failed_1'), getTranslation('evil_already_failed_2')],
            prediction: [getTranslation('prediction_msg_1'), getTranslation('prediction_msg_2')]
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
            resultDiv.innerHTML = `<h2>❌ Ошибка</h2><p>${pick(commentTexts[mode].invalid)}</p>`;
            return;
        }
    } else {
        // Вычисляем РегТерм из РегМида и РегЭнда
        if (isNaN(regmid) || isNaN(regend)) {
            resultDiv.className = 'result danger show';
            resultDiv.innerHTML = `<h2>❌ Ошибка</h2><p>${pick(commentTexts[mode].empty)}</p>`;
            return;
        }

        if (regmid < 0 || regmid > 100 || regend < 0 || regend > 100) {
            resultDiv.className = 'result danger show';
            resultDiv.innerHTML = `<h2>❌ Ошибка</h2><p>${pick(commentTexts[mode].invalid)}</p>`;
            return;
        }

        regterm = (regmid + regend) / 2;
        regtermSource = " (вычислен из РегМида и РегЭнда)";
    }

    // РЕЖИМ ПРОГНОЗА
    if (final === 0 || finalInput === '') {
        let predictionHTML = `<h2>🔮 ${pick(commentTexts[mode].prediction)}</h2>`;
        predictionHTML += `<p style="margin-bottom: 15px;"><strong>РегТерм: ${regterm.toFixed(2)}${regtermSource}</strong></p>`;

        // Проверка критических условий
        if (regtermDirect === null) {
            // Только при вычислении из РегМида и РегЭнда проверяем отдельные компоненты
            if (regmid < 25) {
                resultDiv.className = 'result danger show';
                const msgKey = mode === 'evil'
                    ? 'regmid_below_25'
                    : mode === 'serious'
                        ? 'regmid_below_minimum'
                        : 'regmid_below_25_standard';
                const msg = getTranslation(msgKey);
                predictionHTML += `<p>${msg}</p><p><strong>${pick(commentTexts[mode].alreadyFailed)}</strong></p>`;
                resultDiv.innerHTML = predictionHTML;
                return;
            }

            if (regend < 25) {
                resultDiv.className = 'result danger show';
                const msgKey = mode === 'evil'
                    ? 'regend_below_25_evil'
                    : mode === 'serious'
                        ? 'regend_below_25_serious'
                        : 'regend_below_25_standard';
                const msg = getTranslation(msgKey);
                predictionHTML += `<p>${msg}</p><p><strong>${pick(commentTexts[mode].alreadyFailed)}</strong></p>`;
                resultDiv.innerHTML = predictionHTML;
                return;
            }
        }

        if (regterm < 50) {
            resultDiv.className = 'result danger show';
            const msgKey = mode === 'evil'
                ? 'regterm_below_50'
                : mode === 'serious'
                    ? 'regterm_below_50_serious'
                    : 'regterm_below_50_standard';
            const msg = getTranslation(msgKey);
            predictionHTML += `<p>${msg}</p><p><strong>${pick(commentTexts[mode].alreadyFailed)}</strong></p>`;
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
            let passComment = '';
            if (mode === 'evil') {
                if (minForPass >= 90) passComment = getTranslation('evil_pass_comment_hard');
                else if (minForPass >= 70) passComment = getTranslation('evil_pass_comment_medium');
                else passComment = getTranslation('evil_pass_comment_easy');
            } else if (mode === 'serious') {
                passComment = getTranslation('serious_pass_comment');
            } else {
                if (minForPass >= 90) passComment = getTranslation('standard_pass_comment_hard');
                else if (minForPass >= 70) passComment = getTranslation('standard_pass_comment_medium');
                else passComment = getTranslation('standard_pass_comment_easy');
            }
            predictionHTML += `<p>${passEmoji} Минимум <strong>${minForPass.toFixed(1)}</strong> баллов${passComment}</p>`;
        } else {
            predictionHTML += `<p>❌ Невозможно (нужно ${minForPass.toFixed(1)} > 100)</p>`;
        }

        predictionHTML += '<hr style="margin: 15px 0; border: none; border-top: 1px solid #ddd;">';

        // Для обычной стипендии
        predictionHTML += `<p style="margin-bottom: 10px;"><strong>💰 Для обычной стипендии:</strong></p>`;
        if (minForScholarship <= 100) {
            const schEmoji = minForScholarship >= 95 ? '💎' : minForScholarship >= 80 ? '⭐' : '✨';
            let schComment = '';
            if (mode === 'evil') {
                if (minForScholarship >= 95) schComment = getTranslation('evil_scholarship_comment_fantasy');
                else if (minForScholarship >= 80) schComment = getTranslation('evil_scholarship_comment_hard');
                else schComment = getTranslation('evil_scholarship_comment_medium');
            } else if (mode === 'serious') {
                schComment = '';
            } else {
                if (minForScholarship >= 95) schComment = getTranslation('standard_scholarship_comment_hard');
                else if (minForScholarship >= 80) schComment = getTranslation('standard_scholarship_comment_medium');
                else schComment = getTranslation('standard_scholarship_comment_easy');
            }
            predictionHTML += `<p>${schEmoji} Минимум <strong>${Math.max(50, minForScholarship).toFixed(1)}</strong> баллов${schComment}</p>`;
        } else {
            const impossibleMsgKey = mode === 'evil'
                ? 'impossible_scholarship_evil'
                : 'impossible_scholarship_standard';
            const impossibleMsg = getTranslation(impossibleMsgKey);
            predictionHTML += `<p>❌ ${impossibleMsg}</p>`;
        }

        predictionHTML += '<hr style="margin: 15px 0; border: none; border-top: 1px solid #ddd;">';

        // Для повышенной стипендии
        predictionHTML += `<p style="margin-bottom: 10px;"><strong>💎 Для повышенной стипендии:</strong></p>`;
        if (minForHighScholarship <= 100) {
            const highSchEmoji = minForHighScholarship >= 95 ? '🚀' : minForHighScholarship >= 85 ? '💎' : '⭐';
            let highSchComment = '';
            if (mode === 'evil') {
                if (minForHighScholarship >= 95) highSchComment = getTranslation('evil_high_scholarship_comment_fantasy');
                else if (minForHighScholarship >= 85) highSchComment = getTranslation('evil_high_scholarship_comment_hard');
                else highSchComment = getTranslation('evil_high_scholarship_comment_easy');
            } else if (mode === 'serious') {
                if (minForHighScholarship >= 95) highSchComment = getTranslation('serious_scholarship_comment_hard');
                else if (minForHighScholarship >= 85) highSchComment = getTranslation('serious_scholarship_comment_medium');
                else highSchComment = getTranslation('serious_scholarship_comment_easy');
            } else {
                if (minForHighScholarship >= 95) highSchComment = ' (практически нереально)';
                else if (minForHighScholarship >= 85) highSchComment = ' (очень сложно)';
                else highSchComment = ' (сложно, но возможно)';
            }
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
        message = `<h2>${getTranslation('failed_title')}</h2>`;
        comment = pick(commentTexts[mode].fail);
    } else if (final >= 25 && final < 50) {
        status = 'warning';
        message = `<h2>${getTranslation('retake_title')}</h2>`;
        if (mode === 'evil') {
            comment = getTranslation('retake_evil');
        } else if (mode === 'serious') {
            comment = getTranslation('retake_serious');
        } else {
            comment = getTranslation('retake_standard');
        }
    } else if (total < 70) {
        status = 'warning';
        message = `<h2>${getTranslation('pass_title')}</h2>`;
        comment = pick(commentTexts[mode].pass);
    } else if (total >= 90) {
        status = 'success';
        message = `<h2>${getTranslation('high_scholarship_title')}</h2>`;
        comment = pick(commentTexts[mode].highScholarship);
    } else if (total >= 70) {
        status = 'success';
        message = `<h2>${getTranslation('scholarship_title')}</h2>`;
        comment = pick(commentTexts[mode].scholarship);
    }

    const detailsText = mode === 'serious'
        ? getTranslation('details_calculation').replace('{regterm}', regterm.toFixed(2)).replace('{total}', total.toFixed(2))
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
        getTranslation('secret_manual_check'),
        getTranslation('secret_rare_user'),
        getTranslation('secret_easter_egg'),
        getTranslation('secret_leak'),
        getTranslation('secret_hack'),
        getTranslation('secret_success'),
        getTranslation('secret_warning'),
        getTranslation('secret_difference'),
        getTranslation('secret_excuse'),
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
