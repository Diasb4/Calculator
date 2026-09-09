let mode = "standard";

function changeMode(newMode) {
    mode = newMode;
    updateModeDisplay();
    closeModeDropdown();

    document.querySelectorAll('.mode-option').forEach(option => {
        option.setAttribute('aria-pressed', String(option.getAttribute('data-mode') === newMode));
    });

    const modeKeys = {
        serious: 'mode_serious_msg',
        standard: 'mode_standard_msg',
        evil: 'mode_evil_msg'
    };
    showComment(translationHTML(modeKeys[newMode]), 'warning');
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

function updateBodyPaddingForNavbar() {
    const navbar = document.querySelector('nav.navbar');
    if (!navbar) return;

    const extraPadding = 12;
    document.body.style.paddingTop = `${navbar.offsetHeight + extraPadding}px`;
}

// Инициализация при загрузке страницы
document.addEventListener('DOMContentLoaded', function () {
    updateModeDisplay();
    updateBodyPaddingForNavbar();

    window.addEventListener('resize', updateBodyPaddingForNavbar);
    window.addEventListener('orientationchange', updateBodyPaddingForNavbar);
    setTimeout(updateBodyPaddingForNavbar, 50);

    // Обработчики для выпадающего меню режимов
    const modeToggle = document.getElementById('mode-toggle');
    const modeOptions = document.querySelectorAll('.mode-option');

    // Улучшенные обработчики для мобильных устройств
    modeToggle.addEventListener('click', function (e) {
        e.stopPropagation();
        toggleModeDropdown();
    });

    modeOptions.forEach(option => {
        option.addEventListener('click', function (e) {
            const newMode = this.getAttribute('data-mode');
            changeMode(newMode);
        });
        option.addEventListener('keydown', function (e) {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                const newMode = this.getAttribute('data-mode');
                changeMode(newMode);
            }
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

    // Обработчик для кнопки расчета
    const calculateBtn = document.getElementById('calculate-btn');
    calculateBtn.addEventListener('click', calculate);


    // Обработчик нажатия Enter в полях ввода
    document.querySelectorAll('input').forEach(input => {
        input.addEventListener('keypress', function (e) {
            if (e.key === 'Enter') {
                calculate();
            }
        });
    });

    // Загрузка данных из share-ссылки если есть
    loadFromShareLink();

    // Обработчики для кнопок общего доступа
    const shareBtn = document.getElementById('share-btn');
    const copyLinkBtn = document.getElementById('copy-link-btn');

    if (shareBtn) shareBtn.addEventListener('click', createShareLink);
    if (copyLinkBtn) copyLinkBtn.addEventListener('click', copyShareLink);
});

// Кодирование данных для передачи в URL (Stateless Base64 URL-safe)
function encodeShareData(data) {
    const bytes = new TextEncoder().encode(JSON.stringify(data));
    let binary = '';
    bytes.forEach(byte => { binary += String.fromCharCode(byte); });
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function decodeShareData(encodedData) {
    if (!encodedData || typeof encodedData !== 'string') return null;
    try {
        let base64 = encodedData.replace(/-/g, '+').replace(/_/g, '/');
        while (base64.length % 4) { base64 += '='; }
        const binary = atob(base64);
        const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
        return JSON.parse(new TextDecoder().decode(bytes));
    } catch {
        return null;
    }
}

// Функция для создания ссылки общего доступа (Stateless URL)
function createShareLink() {
    const regmid = document.getElementById('regmid')?.value;
    const regend = document.getElementById('regend')?.value;
    const regterm = document.getElementById('regterm')?.value;
    const finalVal = document.getElementById('final')?.value;

    const shareData = {
        rm: regmid || undefined,
        re: regend || undefined,
        rt: regterm || undefined,
        f: finalVal || undefined,
        m: mode
    };

    const encoded = encodeShareData(shareData);
    const shareUrl = `${window.location.origin}${window.location.pathname}?d=${encoded}`;

    const linkInput = document.getElementById('share-link');
    const section = document.getElementById('shareSection');
    if (linkInput) linkInput.value = shareUrl;
    if (section) {
        section.style.display = 'block';
        if (typeof section.scrollIntoView === 'function') {
            section.scrollIntoView({ behavior: 'smooth' });
        }
    }

    showComment(translationHTML('share_created'), 'success');
}

// Функция для загрузки данных из ссылки
function loadFromShareLink() {
    const urlParams = new URLSearchParams(window.location.search);
    let shareData = null;

    let shareLinks = {};
    try { shareLinks = JSON.parse(readPreference('gradeMaster_shareLinks') || '{}') || {}; } catch { /* Ignore corrupt saved links. */ }

    const dParam = urlParams.get('d') || urlParams.get('data');
    if (dParam) {
        try {
            shareData = decodeShareData(dParam);
        } catch {
            showComment(translationHTML('invalid_link'), 'danger');
            return false;
        }
    } else if (urlParams.has('rm') || urlParams.has('re') || urlParams.has('regmid') || urlParams.has('regend')) {
        shareData = {
            rm: urlParams.get('rm') || urlParams.get('regmid'),
            re: urlParams.get('re') || urlParams.get('regend'),
            rt: urlParams.get('rt') || urlParams.get('regterm'),
            f: urlParams.get('f') || urlParams.get('final'),
            m: urlParams.get('m') || urlParams.get('mode')
        };
    } else if (urlParams.has('share')) {
        const shareId = urlParams.get('share');
        shareData = shareLinks[shareId];
        if (!shareData) {
            showComment(translationHTML('invalid_link'), 'danger');
            return false;
        }
        if (shareData.expires && Date.now() > shareData.expires) {
            delete shareLinks[shareId];
            savePreference('gradeMaster_shareLinks', JSON.stringify(shareLinks));
            showComment(translationHTML('expired_link'), 'danger');
            return false;
        }
    }

    if (!shareData) return false;

    const regmid = shareData.rm ?? shareData.regmid;
    const regend = shareData.re ?? shareData.regend;
    const regterm = shareData.rt ?? shareData.regterm;
    const finalVal = shareData.f ?? shareData.final;
    const modeVal = shareData.m ?? shareData.mode;

    const midEl = document.getElementById('regmid');
    const endEl = document.getElementById('regend');
    const termEl = document.getElementById('regterm');
    const finEl = document.getElementById('final');

    if (midEl && regmid !== undefined && regmid !== null && regmid !== '') midEl.value = String(regmid);
    if (endEl && regend !== undefined && regend !== null && regend !== '') endEl.value = String(regend);
    if (termEl && regterm !== undefined && regterm !== null && regterm !== '') termEl.value = String(regterm);
    if (finEl && finalVal !== undefined && finalVal !== null && finalVal !== '') finEl.value = String(finalVal);

    if (['serious', 'standard', 'evil'].includes(modeVal)) {
        changeMode(modeVal);
    }

    showComment(translationHTML('share_loaded'), 'success');

    const hasRegData = (regmid && regend) || regterm;
    if (hasRegData) {
        calculate();
    }

    return true;
}

// Функция для копирования ссылки в буфер обмена
function copyShareLink() {
    const shareLinkInput = document.getElementById('share-link');
    if (!shareLinkInput) return;
    shareLinkInput.select();
    if (shareLinkInput.setSelectionRange) shareLinkInput.setSelectionRange(0, 99999);

    if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(shareLinkInput.value).then(() => {
            showComment(translationHTML('link_copied'), 'success');
        }).catch(() => {
            try { document.execCommand('copy'); showComment(translationHTML('link_copied'), 'success'); } catch {}
        });
    } else {
        try { document.execCommand('copy'); showComment(translationHTML('link_copied'), 'success'); } catch {}
    }
}

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

    // Создаем объект для перевода ключей в текст
    const commentTexts = {
        serious: {
            empty: [translationHTML('empty_msg_1'), translationHTML('empty_msg_2')],
            invalid: [translationHTML('invalid_msg_1'), translationHTML('invalid_msg_2')],
            pass: [translationHTML('pass_msg_1'), translationHTML('pass_msg_2')],
            fail: [translationHTML('standard_fail_1'), translationHTML('standard_fail_2')],
            scholarship: [translationHTML('standard_scholarship_1'), translationHTML('standard_scholarship_2')],
            highScholarship: [translationHTML('standard_high_scholarship_1'), translationHTML('standard_high_scholarship_2')],
            high: [translationHTML('standard_high_1'), translationHTML('standard_high_2')],
            alreadyFailed: [translationHTML('already_failed_1'), translationHTML('already_failed_2')],
            prediction: [translationHTML('prediction_msg_1'), translationHTML('prediction_msg_2')]
        },
        standard: {
            empty: [translationHTML('standard_empty_1'), translationHTML('standard_empty_2')],
            invalid: [translationHTML('standard_invalid_1'), translationHTML('standard_invalid_2')],
            pass: [translationHTML('standard_pass_1'), translationHTML('standard_pass_2')],
            fail: [translationHTML('standard_fail_1'), translationHTML('standard_fail_2')],
            scholarship: [translationHTML('standard_scholarship_1'), translationHTML('standard_scholarship_2')],
            highScholarship: [translationHTML('standard_high_scholarship_1'), translationHTML('standard_high_scholarship_2')],
            high: [translationHTML('standard_high_1'), translationHTML('standard_high_2')],
            alreadyFailed: [translationHTML('already_failed_1'), translationHTML('already_failed_2')],
            prediction: [translationHTML('prediction_msg_1'), translationHTML('prediction_msg_2')]
        },
        evil: {
            empty: [translationHTML('evil_empty_1'), translationHTML('evil_empty_2')],
            invalid: [translationHTML('evil_invalid_1'), translationHTML('evil_invalid_2')],
            pass: [translationHTML('evil_pass_1'), translationHTML('evil_pass_2')],
            fail: [translationHTML('evil_fail_1'), translationHTML('evil_fail_2')],
            scholarship: [translationHTML('evil_scholarship_1'), translationHTML('evil_scholarship_2')],
            highScholarship: [translationHTML('evil_high_scholarship_1'), translationHTML('evil_high_scholarship_2')],
            high: [translationHTML('evil_high_1'), translationHTML('evil_high_2')],
            alreadyFailed: [translationHTML('evil_already_failed_1'), translationHTML('evil_already_failed_2')],
            prediction: [translationHTML('prediction_msg_1'), translationHTML('prediction_msg_2')]
        }
    };

    // Определяем РегТерм - либо напрямую, либо вычисляем из РегМида и РегЭнда
    let regterm;
    let regtermSource = "";

    if (regtermDirect !== null && !isNaN(regtermDirect)) {
        // Используем прямой ввод РегТерма
        regterm = regtermDirect;
        regtermSource = getTranslation('regterm_direct_input');

        // Проверяем валидность прямого ввода РегТерма
        if (regterm < 0 || regterm > 100) {
            resultDiv.className = 'result danger show';
            resultDiv.innerHTML = `<h2>❌ ${translationHTML('att_error')}</h2><p>${pick(commentTexts[mode].invalid)}</p>`;
            return;
        }
    } else {
        // Вычисляем РегТерм из РегМида и РегЭнда
        if (isNaN(regmid) || isNaN(regend)) {
            resultDiv.className = 'result danger show';
            resultDiv.innerHTML = `<h2>❌ ${translationHTML('att_error')}</h2><p>${pick(commentTexts[mode].empty)}</p>`;
            return;
        }

        if (regmid < 0 || regmid > 100 || regend < 0 || regend > 100) {
            resultDiv.className = 'result danger show';
            resultDiv.innerHTML = `<h2>❌ ${translationHTML('att_error')}</h2><p>${pick(commentTexts[mode].invalid)}</p>`;
            return;
        }

        regterm = (regmid + regend) / 2;
        regtermSource = getTranslation('regterm_calculated');
    }

    if (finalInput !== '' && (!Number.isFinite(final) || final < 0 || final > 100)) {
        resultDiv.className = 'result danger show';
        resultDiv.innerHTML = `<h2>❌ ${translationHTML('att_error')}</h2><p>${translationHTML('error_invalid')}</p>`;
        return;
    }

    // РЕЖИМ ПРОГНОЗА
    if (finalInput === '') {
        let predictionHTML = `<h2>🔮 ${pick(commentTexts[mode].prediction)}</h2>`;
        predictionHTML += `<p style="margin-bottom: 15px;"><strong>${translationHTML('regterm_display', {value: regterm.toFixed(2), source: ''})}${translationHTML(regtermDirect !== null ? 'regterm_direct_input' : 'regterm_calculated')}</strong></p>`;

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
                const msg = translationHTML(msgKey);
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
                const msg = translationHTML(msgKey);
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
            const msg = translationHTML(msgKey);
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
        predictionHTML += `<p style="margin-bottom: 10px;"><strong>${translationHTML('for_pass')}</strong></p>`;
        if (minForPass <= 100) {
            const passEmoji = minForPass >= 90 ? '🔥' : minForPass >= 70 ? '🟡' : '🟢';
            let passComment = '';
            if (mode === 'evil') {
                if (minForPass >= 90) passComment = translationHTML('evil_pass_comment_hard');
                else if (minForPass >= 70) passComment = translationHTML('evil_pass_comment_medium');
                else passComment = translationHTML('evil_pass_comment_easy');
            } else if (mode === 'serious') {
                passComment = translationHTML('serious_pass_comment');
            } else {
                if (minForPass >= 90) passComment = translationHTML('standard_pass_comment_hard');
                else if (minForPass >= 70) passComment = translationHTML('standard_pass_comment_medium');
                else passComment = translationHTML('standard_pass_comment_easy');
            }
            predictionHTML += `<p>${passEmoji} ${translationHTML('minimum_points', {value: minForPass.toFixed(1)})}${passComment}</p>`;
        } else {
            predictionHTML += `<p>❌ ${translationHTML('impossible_pass', {value: minForPass.toFixed(1)})}</p>`;
        }

        predictionHTML += '<hr style="margin: 15px 0; border: none; border-top: 1px solid #ddd;">';

        // Для обычной стипендии
        predictionHTML += `<p style="margin-bottom: 10px;"><strong>${translationHTML('for_regular_scholarship')}</strong></p>`;
        if (minForScholarship <= 100) {
            const schEmoji = minForScholarship >= 95 ? '💎' : minForScholarship >= 80 ? '⭐' : '✨';
            let schComment = '';
            if (mode === 'evil') {
                if (minForScholarship >= 95) schComment = translationHTML('evil_scholarship_comment_fantasy');
                else if (minForScholarship >= 80) schComment = translationHTML('evil_scholarship_comment_hard');
                else schComment = translationHTML('evil_scholarship_comment_medium');
            } else if (mode === 'serious') {
                schComment = '';
            } else {
                if (minForScholarship >= 95) schComment = translationHTML('standard_scholarship_comment_hard');
                else if (minForScholarship >= 80) schComment = translationHTML('standard_scholarship_comment_medium');
                else schComment = translationHTML('standard_scholarship_comment_easy');
            }
            predictionHTML += `<p>${schEmoji} ${translationHTML('minimum_points', {value: Math.max(50, minForScholarship).toFixed(1)})}${schComment}</p>`;
        } else {
            const impossibleMsgKey = mode === 'evil'
                ? 'impossible_scholarship_evil'
                : 'impossible_scholarship_standard';
            const impossibleMsg = translationHTML(impossibleMsgKey);
            predictionHTML += `<p>❌ ${impossibleMsg}</p>`;
        }

        predictionHTML += '<hr style="margin: 15px 0; border: none; border-top: 1px solid #ddd;">';

        // Для повышенной стипендии
        predictionHTML += `<p style="margin-bottom: 10px;"><strong>${translationHTML('for_high_scholarship')}</strong></p>`;
        if (minForHighScholarship <= 100) {
            const highSchEmoji = minForHighScholarship >= 95 ? '🚀' : minForHighScholarship >= 85 ? '💎' : '⭐';
            let highSchComment = '';
            if (mode === 'evil') {
                if (minForHighScholarship >= 95) highSchComment = translationHTML('evil_high_scholarship_comment_fantasy');
                else if (minForHighScholarship >= 85) highSchComment = translationHTML('evil_high_scholarship_comment_hard');
                else highSchComment = translationHTML('evil_high_scholarship_comment_easy');
            } else if (mode === 'serious') {
                if (minForHighScholarship >= 95) highSchComment = translationHTML('serious_scholarship_comment_hard');
                else if (minForHighScholarship >= 85) highSchComment = translationHTML('serious_scholarship_comment_medium');
                else highSchComment = translationHTML('serious_scholarship_comment_easy');
            } else {
                if (minForHighScholarship >= 95) highSchComment = translationHTML('high_comment_hard');
                else if (minForHighScholarship >= 85) highSchComment = translationHTML('standard_pass_comment_hard');
                else highSchComment = translationHTML('high_comment_easy');
            }
            predictionHTML += `<p>${highSchEmoji} ${translationHTML('minimum_points', {value: Math.max(50, minForHighScholarship).toFixed(1)})}${highSchComment}</p>`;
        } else {
            const impossibleHighMsg = mode === 'evil'
                ? translationHTML('high_impossible_evil')
                : translationHTML('high_impossible');
            predictionHTML += `<p>❌ ${impossibleHighMsg}</p>`;
        }

        predictionHTML += '</div>';

        if (mode === 'evil') {
            if (regScore <= 50) {
                predictionHTML += `<p>${translationHTML('evil_tip_study')}</p>`;
            }
            if (regScore > 50) {
                predictionHTML += `<p>${translationHTML('evil_tip_lucky')}</p>`;
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
    let message = '';
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
        message = `<h2>${translationHTML('failed_title')}</h2>`;
        comment = pick(commentTexts[mode].fail);
    } else if (final >= 25 && final < 50) {
        status = 'warning';
        message = `<h2>${translationHTML('retake_title')}</h2>`;
        if (mode === 'evil') {
            comment = translationHTML('retake_evil');
        } else if (mode === 'serious') {
            comment = translationHTML('retake_serious');
        } else {
            comment = translationHTML('retake_standard');
        }
    } else if (total < 70) {
        status = 'warning';
        message = `<h2>${translationHTML('pass_title')}</h2>`;
        comment = pick(commentTexts[mode].pass);
    } else if (total >= 90) {
        status = 'success';
        message = `<h2>${translationHTML('high_scholarship_title')}</h2>`;
        comment = pick(commentTexts[mode].highScholarship);
    } else if (total >= 70) {
        status = 'success';
        message = `<h2>${translationHTML('scholarship_title')}</h2>`;
        comment = pick(commentTexts[mode].scholarship);
    }

    const detailsText = translationHTML('details_calculation', {regterm: regterm.toFixed(2), total: total.toFixed(2)});

    resultDiv.className = `result ${status} show`;
    resultDiv.innerHTML = message + `<p>${comment}</p><p class="score">${detailsText}</p>`;
}


function pick(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
}

function revealSecret() {
    const secrets = [
        getTranslation('secret_extra_1'),
        getTranslation('secret_extra_2'),
        getTranslation('secret_extra_3'),
        getTranslation('secret_extra_4'),
        getTranslation('secret_manual_check'),
        getTranslation('secret_rare_user'),
        getTranslation('secret_easter_egg'),
        getTranslation('secret_leak'),
        getTranslation('secret_hack'),
        getTranslation('secret_success'),
        getTranslation('secret_warning'),
        getTranslation('secret_difference'),
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
