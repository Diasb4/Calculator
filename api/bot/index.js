// api/bot/index.js
// Универсальный Telegram-бот GradeMaster (@aitugrademaster_bot)
// Полноценная замена веб-сайта GradeMaster прямо в Telegram.
// Работает и как Vercel Serverless Webhook (/api/bot), и как локальный Long-Polling скрипт.

const aitu = require('./aitu.js');
const lms = require('./lms.js');
const statsEngine = require('../stats/engine.js');
function getBotToken() {
    return (process.env.TELEGRAM_BOT_TOKEN || '').trim();
}

function getApiBase() {
    return `https://api.telegram.org/bot${getBotToken()}`;
}

const RAW_ADMIN_IDS = (process.env.ADMIN_CHAT_ID || process.env.TELEGRAM_CHAT_ID || '').trim();
const ADMIN_CHAT_IDS = RAW_ADMIN_IDS
    ? RAW_ADMIN_IDS.split(/[,\s;]+/).map(s => s.trim()).filter(Boolean)
    : [];
const ADMIN_CHAT_ID = ADMIN_CHAT_IDS[0] || '';
const WEBAPP_URL = process.env.WEBAPP_URL || 'https://calculator-not-404.vercel.app';

function getAdminChatIds() {
    const raw = (process.env.ADMIN_CHAT_ID || process.env.TELEGRAM_CHAT_ID || '').trim();
    if (raw) {
        return raw.split(/[,\s;]+/).map(s => s.trim()).filter(Boolean);
    }
    return ADMIN_CHAT_IDS;
}

function getPrimaryAdminId() {
    const ids = getAdminChatIds();
    return ids[0] || ADMIN_CHAT_ID || '';
}

const ATTENDANCE_WEEKS = 10;
const ATTENDANCE_LIMIT_PERCENT = 0.30;

// Хранилище сессий пользователей (для пошаговых диалогов)
// В serverless сохраняется в памяти инстанса с TTL
const userSessions = new Map();
// Хранилище списка пользователей для рассылки админа
const activeUsers = new Set();
for (const id of ADMIN_CHAT_IDS) {
    activeUsers.add(id);
}

// Хранилище таймаута на сообщения пользователей (1 сообщение в 5 минут для NLP и фидбека)
const userRateLimits = new Map(); // chatId -> timestamp
const userCourseListMemory = new Map(); // chatId + '_lms' / '_learn' -> Array<courseName>
const RATE_LIMIT_COOLDOWN_MS = 5 * 60 * 1000; // 5 минут

function checkRateLimit(chatId) {
    if (isAdmin(chatId)) {
        return { allowed: true };
    }
    const strId = String(chatId);
    const last = userRateLimits.get(strId);
    const now = Date.now();
    if (last && now - last < RATE_LIMIT_COOLDOWN_MS) {
        const remainingSec = Math.ceil((RATE_LIMIT_COOLDOWN_MS - (now - last)) / 1000);
        const remainingMin = Math.ceil(remainingSec / 60);
        return {
            allowed: false,
            remainingSec,
            remainingMin,
            message: `⏳ <b>Пожалуйста, подождите:</b> отправка свободных запросов и сообщений ограничена 1 раз в 5 минут.\n` +
                     `Следующее сообщение можно отправить через <b>${remainingMin} мин.</b>\n\n` +
                     `<i>💡 Кнопки меню и стандартные калькуляторы работают без ограничений!</i>`
        };
    }
    return { allowed: true };
}

function recordRateLimit(chatId) {
    if (isAdmin(chatId)) return;
    userRateLimits.set(String(chatId), Date.now());
}

function getSession(chatId) {
    const id = String(chatId);
    if (!userSessions.has(id)) {
        userSessions.set(id, { step: null, data: {}, lastActive: Date.now() });
    }
    const session = userSessions.get(id);
    session.lastActive = Date.now();
    return session;
}

function clearSession(chatId) {
    userSessions.delete(String(chatId));
}

// ==========================================
// TELEGRAM API CLIENT
// ==========================================

async function apiCall(method, payload = {}) {
    const token = getBotToken();
    if (!token) {
        throw new Error('TELEGRAM_BOT_TOKEN environment variable is not configured');
    }
    const response = await fetch(`${getApiBase()}/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });
    const data = await response.json();
    if (!data.ok) {
        console.error(`Telegram API [${method}] Error:`, data);
        throw new Error(data.description || 'Unknown Telegram API error');
    }
    return data.result;
}

async function sendMessage(chatId, text, options = {}) {
    return apiCall('sendMessage', {
        chat_id: chatId,
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
        ...options
    });
}

async function answerCallbackQuery(callbackQueryId, text = '', showAlert = false) {
    return apiCall('answerCallbackQuery', {
        callback_query_id: callbackQueryId,
        text,
        show_alert: showAlert
    }).catch(() => {});
}

async function editMessageText(chatId, messageId, text, options = {}) {
    return apiCall('editMessageText', {
        chat_id: chatId,
        message_id: messageId,
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
        ...options
    }).catch(() => {});
}

function esc(str) {
    return String(str ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function isAdmin(chatId) {
    if (!chatId) return false;
    const strId = String(chatId).trim();
    return getAdminChatIds().includes(strId);
}

// ==========================================
// КЛАВИАТУРЫ И МЕНЮ
// ==========================================

function getMainKeyboard(chatId) {
    const isUserAdmin = isAdmin(chatId);
    const keyboard = [
        [{ text: 'Итоговая оценка' }, { text: 'Калькулятор GPA' }],
        [{ text: 'Кумулятивный GPA' }, { text: 'Посещаемость' }],
        [{ text: 'Конвертер GPA' }, { text: 'Отзыв / Поддержка' }],
        [{ text: 'Инструкция' }, { text: 'Открыть сайт', web_app: { url: WEBAPP_URL } }]
    ];

    if (isUserAdmin) {
        keyboard.unshift(
            [{ text: 'Панель Администратора' }, { text: '📝 Квизы AITU' }, { text: '📚 Дедлайны LMS' }]
        );
    } else {
        const strId = String(chatId);
        const hasAitu = Boolean(chatId && aitu._userSessionsMemory && aitu._userSessionsMemory.has(strId));
        const hasLms = Boolean(chatId && lms._lmsUserSessionsMemory && lms._lmsUserSessionsMemory.has(strId));
        if (hasAitu && hasLms) {
            keyboard.unshift([{ text: '📝 Мои квизы AITU' }, { text: '📚 Дедлайны LMS' }]);
        } else if (hasAitu) {
            keyboard.unshift([{ text: '📝 Мои квизы AITU' }]);
        } else if (hasLms) {
            keyboard.unshift([{ text: '📚 Дедлайны LMS' }]);
        }
    }

    return {
        keyboard,
        resize_keyboard: true
    };
}

function getCancelKeyboard() {
    return {
        keyboard: [
            [{ text: '❌ Отмена / Главное меню' }]
        ],
        resize_keyboard: true
    };
}

function getCalculatorsInlineKeyboard() {
    return {
        inline_keyboard: [
            [
                { text: 'Оценка (РегМид/Энд)', callback_data: 'wiz_total' },
                { text: 'GPA триместра', callback_data: 'wiz_gpa' }
            ],
            [
                { text: 'Общий GPA (Кумулятив)', callback_data: 'wiz_cgpa' },
                { text: 'Посещаемость', callback_data: 'wiz_att' }
            ],
            [
                { text: 'Конвертер % в GPA', callback_data: 'wiz_conv' },
                { text: 'Написать админу', callback_data: 'wiz_feed' }
            ],
            [
                { text: '🍪 Инструкция: как подключить куки', callback_data: 'wiz_cookie_guide' }
            ]
        ]
    };
}

// ==========================================
// МАТЕМАТИЧЕСКАЯ И АКАДЕМИЧЕСКАЯ ЛОГИКА
// ==========================================

// Конвертация процента в GPA (0 - 4.00) и буквенную оценку
function percentageToGradeInfo(percentage) {
    const p = parseFloat(percentage);
    if (isNaN(p) || p < 0 || p > 100) return null;

    if (p >= 95) return { gpa: 4.00, letter: 'A', ects: 'A', desc: 'Отлично (Excellent)', status: 'success', emoji: '💎' };
    if (p >= 90) return { gpa: 3.67, letter: 'A-', ects: 'B', desc: 'Отлично (Very Good)', status: 'success', emoji: '🌟' };
    if (p >= 85) return { gpa: 3.33, letter: 'B+', ects: 'C', desc: 'Хорошо (Good)', status: 'success', emoji: '✅' };
    if (p >= 80) return { gpa: 3.00, letter: 'B', ects: 'C', desc: 'Хорошо (Satisfactory Good)', status: 'success', emoji: '👍' };
    if (p >= 75) return { gpa: 2.67, letter: 'B-', ects: 'D', desc: 'Хорошо (Above Average)', status: 'warning', emoji: '👌' };
    if (p >= 70) return { gpa: 2.33, letter: 'C+', ects: 'D', desc: 'Удовлетворительно (Average)', status: 'warning', emoji: '⚠️' };
    if (p >= 65) return { gpa: 2.00, letter: 'C', ects: 'E', desc: 'Удовлетворительно (Fair)', status: 'warning', emoji: '⚠️' };
    if (p >= 60) return { gpa: 1.67, letter: 'C-', ects: 'E', desc: 'Удовлетворительно (Passing)', status: 'warning', emoji: '⚠️' };
    if (p >= 55) return { gpa: 1.33, letter: 'D+', ects: 'FX', desc: 'Удовлетворительно (Poor)', status: 'warning', emoji: '⚠️' };
    if (p >= 50) return { gpa: 1.00, letter: 'D', ects: 'FX', desc: 'Минимально зачтено (Barely Passing)', status: 'warning', emoji: '⚠️' };
    return { gpa: 0.00, letter: 'F', ects: 'F', desc: 'Неудовлетворительно / Летник', status: 'danger', emoji: '❌' };
}

// 1. Калькулятор итоговой оценки
function calculateGradeReport(regmid, regend, finalGrade = null, isGauharUser = false) {
    regmid = parseFloat(regmid);
    regend = parseFloat(regend);

    if (isNaN(regmid) || isNaN(regend) || regmid < 0 || regmid > 100 || regend < 0 || regend > 100) {
        return '❌ <b>Ошибка ввода:</b> Оценки должны быть числами от 0 до 100.\n<i>Пример:</i> <code>80 85</code> или <code>80 85 90</code>';
    }

    if (regmid < 25) {
        return `❌ <b>Летник без вариантов!</b> 💀\n\n` +
            `• РегМид: <b>${regmid}</b> (порог — минимум 25 баллов).\n` +
            `• Допуск к экзамену заблокирован. Предмет отправляется на летний семестр (Retake).`;
    }
    if (regend < 25) {
        return `❌ <b>Летник без вариантов!</b> 💀\n\n` +
            `• РегЭнд: <b>${regend}</b> (порог — минимум 25 баллов).\n` +
            `• Допуск к экзамену заблокирован. Предмет отправляется на летний семестр (Retake).`;
    }

    const regterm = (regmid + regend) / 2;

    if (regterm < 50) {
        return `❌ <b>Летник!</b> 🚫\n\n` +
            `• РегТерм: <b>${regterm.toFixed(2)}</b> (нужно минимум 50.00 для допуска).\n` +
            `• Вы не набрали допуск к файналу.`;
    }

    // Если введен файнал
    if (finalGrade !== null && finalGrade !== undefined && String(finalGrade).trim() !== '') {
        const finalVal = parseFloat(finalGrade);
        if (isNaN(finalVal) || finalVal < 0 || finalVal > 100) {
            return '❌ <b>Ошибка:</b> Оценка за файнал должна быть числом от 0 до 100.';
        }

        const total = (regterm * 0.6) + (finalVal * 0.4);
        const gradeInfo = percentageToGradeInfo(total);

        let verdict = '';
        if (finalVal < 25) {
            verdict = `❌ <b>Летник!</b> Оценка за файнал (${finalVal}) ниже порога 25 баллов.`;
        } else if (finalVal >= 25 && finalVal < 50) {
            verdict = `⚠️ <b>Пересдача (FX / Retake)!</b> Файнал от 25 до 49 баллов. Готовьтесь к пересдаче экзамена.`;
        } else if (total < 50) {
            verdict = `❌ <b>Летник!</b> Итоговый балл ниже 50.00.`;
        } else if (total >= 90) {
            verdict = `💎 <b>ПРЕВОСХОДНО! Повышенная стипендия гарантирована!</b> 🎉`;
        } else if (total >= 70) {
            verdict = `✅ <b>ОТЛИЧНО! Обычная стипендия ваша!</b> 👏`;
        } else {
            verdict = `⚠️ <b>Курс успешно сдан</b> (без стипендии, итоговый балл ${total.toFixed(2)}).`;
        }

        let gauharNote = '';
        if (isGauharUser) {
            if (total >= 70) {
                gauharNote = `\n\n🌟 <i>Ого, стипендия на горизонте! Главное теперь — не забудь карту, на которую её перечислят 💳</i>`;
            } else {
                gauharNote = `\n\n⚠️ <i>Гаухар, главное на экзамен не забудь прийти! Паспорт, ручку и голову возьми с собой обязательно 🧠</i>`;
            }
        }

        return `🎯 <b>ИТОГОВЫЙ РАСЧЁТ ОЦЕНКИ:</b>\n\n` +
            `📊 <b>РегТерм (60%):</b> ${regterm.toFixed(2)} (РегМид: ${regmid}, РегЭнд: ${regend})\n` +
            `📝 <b>Файнал (40%):</b> ${finalVal}\n` +
            `🏆 <b>Итоговый балл:</b> <code>${total.toFixed(2)}</code> (${gradeInfo ? gradeInfo.letter + ', GPA ' + gradeInfo.gpa.toFixed(2) : ''})\n\n` +
            `${verdict}\n\n` +
            `<i>💡 Формула: (РегТерм × 0.6) + (Файнал × 0.4)</i>` +
            gauharNote;
    }

    // Прогноз на файнал (если файнал еще не сдан)
    const minPass = Math.max(50, Math.ceil((50 - (regterm * 0.6)) / 0.4));
    const minRegular = Math.ceil((70 - (regterm * 0.6)) / 0.4);
    const minHigh = Math.ceil((90 - (regterm * 0.6)) / 0.4);

    let report = `🔮 <b>ПРОГНОЗ НА ЭКЗАМЕН (ФАЙНАЛ):</b>\n\n` +
        `📊 <b>Ваш РегТерм:</b> <code>${regterm.toFixed(2)}</code> (РегМид: ${regmid} | РегЭнд: ${regend})\n` +
        `🎯 <i>Сколько нужно набрать на экзамене:</i>\n\n`;

    if (minPass > 100) {
        report += `❌ <b>Для сдачи курса (50+):</b> Невозможно (требуется более 100 баллов)\n`;
    } else {
        report += `🟢 <b>Для сдачи курса (50+):</b> минимум <b>${Math.max(50, minPass)}</b> баллов\n`;
    }

    if (minRegular > 100) {
        report += `🟡 <b>Обычная стипендия (70+):</b> Невозможна при текущем РегТерме\n`;
    } else if (minRegular <= 50) {
        report += `🟡 <b>Обычная стипендия (70+):</b> Достаточно сдать экзамен (от <b>50</b> баллов)!\n`;
    } else {
        report += `🟡 <b>Обычная стипендия (70+):</b> минимум <b>${minRegular}</b> баллов\n`;
    }

    if (minHigh > 100) {
        report += `💎 <b>Повышенная стипендия (90+):</b> Невозможна\n`;
    } else if (minHigh <= 50) {
        report += `💎 <b>Повышенная стипендия (90+):</b> Достаточно сдать экзамен на <b>50+</b>!\n`;
    } else {
        report += `💎 <b>Повышенная стипендия (90+):</b> минимум <b>${minHigh}</b> баллов\n`;
    }

    let gauharNote = '';
    if (isGauharUser) {
        if (minRegular <= 70) {
            gauharNote = `\n\n🌟 <i>Ого, стипендия на горизонте! Главное теперь — не забудь карту, на которую её перечислят 💳</i>`;
        } else {
            gauharNote = `\n\n⚠️ <i>Гаухар, главное на экзамен не забудь прийти! Паспорт, ручку и голову возьми с собой обязательно 🧠</i>`;
        }
    }

    report += `\n<i>⚠️ Важно: на самом экзамене необходимо набрать не менее 50 баллов для сдачи без пересдачи.</i>` + gauharNote;
    return report;
}

// 2. Калькулятор GPA за семестр/триместр
function calculateGPAReport(inputStr, isGauharUser = false) {
    if (!inputStr || typeof inputStr !== 'string') {
        return '❌ <b>Введите оценки и кредиты!</b>\n<i>Пример:</i> <code>90 3, 85 4, 95 2</code>\n(Балл_1 Кредиты_1, Балл_2 Кредиты_2)';
    }

    const items = inputStr.split(/[,;\n]+/).map(s => s.trim()).filter(Boolean);
    if (items.length === 0) {
        return '❌ <b>Не удалось распознать предметы.</b>\n<i>Пример:</i> <code>/gpa 90 3, 85 4, 95 2</code>';
    }

    const letterMap = {
        'A+': { gpa: 4.0, letter: 'A+', percent: 95, emoji: '💎' },
        'A': { gpa: 4.0, letter: 'A', percent: 95, emoji: '💎' },
        'A-': { gpa: 3.67, letter: 'A-', percent: 90, emoji: '🌟' },
        'B+': { gpa: 3.33, letter: 'B+', percent: 85, emoji: '🟢' },
        'B': { gpa: 3.0, letter: 'B', percent: 80, emoji: '🟢' },
        'B-': { gpa: 2.67, letter: 'B-', percent: 75, emoji: '🟡' },
        'C+': { gpa: 2.33, letter: 'C+', percent: 70, emoji: '🟡' },
        'C': { gpa: 2.0, letter: 'C', percent: 65, emoji: '🟠' },
        'C-': { gpa: 1.67, letter: 'C-', percent: 60, emoji: '🟠' },
        'D+': { gpa: 1.33, letter: 'D+', percent: 55, emoji: '🔴' },
        'D': { gpa: 1.0, letter: 'D', percent: 50, emoji: '🔴' },
        'FX': { gpa: 0.0, letter: 'FX', percent: 35, emoji: '❌' },
        'F': { gpa: 0.0, letter: 'F', percent: 0, emoji: '❌' },
    };

    let totalQualityPoints = 0;
    let totalCredits = 0;
    const rows = [];

    for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const tokens = item.split(/\s+/).filter(Boolean);

        let gradeInfo = null;
        let grade = null;
        let credits = null;

        // Check if any token is a letter grade (A, B+, etc.)
        for (const token of tokens) {
            const up = token.toUpperCase();
            if (letterMap[up]) {
                gradeInfo = letterMap[up];
                grade = gradeInfo.percent;
                break;
            }
        }

        const nums = item.match(/\d+(?:\.\d+)?/g);
        if (gradeInfo && nums && nums.length >= 1) {
            credits = parseFloat(nums[nums.length - 1]);
        } else if (nums && nums.length >= 2) {
            credits = parseFloat(nums[nums.length - 1]);
            grade = parseFloat(nums[nums.length - 2]);
            gradeInfo = percentageToGradeInfo(grade);
        }

        if (grade === null || credits === null || isNaN(grade) || isNaN(credits)) {
            return `❌ <b>Ошибка в предмете #${i + 1} («${esc(item)}»):</b>\nУкажите и оценку (0-100 или букву), и кредиты. Пример: <code>85 3</code> или <code>A 4</code>`;
        }

        if (grade < 0 || grade > 100) {
            return `❌ <b>Ошибка в предмете #${i + 1}:</b> Оценка должна быть от 0 до 100% (получено: ${grade}).`;
        }

        if (credits <= 0) {
            return `❌ <b>Ошибка в предмете #${i + 1}:</b> Кредиты должны быть больше 0 (получено: ${credits}).`;
        }

        if (!gradeInfo) {
            gradeInfo = percentageToGradeInfo(grade);
        }

        const qualityPoints = gradeInfo.gpa * credits;
        totalQualityPoints += qualityPoints;
        totalCredits += credits;

        rows.push({
            num: i + 1,
            grade,
            credits,
            letter: gradeInfo.letter,
            gpa: gradeInfo.gpa,
            emoji: gradeInfo.emoji
        });
    }

    if (totalCredits === 0) {
        return '❌ Общее количество кредитов равно нулю.';
    }

    const finalGPA = totalQualityPoints / totalCredits;

    let verdict = '';
    if (finalGPA >= 3.67) verdict = '💎 <b>Превосходно! Отличный результат на повышенную стипендию!</b>';
    else if (finalGPA >= 3.00) verdict = '✅ <b>Отличный GPA! Стипендия в кармане!</b>';
    else if (finalGPA >= 2.00) verdict = '👍 <b>Хороший средний балл.</b>';
    else verdict = '⚠️ <b>Низкий GPA. Обратите внимание на академическую успеваемость.</b>';

    let msg = `📊 <b>РАСЧЁТ GPA ЗА ТРИМЕСТР:</b>\n\n`;
    rows.forEach(r => {
        msg += `${r.emoji} <b>Предмет ${r.num}:</b> ${r.grade}% ➔ <b>${r.letter}</b> (${r.gpa.toFixed(2)}) | <b>${r.credits} кр.</b>\n`;
    });

    msg += `\n━━━━━━━━━━━━━━━━━━━━\n` +
        `📚 <b>Всего кредитов:</b> <b>${totalCredits}</b>\n` +
        `🎓 <b>Итоговый GPA:</b> <code>${finalGPA.toFixed(2)}</code> / 4.00\n` +
        `━━━━━━━━━━━━━━━━━━━━\n\n` +
        `${verdict}`;

    if (isGauharUser) {
        msg += `\n\n📸 <i>Гаухар, сделай скриншот и запиши куда-нибудь, а то через 10 минут опять забудешь и будешь заново считать 😉</i>`;
    }

    return msg;
}

// 3. Калькулятор кумулятивного GPA
function calculateCumulativeGPAReport(inputStr, isGauharUser = false) {
    if (!inputStr || typeof inputStr !== 'string') {
        return '❌ <b>Введите GPA и кредиты триместров!</b>\n<i>Пример:</i> <code>3.5 15, 3.8 20, 3.2 18</code>\n(GPA_1 Кредиты_1, GPA_2 Кредиты_2)';
    }

    const items = inputStr.split(/[,;\n]+/).map(s => s.trim()).filter(Boolean);
    if (items.length === 0) {
        return '❌ <b>Не удалось распознать данные.</b>\n<i>Пример:</i> <code>/cgpa 3.5 15, 3.8 20</code>';
    }

    let totalQP = 0;
    let totalCredits = 0;
    const rows = [];

    for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const nums = item.match(/\d+(?:\.\d+)?/g);
        if (!nums || nums.length < 2) {
            return `❌ <b>Ошибка в триместре #${i + 1} («${esc(item)}»):</b>\nУкажите GPA (0.0-4.0) и кредиты. Пример: <code>3.67 18</code>`;
        }

        const credits = parseFloat(nums[nums.length - 1]);
        const gpa = parseFloat(nums[nums.length - 2]);

        if (isNaN(gpa) || gpa < 0 || gpa > 4.0) {
            return `❌ <b>Ошибка:</b> GPA в триместре #${i + 1} должен быть от 0.0 до 4.0 (получено: ${gpa}).`;
        }
        if (isNaN(credits) || credits <= 0) {
            return `❌ <b>Ошибка:</b> Кредиты в триместре #${i + 1} должны быть больше 0.`;
        }

        totalQP += gpa * credits;
        totalCredits += credits;
        rows.push({ num: i + 1, gpa, credits });
    }

    const cumGPA = totalCredits > 0 ? totalQP / totalCredits : 0;

    let msg = `📈 <b>КУМУЛЯТИВНЫЙ (ОБЩИЙ) GPA:</b>\n\n`;
    rows.forEach(r => {
        msg += `🗓 <b>Триместр ${r.num}:</b> GPA <b>${r.gpa.toFixed(2)}</b> × <b>${r.credits} кр.</b>\n`;
    });

    msg += `\n━━━━━━━━━━━━━━━━━━━━\n` +
        `📚 <b>Сумма кредитов за все периоды:</b> <b>${totalCredits}</b>\n` +
        `🎓 <b>Итоговый Cumulative GPA:</b> <code>${cumGPA.toFixed(2)}</code> / 4.00\n` +
        `━━━━━━━━━━━━━━━━━━━━\n\n` +
        `<i>💡 Рассчитывается как средневзвешенное значение по кредитам всех триместров.</i>`;

    if (isGauharUser) {
        msg += `\n\n📸 <i>Гаухар, сделай скриншот и запиши куда-нибудь, а то через 10 минут опять забудешь и будешь заново считать 😉</i>`;
    }

    return msg;
}

// 4. Калькулятор посещаемости
function calculateAttendanceReport(lessonsPerWeek, alreadyMissed = 0, isGauharUser = false) {
    const lessons = parseFloat(lessonsPerWeek);
    if (isNaN(lessons) || lessons < 1 || lessons > 20 || !Number.isInteger(lessons)) {
        return '❌ <b>Ошибка:</b> Количество пар в неделю должно быть целым числом от 1 до 20.\n<i>Пример:</i> <code>/att 3</code> или <code>/att 3 2</code> (где 2 — уже пропущено)';
    }

    const missed = parseFloat(alreadyMissed) || 0;
    if (isNaN(missed) || missed < 0 || !Number.isInteger(missed)) {
        return '❌ <b>Ошибка:</b> Количество пропущенных пар должно быть неотрицательным целым числом.';
    }

    const totalLessons = lessons * ATTENDANCE_WEEKS;
    const allowedAbsences = Math.floor(totalLessons * ATTENDANCE_LIMIT_PERCENT);
    const currentPercent = totalLessons > 0 ? (missed / totalLessons) * 100 : 0;
    const remaining = allowedAbsences - missed;

    // Визуальная шкала
    let bar = '';
    const safeSlots = Math.min(10, Math.round((missed / (allowedAbsences * 1.3 || 1)) * 10));
    for (let i = 0; i < 10; i++) {
        if (i < safeSlots) {
            if (i < 4) bar += '🟢';
            else if (i < 7) bar += '🟡';
            else bar += '🔴';
        } else {
            bar += '⚪';
        }
    }

    let statusHeader = '';
    if (missed > allowedAbsences || currentPercent >= 30) {
        statusHeader = '🚨 <b>КРИТИЧЕСКИЙ ЛИМИТ ПРЕВЫШЕН! НЕДОПУСК К ЭКЗАМЕНУ!</b> 💀';
    } else if (currentPercent > 15 || remaining <= 1) {
        statusHeader = '⚠️ <b>ВНИМАНИЕ! Вы близко к лимиту пропусков!</b>';
    } else {
        statusHeader = '🟢 <b>ВСЁ В ПОРЯДКЕ! Безопасная зона посещаемости.</b>';
    }

    let gauharNote = '';
    if (isGauharUser) {
        gauharNote = `\n\n🧠 <i>Гаухар, зная твою забывчивость, ты случайно прогуляешь на две пары больше, перепутаешь корпус и скажешь: «Ой, а я забыла, что сегодня вторник...» 📅😅 Не рискуй!</i>`;
    }

    return `📋 <b>РАСЧЁТ ПОСЕЩАЕМОСТИ (10 недель семестра):</b>\n\n` +
        `${statusHeader}\n\n` +
        `• Пар в неделю: <b>${lessons}</b>\n` +
        `• Всего занятий за семестр: <b>${totalLessons}</b>\n` +
        `• Порог недопуска (30%): <b>${allowedAbsences} пар максимум</b>\n` +
        `• Уже пропущено: <b>${missed} пар (${currentPercent.toFixed(1)}%)</b>\n\n` +
        `📊 <b>Шкала риска:</b>\n[${bar}]\n\n` +
        `🚪 <b>Осталось безопасных пропусков:</b> <b>${remaining >= 0 ? remaining : 0} пар</b>\n\n` +
        `💡 <i><b>Что считается за пару:</b> 1 занятие = 1 академический час (50 минут). Если у вас сдвоенная пара (100 минут) — это <b>2 занятия</b> в электронном журнале AITU!</i>\n\n` +
        `<i>⚠️ Важно: При пропуске ${allowedAbsences + 1} пар и более студент автоматически отправляется на летник без права сдачи экзамена.</i>` +
        gauharNote;
}

// 5. Конвертер процента в GPA
function convertGradeReport(scoreInput) {
    const score = parseFloat(scoreInput);
    if (isNaN(score) || score < 0 || score > 100) {
        return '❌ <b>Ошибка:</b> Введите балл от 0 до 100.\n<i>Пример:</i> <code>/convert 87</code>';
    }

    const info = percentageToGradeInfo(score);
    if (!info) return '❌ Некорректный балл.';

    return `🔄 <b>КОНВЕРТЕР ОЦЕНКИ:</b>\n\n` +
        `💯 <b>Балл:</b> <code>${score}%</code>\n` +
        `🎓 <b>GPA:</b> <code>${info.gpa.toFixed(2)}</code> / 4.00\n` +
        `🔤 <b>Буквенная оценка:</b> <b>${info.letter}</b> (ECTS: <b>${info.ects}</b>)\n` +
        `📝 <b>Традиционная шкала:</b> ${info.desc}\n` +
        `${info.emoji} <b>Статус:</b> ${info.status === 'success' ? 'Отличная оценка' : info.status === 'warning' ? 'Зачет / Проходной балл' : 'Неудовлетворительно'}`;
}

// 6. Парсер естественного языка для академических вопросов (Top-6)
function parseNaturalLanguageAcademicQuery(rawText, isGauharUser = false) {
    if (!rawText || typeof rawText !== 'string') return null;
    const text = rawText.toLowerCase().replace(/,/g, ' ').replace(/\s+/g, ' ');

    // Проверяем, похож ли запрос на академический вопрос
    const hasAcademicKeywords = /(?:файнал|экзамен|экз\b|final|exam|регмид|регенд|рм\b|рэ\b|rk1|rk2|midterm|endterm|стипенди|стипух|балл|оценк)/i.test(text);
    const hasQuestionIntent = /(?:сколько|хватит|нужно|надо|можно|выйдет|получится|допуск|сдам|сдать)/i.test(text);

    if (!hasAcademicKeywords || !hasQuestionIntent) {
        return null;
    }

    // 1. Извлекаем РегМид и РегЭнд
    let rm = null;
    let re = null;

    // Регмид
    const rmPattern1 = /(?:регмид|рег\s*мид|рм|midterm|mid|rk1|рк1)\s*[:=-]?\s*(\d{1,3}(?:\.\d+)?)/i;
    const rmPattern2 = /(\d{1,3}(?:\.\d+)?)\s*(?:за\s*)?(?:регмид|рег\s*мид|рм|midterm|mid|rk1|рк1)/i;
    let m = text.match(rmPattern1) || text.match(rmPattern2);
    if (m) rm = parseFloat(m[1]);

    // Регэнд
    const rePattern1 = /(?:регенд|рег\s*энд|рэ|endterm|end|rk2|рк2)\s*[:=-]?\s*(\d{1,3}(?:\.\d+)?)/i;
    const rePattern2 = /(\d{1,3}(?:\.\d+)?)\s*(?:за\s*)?(?:регенд|рег\s*энд|рэ|endterm|end|rk2|рк2)/i;
    m = text.match(rePattern1) || text.match(rePattern2);
    if (m) re = parseFloat(m[1]);

    // Если rm и re не найдены по отдельным меткам, пробуем паттерны типа "если 80 и 70" или "при 80 70"
    if (rm === null || re === null) {
        const pairMatch = text.match(/(?:если|при|у меня)\s+(?:балл[ыа]?\s+)?(\d{1,3})\s+(?:и|\s+)\s*(\d{1,3})/i);
        if (pairMatch) {
            rm = parseFloat(pairMatch[1]);
            re = parseFloat(pairMatch[2]);
        }
    }

    if (rm === null || re === null || isNaN(rm) || isNaN(re) || rm < 0 || rm > 100 || re < 0 || re > 100) {
        return null;
    }

    // 2. Проверяем допуск к экзамену в AITU
    if (rm < 25) {
        return `❌ <b>Недопуск к экзамену!</b> 💀\n\n` +
            `По правилам AITU балл за РегМид должен быть не менее <b>25</b> (у вас: <b>${rm}</b>).\n` +
            `К сожалению, вы не допущены к файналу и отправляетесь на повторный курс (Retake).`;
    }
    if (re < 25) {
        return `❌ <b>Недопуск к экзамену!</b> 💀\n\n` +
            `По правилам AITU балл за РегЭнд должен быть не менее <b>25</b> (у вас: <b>${re}</b>).\n` +
            `К сожалению, вы не допущены к файналу и отправляетесь на повторный курс (Retake).`;
    }

    const regterm = (rm + re) / 2;
    if (regterm < 50) {
        return `❌ <b>Недопуск к экзамену!</b> 🚫\n\n` +
            `Ваш РегТерм: <b>${regterm.toFixed(2)}</b> (РегМид: ${rm}, РегЭнд: ${re}).\n` +
            `Для допуска к экзамену средний балл РегТерм должен быть не менее <b>50.00</b>.`;
    }

    // 3. Проверяем наличие вопроса вида "хватит ли X на экзамене..."
    let givenFinal = null;
    const finalMatch = text.match(/(?:хватит\s+ли|если\s+(?:наберу|получу|сдам\s+на))\s+(\d{1,3}(?:\.\d+)?)/i) ||
                       text.match(/(?:на\s+файнал[еа]?|на\s+экзамен[еа]?)\s+(\d{1,3}(?:\.\d+)?)/i);
    if (finalMatch) {
        const cand = parseFloat(finalMatch[1]);
        if (!isNaN(cand) && cand >= 0 && cand <= 100 && cand !== rm && cand !== re) {
            givenFinal = cand;
        }
    }

    // 4. Проверяем целевую оценку/статус
    let target = null;
    let targetName = null;

    if (/повышенн\w*\s+стипенди\w*/i.test(text)) {
        target = 90;
        targetName = 'повышенную стипендию (A-)';
    } else if (/стипенди\w*|стипух\w*|стип\b/i.test(text)) {
        target = 70;
        targetName = 'обычную стипендию (C+)';
    } else if (/\b[aа]\+(?!\w)/i.test(text)) {
        target = 95;
        targetName = 'A+';
    } else if (/\b[aа]-(?!\w)/i.test(text)) {
        target = 90;
        targetName = 'A-';
    } else if (/\b[aа]\b/i.test(text) && !/на\s+файнал|на\s+экзамен/i.test(text)) {
        target = 95;
        targetName = 'A';
    } else if (/\b[bб]\+(?!\w)/i.test(text)) {
        target = 85;
        targetName = 'B+';
    } else if (/\b[bб]-(?!\w)/i.test(text)) {
        target = 75;
        targetName = 'B-';
    } else if (/\b[bб]\b/i.test(text)) {
        target = 80;
        targetName = 'B';
    } else if (/\b[cс]\+(?!\w)/i.test(text)) {
        target = 70;
        targetName = 'C+';
    } else if (/\b[cс]-(?!\w)/i.test(text)) {
        target = 60;
        targetName = 'C-';
    } else if (/\b[cс]\b/i.test(text)) {
        target = 65;
        targetName = 'C';
    } else if (/сдать|сдач\w*|зачет|проходн\w*/i.test(text)) {
        target = 50;
        targetName = 'сдачу предмета';
    }

    // Если был задан конкретный балл за файнал: "Хватит ли 75..."
    if (givenFinal !== null) {
        const total = (regterm * 0.6) + (givenFinal * 0.4);
        const gradeInfo = percentageToGradeInfo(total);

        // Порог сдачи файнала в AITU: минимум 50 баллов
        if (givenFinal < 50) {
            return `⚠️ <b>Хватит ли ${givenFinal} на экзамене?</b>\n\n` +
                `❌ <b>НЕТ, НЕ ХВАТИТ!</b>\n` +
                `По регламенту AITU на самом файнале необходимо набрать <b>минимум 50 баллов</b>.\n` +
                `При оценке ${givenFinal} студент направляется на пересдачу (FX / Retake), даже если суммарный балл выше 50!`;
        }

        const effectiveTarget = target !== null ? target : 70;
        const effTargetName = targetName || 'стипендию (70+)';
        const isEnough = total >= effectiveTarget;

        let verdict = isEnough
            ? `✅ <b>ДА, ХВАТИТ С ЗАПАСОМ!</b> 🎉`
            : `❌ <b>НЕТ, НЕ ХВАТИТ!</b> ⚠️`;

        let gauharTroll = '';
        if (isGauharUser) {
            gauharTroll = isEnough
                ? `\n\n🌟 <i>Гаухар, отличный расклад! Главное теперь — дойти до аудитории вовремя и не перепутать дату экзамена 🧠</i>`
                : `\n\n😅 <i>Гаухар, нужно поднажать! Отложи соцсети и учи конспекты прямо сейчас! ☕</i>`;
        }

        return `💡 <b>АНАЛИЗ ВАШЕГО ЗАПРОСА:</b>\n\n` +
            `${verdict}\n\n` +
            `• РегТерм (60%): <b>${regterm.toFixed(2)}</b> (РМ: ${rm}, РЭ: ${re})\n` +
            `• Проверяемый Файнал: <b>${givenFinal}</b>\n` +
            `• Итоговый балл: <code>${total.toFixed(2)}</code> (${gradeInfo ? gradeInfo.letter + ', GPA ' + gradeInfo.gpa.toFixed(2) : ''})\n` +
            `• Цель (${effTargetName}): <b>${effectiveTarget}</b> баллов\n\n` +
            `<i>Формула: (${regterm.toFixed(2)} × 0.6) + (${givenFinal} × 0.4) = ${total.toFixed(2)}</i>` +
            gauharTroll;
    }

    // Иначе вопрос вида "Сколько надо на файнале..."
    if (target !== null) {
        const needed = Math.ceil((target - (regterm * 0.6)) / 0.4);
        const finalNeeded = Math.max(50, needed); // минимум 50 в AITU

        let gauharTroll = '';
        if (isGauharUser) {
            gauharTroll = finalNeeded <= 65
                ? `\n\n🌟 <i>Гаухар, задача абсолютно реальная! Главное — поставь три будильника на утро экзамена ⏰</i>`
                : `\n\n☕️ <i>Гаухар, готовь термос с кофе — учить придётся усердно! 🧠</i>`;
        }

        if (needed > 100) {
            return `🎯 <b>Сколько нужно на экзамене для ${targetName}:</b>\n\n` +
                `❌ <b>Математически невозможно!</b> 😔\n` +
                `При РегТерме ${regterm.toFixed(2)} для цели ${target} требуется <b>${needed}</b> баллов (максимум за экзамен — 100).` +
                gauharTroll;
        }

        if (needed <= 50) {
            return `🎯 <b>Сколько нужно на экзамене для ${targetName}:</b>\n\n` +
                `🟢 <b>Вам достаточно сдать экзамен на 50 баллов!</b> 🥳\n` +
                `Благодаря высокому РегТерму (<b>${regterm.toFixed(2)}</b>) вы набираете цель сразу при преодолении минимального порога сдачи (50 баллов).` +
                gauharTroll;
        }

        return `🎯 <b>Сколько нужно на экзамене для ${targetName}:</b>\n\n` +
            `👉 Вам нужно набрать минимум <b>${finalNeeded} баллов</b> на файнале.\n\n` +
            `• РегТерм (60%): <b>${regterm.toFixed(2)}</b> (РМ: ${rm}, РЭ: ${re})\n` +
            `• Порог для ${targetName}: <b>${target}</b> баллов\n` +
            `<i>Расчёт: (${target} - ${regterm.toFixed(2)} × 0.6) / 0.4 = ${needed}</i>` +
            gauharTroll;
    }

    // Если целевая оценка не указана, выводим полный прогноз
    return `💡 <i>Распознан запрос: РегМид = ${rm}, РегЭнд = ${re}</i>\n\n` + calculateGradeReport(rm, re, null, isGauharUser);
}

// ==========================================
// ПОШАГОВЫЙ ИНСТРУКЦИОННЫЙ ГИД ("КАК ДЛЯ ДЕБИЛОВ")
// ==========================================

function getFoolproofHelpText(isGauharUser = false) {
    const gauharHeader = isGauharUser
        ? `📖 <b>Специальная версия инструкции для Гаухар:</b>\n<i>Читать медленно, сохранить в закладки, перед сном перечитывать три раза, чтобы не забыть! 😉</i>\n\n━━━━━━━━━━━━━━━━━━━━\n`
        : '';
    return gauharHeader + `📖 <b>ИНСТРУКЦИЯ ПО ИСПОЛЬЗОВАНИЮ БОТА:</b>\n\n` +
        `Бот заменяет весь сайт <b>GradeMaster</b> прямо в Telegram. Все калькуляторы работают по кнопкам внизу или через команды.\n\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `🚀 <b>1. Калькулятор итоговой оценки</b>\n` +
        `Помогает узнать, сдадите ли вы предмет и сколько нужно на экзамене для стипендии.\n` +
        `👉 <i>Как пользоваться:</i>\n` +
        `• Нажмите кнопку <b>«🚀 Итоговая оценка»</b> и отвечайте на вопросы бота.\n` +
        `• Или отправьте: <code>/calc 80 85</code> (РегМид РегЭнд для прогноза).\n` +
        `• Или отправьте: <code>/calc 80 85 90</code> (РегМид РегЭнд Файнал для точного итога).\n\n` +
        `📊 <b>2. Калькулятор GPA за триместр</b>\n` +
        `Считает общий балл GPA с учётом веса кредитов каждого предмета.\n` +
        `👉 <i>Как пользоваться:</i>\n` +
        `• Нажмите <b>«📊 Калькулятор GPA»</b>.\n` +
        `• Отправьте оценки и кредиты: <code>/gpa 90 3, 85 4, 95 2</code>\n` +
        `  <i>(90% с 3 кредитами, 85% с 4 кредитами и т.д.)</i>\n\n` +
        `📈 <b>3. Кумулятивный GPA (CGPA)</b>\n` +
        `Считает общий балл за несколько триместров/семестров.\n` +
        `👉 <i>Как пользоваться:</i>\n` +
        `• Нажмите <b>«📈 Кумулятивный GPA»</b>.\n` +
        `• Отправьте: <code>/cgpa 3.5 15, 3.8 20</code> (GPA_1 Кредиты_1, GPA_2 Кредиты_2).\n\n` +
        `📋 <b>4. Калькулятор посещаемости</b>\n` +
        `Показывает, сколько пар можно прогулять за 10 недель без риска отчисления.\n` +
        `💡 <i>1 занятие = 50 мин (академ. час). Сдвоенная пара на 100 мин = 2 занятия.</i>\n` +
        `👉 <i>Как пользоваться:</i>\n` +
        `• Нажмите <b>«📋 Посещаемость»</b>.\n` +
        `• Отправьте: <code>/att 3</code> (3 занятия в неделю) или <code>/att 3 2</code> (если 2 уже пропустили).\n\n` +
        `🔄 <b>5. Конвертер баллов в GPA</b>\n` +
        `Мгновенно переводит проценты (например 87) в букву B+ и балл 3.33.\n` +
        `👉 Отправьте: <code>/convert 87</code>\n\n` +
        `💬 <b>6. Поддержка и отзывы</b>\n` +
        `Нажмите <b>«💬 Отзыв / Поддержка»</b> и напишите любое сообщение — администратор получит его и ответит вам!\n\n` +
        `🍪 <b>7. Напоминания о квизах и дедлайнах (Learn & LMS)</b>\n` +
        `Бот может будить вас каждое утро в 08:00 и присылать сигнал тревоги за 1 час до сдачи работ.\n` +
        `👉 Отправьте команду <code>/cookie</code> для пошаговой инструкции подключения!`;
}

function getCookieGuideText(isGauharUser = false) {
    const gauharHeader = isGauharUser
        ? `🍪 <b>Пошаговый гайд по кукам специально для Гаухар:</b> 🧠✨\n` +
          `<i>(Гаухар, сохрани этот пост в «Избранное», чтобы не спрашивать разработчика через 5 минут!)</i> 😉\n\n`
        : `🍪 <b>КАК ПОДКЛЮЧИТЬ КУКИ И НАПОМИНАНИЯ (С ТЕЛЕФОНА И ПК):</b>\n\n`;

    return gauharHeader +
        `Бот GradeMaster собирает дедлайны из двух платформ AITU:\n` +
        `1️⃣ <b>Moodle LMS</b> (все лабы, домашки, проекты — 90% всех заданий!)\n` +
        `2️⃣ <b>AITU Learn</b> (еженедельные онлайн-квизы и тесты курсов)\n\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `📱 <b>ИНСТРУКЦИЯ С ТЕЛЕФОНА (БЕЗ ПК И БЕЗ F12):</b>\n\n` +
        `🟢 <b>1. Moodle LMS (лабы и задания — делается за 15 секунд):</b>\n` +
        `<i>(Работает на iPhone и Android в обычном браузере Safari/Chrome/Яндекс)</i>\n` +
        `1. Перейдите по прямой ссылке: <a href="https://lms.astanait.edu.kz/calendar/export.php">Экспорт календаря Moodle</a> (войдите, если потребуется).\n` +
        `2. В параметрах выберите:\n` +
        `   • Какие события: <b>«Все события»</b>\n` +
        `   • За какой период: <b>«Недавние и предстоящие»</b>\n` +
        `3. Нажмите синюю кнопку <b>«Получить URL календаря» (Get calendar URL)</b>.\n` +
        `4. Зажмите пальцем появившуюся ссылку и выберите <b>«Скопировать»</b> (она выглядит как <code>https://lms.astanait.edu.kz/calendar/export_execute.php?...</code>).\n` +
        `5. Отправьте эту ссылку боту:\n` +
        `👉 <code>/set_lms ВАША_ССЫЛКА_ИЗ_LMS</code>\n` +
        `<i>✨ Готово! Токен календаря постоянный — сессия никогда не истекает!</i>\n\n` +
        `🔵 <b>2. AITU Learn (квизы курсов):</b>\n` +
        `<i>(Для квизов нужен параметр <code>sessionid</code>)</i>\n` +
        `• <b>На Android:</b> установите бесплатный браузер с поддержкой расширений (например, <b>Kiwi Browser</b> или <b>Яндекс Браузер</b>) → установите расширение <b>Cookie-Editor</b> из Chrome Web Store → войдите на <a href="https://learn.astanait.edu.kz/">learn.astanait.edu.kz</a> → откройте расширение в меню (три точки) → найдите строку <code>sessionid</code> и скопируйте.\n` +
        `• <b>На iPhone (iOS):</b> проще всего 1 раз открыть сайт с любого ПК/ноутбука или использовать бесплатное приложение <b>Inspect Browser</b> / <b>Web Inspector</b> из App Store.\n` +
        `• Отправьте скопированный ключ боту:\n` +
        `👉 <code>/set_cookie ВАШ_SESSIONID</code>\n\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `💻 <b>ИНСТРУКЦИЯ С КОМПЬЮТЕРА (ЧЕРЕЗ F12):</b>\n` +
        `1. <b>AITU Learn:</b> войдите на <a href="https://learn.astanait.edu.kz/">learn.astanait.edu.kz</a> → нажмите <b>F12</b> → вкладка <b>Application</b> (в Firefox: <b>«Память» / «Storage»</b>) → слева <b>Cookies</b> → <code>https://learn.astanait.edu.kz</code> → скопируйте значение строки <code>sessionid</code> → отправьте: <code>/set_cookie ВАШ_SESSIONID</code>\n` +
        `2. <b>Moodle LMS:</b> войдите на <a href="https://lms.astanait.edu.kz/">lms.astanait.edu.kz</a> → <b>F12</b> → <b>Application</b> → <b>Cookies</b> → скопируйте <code>MoodleSession</code> → отправьте: <code>/set_lms ВАШ_MOODLESESSION</code> (или используйте экспорт календаря выше).\n\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `🔔 <b>Что вы получите:</b>\n` +
        `• Экстренный сигнал тревоги с кнопкой сдачи <b>за 1 час до дедлайна</b> ⏰\n` +
        `• Утреннюю сводку в 08:00 по всем горящим заданиям на 3 дня ☀️\n` +
        `• Кнопки быстрого просмотра в главном меню бота 📱\n\n` +
        `🔒 <i>Ваши данные изолированы и хранятся в защищённом виде. Отключить напоминания можно в любой момент командами <code>/logout</code> (для Learn) и <code>/del_lms</code> (для LMS).</i>`;
}

// ==========================================
// АДМИН-ПАНЕЛЬ (ТОЛЬКО ДЛЯ ADMIN_CHAT_ID)
// ==========================================

async function handleAdminPanel(chatId, messageId = null) {
    if (!isAdmin(chatId)) {
        return sendMessage(chatId, '❌ <b>Доступ запрещён.</b> Эта команда доступна только создателю бота.');
    }

    const hasBotToken = Boolean(getBotToken());
    const primaryAdmin = getPrimaryAdminId();
    const hasAdminId = Boolean(primaryAdmin);
    const hasSecret = Boolean(process.env.TELEGRAM_SECRET_TOKEN);
    const storedSession = await aitu.getStoredSession(chatId);
    const hasAitu = Boolean(storedSession);
    const sessionPreview = hasAitu
        ? (storedSession.length > 20 ? `${storedSession.substring(0, 8)}...${storedSession.slice(-6)}` : 'Активна')
        : 'Не настроена';

    let quizUsersCount = 0;
    try {
        const qUsers = await aitu.getAllQuizUsers();
        quizUsersCount = qUsers.length;
    } catch {}

    let lmsUsersCount = 0;
    try {
        const lUsers = await lms.getAllLmsUsers();
        lmsUsersCount = lUsers.length;
    } catch {}

    const storedLms = await lms.getUserLmsSession(chatId);
    const hasLms = Boolean(storedLms);
    const lmsPreview = hasLms
        ? (storedLms.length > 25 ? `${storedLms.substring(0, 10)}...${storedLms.slice(-6)}` : 'Активна')
        : 'Не настроена';

    const maxLimit = lms.MAX_SUBSCRIBERS_LIMIT;

    const adminMsg = `⚙️ <b>ПАНЕЛЬ АДМИНИСТРАТОРА GRADEMASTER:</b>\n\n` +
        `👤 <b>Ваш Admin Chat ID:</b> <code>${chatId}</code>\n` +
        `🌐 <b>Web App URL:</b> ${WEBAPP_URL}\n` +
        `👥 <b>Активных пользователей в памяти:</b> ${activeUsers.size}\n` +
        `📝 <b>Квизы Learn (AITU):</b> <b>${quizUsersCount} / ${maxLimit}</b> чел.\n` +
        `📚 <b>Дедлайны LMS (Moodle):</b> <b>${lmsUsersCount} / ${maxLimit}</b> чел.\n\n` +
        `🔑 <b>Статус переменных окружения и сервисов:</b>\n` +
        `• <code>TELEGRAM_BOT_TOKEN</code>: ${hasBotToken ? '✅ Настроен' : '❌ Не задан'}\n` +
        `• <code>TELEGRAM_CHAT_ID</code>: ${hasAdminId ? '✅ Настроен' : '❌ Не задан'}\n` +
        `• <code>AITU_SESSION (Learn)</code>: ${hasAitu ? `✅ Сохранена (${sessionPreview})` : '⚠️ Не сохранена'}\n` +
        `• <code>LMS_SESSION (Moodle)</code>: ${hasLms ? `✅ Сохранена (${lmsPreview})` : '⚠️ Не сохранена'}\n` +
        `• <code>TELEGRAM_SECRET_TOKEN</code>: ${hasSecret ? '✅ Включен' : '⚪ Не включен (опционально)'}\n\n` +
        `🛠 <b>Команды управления:</b>\n` +
        `• <code>/stats</code> — анонимная статистика использования\n` +
        `• <code>/quizzes</code> — проверить квизы Learn\n` +
        `• <code>/lms</code> — проверить дедлайны Moodle LMS\n` +
        `• <code>/set_cookie &lt;sid&gt;</code> — обновить cookie Learn\n` +
        `• <code>/set_lms &lt;sid&gt;</code> — подключить Moodle LMS\n` +
        `• <code>/test_1h</code> — экстренное напоминание (за 1 час)\n` +
        `• <code>/test_reminder</code> — тест утреннего напоминания\n` +
        `• <code>/reply &lt;chat_id&gt; &lt;текст&gt;</code> — ответить студенту\n` +
        `• <code>/broadcast &lt;текст&gt;</code> — разослать объявление всем\n` +
        `• <code>/status</code> — проверить соединение с Telegram API`;

    const inlineKeyboard = {
        inline_keyboard: [
            [
                { text: '📊 Статистика', callback_data: 'adm_stats' },
                { text: '📝 Квизы Learn', callback_data: 'adm_quizzes' },
                { text: '📚 Дедлайны LMS', callback_data: 'adm_lms' }
            ],
            [
                { text: '🚨 Тест 1ч дедлайна', callback_data: 'adm_test_1h' },
                { text: '🔔 Тест напоминания', callback_data: 'adm_cron' }
            ],
            [
                { text: '📡 Webhook Info', callback_data: 'adm_webhookinfo' },
                { text: '🔄 Обновить Webhook', callback_data: 'adm_setwebhook' }
            ],
            [
                { text: '🏠 Главное меню', callback_data: 'adm_home' }
            ]
        ]
    };

    if (messageId) {
        return editMessageText(chatId, messageId, adminMsg, { reply_markup: inlineKeyboard });
    }
    return sendMessage(chatId, adminMsg, { reply_markup: inlineKeyboard });
}

function getLmsSessionKeyboard(result, mode = 'week') {
    const inline_keyboard = [];
    if (mode === 'week' || mode === 'active') {
        const activeItems = (result && result.academicEvents) ? result.academicEvents : (result?.quizzes || []);
        inline_keyboard.push([
            { text: '🗓 Весь семестр', callback_data: 'lms_view_all' },
            { text: '🔍 По предметам', callback_data: 'lms_courses_menu' }
        ]);
        if (activeItems.length > 0) {
            inline_keyboard.push([
                { text: '✅ Отметить сданное', callback_data: 'lms_mark_menu' }
            ]);
        }
        if (result && result.completedCount > 0) {
            inline_keyboard.push([
                { text: `📦 Показать сданные (${result.completedCount})`, callback_data: 'lms_show_completed' }
            ]);
        }
        inline_keyboard.push([
            { text: '🔄 Обновить дедлайны', callback_data: 'user_lms_refresh' },
            { text: '🚪 Отключить LMS', callback_data: 'user_lms_logout' }
        ]);
    } else if (mode === 'all') {
        const activeItems = (result && result.academicEvents) ? result.academicEvents : (result?.quizzes || []);
        inline_keyboard.push([
            { text: '◀️ Только эта неделя', callback_data: 'lms_view_week' },
            { text: '🔍 По предметам', callback_data: 'lms_courses_menu' }
        ]);
        if (activeItems.length > 0) {
            inline_keyboard.push([
                { text: '✅ Отметить сданное', callback_data: 'lms_mark_menu' }
            ]);
        }
        if (result && result.completedCount > 0) {
            inline_keyboard.push([
                { text: `📦 Показать сданные (${result.completedCount})`, callback_data: 'lms_show_completed' }
            ]);
        }
        inline_keyboard.push([
            { text: '🔄 Обновить дедлайны', callback_data: 'user_lms_refresh' },
            { text: '🚪 Отключить LMS', callback_data: 'user_lms_logout' }
        ]);
    } else if (mode === 'course') {
        inline_keyboard.push([
            { text: '◀️ Назад к неделе', callback_data: 'lms_view_week' },
            { text: '🗓 Весь семестр', callback_data: 'lms_view_all' }
        ]);
        inline_keyboard.push([
            { text: '🔍 Другой предмет', callback_data: 'lms_courses_menu' }
        ]);
    } else if (mode === 'completed') {
        inline_keyboard.push([
            { text: '◀️ Вернуться к активным', callback_data: 'user_lms_refresh' }
        ]);
        inline_keyboard.push([
            { text: '🚪 Отключить LMS', callback_data: 'user_lms_logout' }
        ]);
    }
    return { inline_keyboard };
}

function getLearnSessionKeyboard(result, mode = 'week') {
    const inline_keyboard = [];
    if (mode === 'week' || mode === 'active') {
        const activeItems = (result && result.activeQuizzes) ? result.activeQuizzes : (result?.quizzes || []).filter(q => !q.isPast && !q.isCompleted);
        inline_keyboard.push([
            { text: '🗓 Весь семестр', callback_data: 'learn_view_all' },
            { text: '🔍 По предметам', callback_data: 'learn_courses_menu' }
        ]);
        if (activeItems.length > 0) {
            inline_keyboard.push([
                { text: '✅ Отметить сданное', callback_data: 'learn_mark_menu' }
            ]);
        }
        if (result && result.completedCount > 0) {
            inline_keyboard.push([
                { text: `📦 Показать сданные (${result.completedCount})`, callback_data: 'learn_show_completed' }
            ]);
        }
        inline_keyboard.push([
            { text: '🔄 Обновить', callback_data: 'user_quizzes_refresh' },
            { text: '🚪 Отключить сессию', callback_data: 'user_logout' }
        ]);
    } else if (mode === 'all') {
        const activeItems = (result && result.activeQuizzes) ? result.activeQuizzes : (result?.quizzes || []).filter(q => !q.isPast && !q.isCompleted);
        inline_keyboard.push([
            { text: '◀️ Только эта неделя', callback_data: 'learn_view_week' },
            { text: '🔍 По предметам', callback_data: 'learn_courses_menu' }
        ]);
        if (activeItems.length > 0) {
            inline_keyboard.push([
                { text: '✅ Отметить сданное', callback_data: 'learn_mark_menu' }
            ]);
        }
        if (result && result.completedCount > 0) {
            inline_keyboard.push([
                { text: `📦 Показать сданные (${result.completedCount})`, callback_data: 'learn_show_completed' }
            ]);
        }
        inline_keyboard.push([
            { text: '🔄 Обновить', callback_data: 'user_quizzes_refresh' },
            { text: '🚪 Отключить сессию', callback_data: 'user_logout' }
        ]);
    } else if (mode === 'course') {
        inline_keyboard.push([
            { text: '◀️ Назад к неделе', callback_data: 'learn_view_week' },
            { text: '🗓 Весь семестр', callback_data: 'learn_view_all' }
        ]);
        inline_keyboard.push([
            { text: '🔍 Другой предмет', callback_data: 'learn_courses_menu' }
        ]);
    } else if (mode === 'completed') {
        inline_keyboard.push([
            { text: '◀️ Вернуться к активным', callback_data: 'user_quizzes_refresh' }
        ]);
        inline_keyboard.push([
            { text: '🚪 Отключить сессию', callback_data: 'user_logout' }
        ]);
    }
    return { inline_keyboard };
}

// ==========================================
// ОБРАБОТКА CALLBACK_QUERY (INLINE КНОПКИ)
// ==========================================

async function handleCallbackQuery(cq) {
    if (!cq || !cq.data) return;

    const chatId = cq.message?.chat?.id;
    const messageId = cq.message?.message_id;
    const data = cq.data;
    const session = getSession(chatId);

    await answerCallbackQuery(cq.id);

    // Админские колбэки
    if (data.startsWith('adm_')) {
        if (!isAdmin(chatId)) {
            return answerCallbackQuery(cq.id, 'Доступ запрещен', true);
        }

        if (data === 'adm_quizzes') {
            await sendMessage(chatId, '⏳ <i>Проверяю квизы и дедлайны на learn.astanait.edu.kz...</i>');
            const result = await aitu.getUpcomingQuizzes();
            const msgText = aitu.formatQuizzesMessage(result);
            return sendMessage(chatId, msgText, {
                reply_markup: getMainKeyboard(chatId),
                disable_web_page_preview: true
            });
        }

        if (data === 'adm_lms') {
            await sendMessage(chatId, '⏳ <i>Проверяю дедлайны на lms.astanait.edu.kz...</i>');
            const result = await lms.getUpcomingDeadlines();
            const msgText = lms.formatLmsDeadlinesMessage(result);
            return sendMessage(chatId, msgText, {
                reply_markup: getMainKeyboard(chatId),
                disable_web_page_preview: true
            });
        }

        if (data === 'adm_test_1h') {
            await sendMessage(chatId, '⏳ Генерирую тестовое оповещение за 1 час до дедлайна...');
            const result = await aitu.getUpcomingQuizzes();
            let targetQuiz = null;
            if (result.ok && result.quizzes && result.quizzes.length > 0) {
                targetQuiz = result.quizzes.find(q => !q.isPast) || result.quizzes[0];
            }
            if (!targetQuiz) {
                targetQuiz = {
                    courseName: 'Philosophy',
                    title: 'Quiz 2. Epistemological Paradigms',
                    link: 'https://learn.astanait.edu.kz/courses/course-v1:AITU+PHIL01+26-27_C1_Y3/course/',
                    dueDate: new Date(Date.now() + 48 * 60 * 1000).toISOString(),
                    diffMinutes: 48,
                    diffHours: 0.8,
                    diffDays: 0,
                    isCriticalHour: true
                };
            }
            const { text: alertText, replyMarkup } = aitu.formatCriticalHourAlert(targetQuiz);
            return sendMessage(chatId, alertText, {
                reply_markup: replyMarkup,
                disable_notification: false
            });
        }

        if (data === 'adm_cron') {
            await sendMessage(chatId, '⏳ Запускаю тестовую проверку напоминаний по квизам...');
            const result = await aitu.getUpcomingQuizzes();
            if (!result.ok) {
                return sendMessage(chatId, '❌ Ошибка: ' + result.error);
            }
            const urgent = result.quizzes.filter(q => !q.isPast && q.diffDays <= 3);
            if (urgent.length === 0) {
                return sendMessage(chatId, 'ℹ️ В ближайшие 3 дня срочных дедлайнов нет. Всего активных квизов в семестре: <b>' + result.quizzes.length + '</b>.');
            }
            let alertMsg = '🔔 <b>Тестовое напоминание о квизах AITU:</b>\n\n';
            for (const item of urgent) {
                const dateObj = new Date(item.dueDate);
                const astanaTime = new Intl.DateTimeFormat('ru-RU', {
                    timeZone: 'Asia/Almaty',
                    day: 'numeric',
                    month: 'short',
                    hour: '2-digit',
                    minute: '2-digit'
                }).format(dateObj);
                alertMsg += `📚 <b>${item.courseName}</b>\n📝 <a href="${item.link}">${item.title}</a>\n⏰ Дедлайн: <b>${astanaTime}</b> (осталось ${item.diffDays} дн.)\n\n`;
            }
            return sendMessage(chatId, alertMsg, { disable_web_page_preview: true });
        }

        if (data === 'adm_setwebhook') {
            try {
                const webhookUrl = `${WEBAPP_URL}/api/bot`;
                const payload = { url: webhookUrl };
                if (process.env.TELEGRAM_SECRET_TOKEN) {
                    payload.secret_token = process.env.TELEGRAM_SECRET_TOKEN;
                }
                const res = await apiCall('setWebhook', payload);
                await answerCallbackQuery(cq.id, '✅ Webhook успешно привязан!', true);
                return sendMessage(chatId, `✅ <b>Webhook успешно обновлен!</b>\nURL: <code>${webhookUrl}</code>\nОтвет Telegram: <code>${JSON.stringify(res)}</code>`);
            } catch (err) {
                return sendMessage(chatId, `❌ <b>Ошибка привязки Webhook:</b> ${esc(err.message)}`);
            }
        }

        if (data === 'adm_webhookinfo') {
            try {
                const info = await apiCall('getWebhookInfo');
                return sendMessage(chatId, `📡 <b>Информация о Webhook Telegram:</b>\n\n<code>${esc(JSON.stringify(info, null, 2))}</code>`);
            } catch (err) {
                return sendMessage(chatId, `❌ <b>Ошибка:</b> ${esc(err.message)}`);
            }
        }

        if (data === 'adm_stats') {
            const statsMsg = await statsEngine.formatStatsTelegram();
            return sendMessage(chatId, statsMsg, {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '◀️ Назад в Панель управления', callback_data: 'adm_panel' }]
                    ]
                }
            });
        }

        if (data === 'adm_panel') {
            return handleAdminPanel(chatId, messageId);
        }

        if (data === 'adm_home') {
            return sendMessage(chatId, '🏠 Вы в главном меню.', { reply_markup: getMainKeyboard(chatId) });
        }
    }

    // Пользовательские колбэки мастеров
    if (data === 'wiz_total') {
        session.step = 'total_regmid';
        session.data = {};
        return sendMessage(chatId, `🚀 <b>Калькулятор итоговой оценки (Шаг 1 из 2):</b>\n\nВведи твой балл за <b>РегМид</b> (число от 0 до 100).\n<i>Например:</i> <code>85</code>`, { reply_markup: getCancelKeyboard() });
    }

    if (data === 'wiz_gpa') {
        session.step = 'gpa_input';
        session.data = {};
        return sendMessage(chatId, `📊 <b>Калькулятор GPA за триместр:</b>\n\nОтправь оценки и кредиты предметов через запятую.\n<b>Формат:</b> <code>Оценка Кредиты</code>\n\n<i>Пример:</i> <code>90 3, 85 4, 95 2</code>`, { reply_markup: getCancelKeyboard() });
    }

    if (data === 'wiz_cgpa' || data === 'wiz_cum') {
        session.step = 'cgpa_input';
        session.data = {};
        return sendMessage(chatId, `📈 <b>Кумулятивный GPA (CGPA):</b>\n\nОтправь GPA и количество кредитов за каждый триместр через запятую.\n<b>Формат:</b> <code>GPA Кредиты</code>\n\n<i>Пример:</i> <code>3.5 15, 3.8 20, 3.2 18</code>`, { reply_markup: getCancelKeyboard() });
    }

    if (data === 'wiz_att') {
        session.step = 'att_lessons';
        session.data = {};
        return sendMessage(chatId, `📋 <b>Калькулятор посещаемости (Шаг 1 из 2):</b>\n\nСколько занятий (академ. часов по 50 минут) в неделю по предмету?\n\n💡 <i><b>Справка:</b> 1 занятие = 50 минут. Если пара сдвоенная (100 минут) — считайте её как <b>2 занятия</b> в журнале!</i>\n<i>Введи число от 1 до 20 (например: <code>3</code> или <code>4</code>)</i>`, { reply_markup: getCancelKeyboard() });
    }

    if (data === 'wiz_conv') {
        session.step = 'conv_input';
        session.data = {};
        return sendMessage(chatId, `🔄 <b>Конвертер оценок в GPA:</b>\n\nВведи процентную оценку (число от 0 до 100).\n<i>Например:</i> <code>87</code>`, { reply_markup: getCancelKeyboard() });
    }

    if (data === 'wiz_feed') {
        session.step = 'feed_input';
        session.data = {};
        const isGauharUser = typeof aitu.isGauhar === 'function' && aitu.isGauhar(chatId);
        const feedText = isGauharUser
            ? `💬 <b>Служба поддержки и отзывов:</b>\n\nГаухар, ты точно хотела написать разработчику или случайно забыла, куда нажимала? 😉 Пиши свой вопрос или идею — создатель бота всё равно прочитает первым! 🫡`
            : `💬 <b>Служба поддержки и отзывов:</b>\n\nНапишите ваше предложение, вопрос или сообщение об ошибке. Администратор получит его и ответит вам!`;
        return sendMessage(chatId, feedText, { reply_markup: getCancelKeyboard() });
    }

    if (data === 'wiz_cookie_guide' || data === 'show_cookie_guide') {
        const isGauharUser = typeof aitu.isGauhar === 'function' && aitu.isGauhar(chatId);
        const guide = getCookieGuideText(isGauharUser);
        return sendMessage(chatId, guide, {
            reply_markup: getMainKeyboard(chatId),
            disable_web_page_preview: true
        });
    }

    if (data === 'user_quizzes_refresh') {
        const isGauharUser = typeof aitu.isGauhar === 'function' && aitu.isGauhar(chatId);
        const refreshText = isGauharUser
            ? '⏳ <i>Обновляю квизы для Гаухар... Спойлер: проверь дедлайны ещё раз! 🔍</i>'
            : '⏳ <i>Обновляю список квизов...</i>';
        await sendMessage(chatId, refreshText);
        const userSid = await aitu.getUserSession(chatId);
        if (!userSid) {
            return sendMessage(chatId, '⚠️ Сессия не найдена. Отправьте команду /set_cookie ВАШ_SESSION_ID.');
        }
        const result = await aitu.getUpcomingQuizzesForUser(chatId, true);
        const msgText = aitu.formatQuizzesMessage(result, isGauharUser, false, 'week');
        return sendMessage(chatId, msgText, {
            reply_markup: getLearnSessionKeyboard(result, 'week'),
            disable_web_page_preview: true
        });
    }

    if (data === 'user_logout') {
        await aitu.deleteUserSession(chatId);
        const isGauharUser = typeof aitu.isGauhar === 'function' && aitu.isGauhar(chatId);
        const logoutNote = isGauharUser
            ? '🚪 <b>Гаухар, твоя сессия отключена.</b>\nАвтоматические напоминания остановлены. Теперь вся надежда только на твою память! 😅'
            : '🚪 <b>Ваша сессия отключена.</b>\nАвтоматические напоминания остановлены.';
        return sendMessage(chatId, logoutNote, {
            reply_markup: getMainKeyboard(chatId)
        });
    }

    if (data === 'user_lms_refresh') {
        const isGauharUser = typeof aitu.isGauhar === 'function' && aitu.isGauhar(chatId);
        const refreshText = isGauharUser
            ? '⏳ <i>Обновляю дедлайны LMS для Гаухар... Спойлер: лабы сами себя не сдадут! 🔍</i>'
            : '⏳ <i>Обновляю список дедлайнов LMS...</i>';
        await sendMessage(chatId, refreshText);
        const userLms = await lms.getUserLmsSession(chatId);
        if (!userLms) {
            return sendMessage(chatId, '⚠️ Сессия LMS не найдена. Отправьте команду /set_lms ВАШ_MOODLESESSION.');
        }
        const result = await lms.getUpcomingDeadlinesForUser(chatId, true);
        const msgText = lms.formatLmsDeadlinesMessage(result, isGauharUser, false, 'week');
        return sendMessage(chatId, msgText, {
            reply_markup: getLmsSessionKeyboard(result, 'week'),
            disable_web_page_preview: true
        });
    }

    if (data === 'user_lms_logout') {
        await lms.deleteUserLmsSession(chatId);
        const isGauharUser = typeof aitu.isGauhar === 'function' && aitu.isGauhar(chatId);
        const logoutNote = isGauharUser
            ? '🚪 <b>Гаухар, напоминания LMS отключены.</b>\nАвтоматические сигналы по заданиям остановлены. Не забудь сдать лабы! 😅'
            : '🚪 <b>Сессия Moodle LMS отключена.</b>\nАвтоматические напоминания о дедлайнах заданий остановлены.';
        return sendMessage(chatId, logoutNote, {
            reply_markup: getMainKeyboard(chatId)
        });
    }

    // Режим всего семестра для LMS
    if (data === 'lms_view_all') {
        const result = await lms.getUpcomingDeadlinesForUser(chatId);
        const isGauharUser = typeof aitu.isGauhar === 'function' && aitu.isGauhar(chatId);
        const msgText = lms.formatLmsDeadlinesMessage(result, isGauharUser, false, 'all');
        const sessionKeyboard = getLmsSessionKeyboard(result, 'all');
        if (messageId) {
            return editMessageText(chatId, messageId, msgText, { reply_markup: sessionKeyboard, disable_web_page_preview: true });
        }
        return sendMessage(chatId, msgText, { reply_markup: sessionKeyboard, disable_web_page_preview: true });
    }

    // Режим текущей недели для LMS
    if (data === 'lms_view_week') {
        const result = await lms.getUpcomingDeadlinesForUser(chatId);
        const isGauharUser = typeof aitu.isGauhar === 'function' && aitu.isGauhar(chatId);
        const msgText = lms.formatLmsDeadlinesMessage(result, isGauharUser, false, 'week');
        const sessionKeyboard = getLmsSessionKeyboard(result, 'week');
        if (messageId) {
            return editMessageText(chatId, messageId, msgText, { reply_markup: sessionKeyboard, disable_web_page_preview: true });
        }
        return sendMessage(chatId, msgText, { reply_markup: sessionKeyboard, disable_web_page_preview: true });
    }

    // Меню фильтрации по курсам для LMS
    if (data === 'lms_courses_menu') {
        const result = await lms.getUpcomingDeadlinesForUser(chatId);
        const allEvts = (result && (result.allEvents || result.academicEvents)) ? (result.allEvents || result.academicEvents) : [];
        const courses = [...new Set(allEvts.map(e => e.courseName).filter(Boolean))];
        if (courses.length === 0) {
            await answerCallbackQuery(cq.id, 'Курсы с дедлайнами не найдены', true);
            return;
        }
        userCourseListMemory.set(String(chatId) + '_lms', courses);
        const buttons = [];
        for (let i = 0; i < courses.length; i++) {
            const cName = courses[i];
            const shortName = cName.length > 28 ? cName.slice(0, 25) + '...' : cName;
            buttons.push([{ text: `📚 ${shortName}`, callback_data: `lms_c_${i}` }]);
        }
        buttons.push([{ text: '◀️ Назад к дедлайнам', callback_data: 'lms_view_week' }]);
        const promptMsg = `🔍 <b>Выберите предмет для фильтрации дедлайнов LMS:</b>`;
        if (messageId) {
            return editMessageText(chatId, messageId, promptMsg, { reply_markup: { inline_keyboard: buttons } });
        }
        return sendMessage(chatId, promptMsg, { reply_markup: { inline_keyboard: buttons } });
    }

    // Фильтр по конкретному курсу для LMS
    if (data.startsWith('lms_c_')) {
        const idx = parseInt(data.replace('lms_c_', ''), 10);
        const courses = userCourseListMemory.get(String(chatId) + '_lms') || [];
        const targetCourse = courses[idx] || null;
        const result = await lms.getUpcomingDeadlinesForUser(chatId);
        const isGauharUser = typeof aitu.isGauhar === 'function' && aitu.isGauhar(chatId);
        const msgText = lms.formatLmsDeadlinesMessage(result, isGauharUser, false, 'course', targetCourse);
        const sessionKeyboard = getLmsSessionKeyboard(result, 'course');
        if (messageId) {
            return editMessageText(chatId, messageId, msgText, { reply_markup: sessionKeyboard, disable_web_page_preview: true });
        }
        return sendMessage(chatId, msgText, { reply_markup: sessionKeyboard, disable_web_page_preview: true });
    }

    // Режим всего семестра для Learn
    if (data === 'learn_view_all') {
        const result = await aitu.getUpcomingQuizzesForUser(chatId);
        const isGauharUser = typeof aitu.isGauhar === 'function' && aitu.isGauhar(chatId);
        const msgText = aitu.formatQuizzesMessage(result, isGauharUser, false, 'all');
        const sessionKeyboard = getLearnSessionKeyboard(result, 'all');
        if (messageId) {
            return editMessageText(chatId, messageId, msgText, { reply_markup: sessionKeyboard, disable_web_page_preview: true });
        }
        return sendMessage(chatId, msgText, { reply_markup: sessionKeyboard, disable_web_page_preview: true });
    }

    // Режим текущей недели для Learn
    if (data === 'learn_view_week') {
        const result = await aitu.getUpcomingQuizzesForUser(chatId);
        const isGauharUser = typeof aitu.isGauhar === 'function' && aitu.isGauhar(chatId);
        const msgText = aitu.formatQuizzesMessage(result, isGauharUser, false, 'week');
        const sessionKeyboard = getLearnSessionKeyboard(result, 'week');
        if (messageId) {
            return editMessageText(chatId, messageId, msgText, { reply_markup: sessionKeyboard, disable_web_page_preview: true });
        }
        return sendMessage(chatId, msgText, { reply_markup: sessionKeyboard, disable_web_page_preview: true });
    }

    // Меню фильтрации по курсам для Learn
    if (data === 'learn_courses_menu') {
        const result = await aitu.getUpcomingQuizzesForUser(chatId);
        const allQ = (result && result.quizzes) ? result.quizzes : [];
        const courses = [...new Set(allQ.map(q => q.courseName).filter(Boolean))];
        if (courses.length === 0) {
            await answerCallbackQuery(cq.id, 'Курсы с квизами не найдены', true);
            return;
        }
        userCourseListMemory.set(String(chatId) + '_learn', courses);
        const buttons = [];
        for (let i = 0; i < courses.length; i++) {
            const cName = courses[i];
            const shortName = cName.length > 28 ? cName.slice(0, 25) + '...' : cName;
            buttons.push([{ text: `📝 ${shortName}`, callback_data: `learn_c_${i}` }]);
        }
        buttons.push([{ text: '◀️ Назад к квизам', callback_data: 'learn_view_week' }]);
        const promptMsg = `🔍 <b>Выберите предмет для фильтрации квизов Learn:</b>`;
        if (messageId) {
            return editMessageText(chatId, messageId, promptMsg, { reply_markup: { inline_keyboard: buttons } });
        }
        return sendMessage(chatId, promptMsg, { reply_markup: { inline_keyboard: buttons } });
    }

    // Фильтр по конкретному курсу для Learn
    if (data.startsWith('learn_c_')) {
        const idx = parseInt(data.replace('learn_c_', ''), 10);
        const courses = userCourseListMemory.get(String(chatId) + '_learn') || [];
        const targetCourse = courses[idx] || null;
        const result = await aitu.getUpcomingQuizzesForUser(chatId);
        const isGauharUser = typeof aitu.isGauhar === 'function' && aitu.isGauhar(chatId);
        const msgText = aitu.formatQuizzesMessage(result, isGauharUser, false, 'course', targetCourse);
        const sessionKeyboard = getLearnSessionKeyboard(result, 'course');
        if (messageId) {
            return editMessageText(chatId, messageId, msgText, { reply_markup: sessionKeyboard, disable_web_page_preview: true });
        }
        return sendMessage(chatId, msgText, { reply_markup: sessionKeyboard, disable_web_page_preview: true });
    }

    // Меню отметки сданных заданий LMS
    if (data === 'lms_mark_menu') {
        const result = await lms.getUpcomingDeadlinesForUser(chatId);
        const active = (result && result.academicEvents) ? result.academicEvents : [];
        if (active.length === 0) {
            await answerCallbackQuery(cq.id, 'У вас нет активных заданий в LMS!', true);
            return;
        }
        const buttons = [];
        for (const ev of active.slice(0, 15)) {
            const shortTitle = ev.title.length > 25 ? ev.title.slice(0, 22) + '...' : ev.title;
            const shortCourse = ev.courseName.length > 15 ? ev.courseName.slice(0, 12) + '...' : ev.courseName;
            buttons.push([{
                text: `✅ ${shortCourse}: ${shortTitle}`,
                callback_data: `mark_lms_${String(ev.id).slice(0, 45)}`
            }]);
        }
        buttons.push([{ text: '◀️ Назад к дедлайнам', callback_data: 'user_lms_refresh' }]);
        const markPrompt = `<b>Выберите сданное задание Moodle LMS:</b>\n\n` +
            `Нажмите на задание, которое вы уже сдали. Бот исключит его из списка дедлайнов и отключит утренние и экстренные напоминания 🔕\n\n` +
            `<i>(Вы всегда сможете вернуть его обратно в разделе «📦 Показать сданные»)</i>`;
        if (messageId) {
            return editMessageText(chatId, messageId, markPrompt, { reply_markup: { inline_keyboard: buttons } });
        }
        return sendMessage(chatId, markPrompt, { reply_markup: { inline_keyboard: buttons } });
    }

    // Отметка задания LMS как сданного
    if (data.startsWith('mark_lms_')) {
        const eventId = data.replace('mark_lms_', '').trim();
        await lms.markLmsEventCompleted(chatId, eventId);
        await answerCallbackQuery(cq.id, '✅ Задание отмечено как сданное!', false);
        const refreshed = await lms.getUpcomingDeadlinesForUser(chatId);
        const isGauharUser = typeof aitu.isGauhar === 'function' && aitu.isGauhar(chatId);
        const msgText = lms.formatLmsDeadlinesMessage(refreshed, isGauharUser);
        const sessionKeyboard = getLmsSessionKeyboard(refreshed, 'active');
        if (messageId) {
            return editMessageText(chatId, messageId, msgText, { reply_markup: sessionKeyboard });
        }
        return sendMessage(chatId, msgText, { reply_markup: sessionKeyboard });
    }

    // Просмотр сданных заданий LMS
    if (data === 'lms_show_completed') {
        const result = await lms.getUpcomingDeadlinesForUser(chatId);
        const isGauharUser = typeof aitu.isGauhar === 'function' && aitu.isGauhar(chatId);
        const msgText = lms.formatLmsDeadlinesMessage(result, isGauharUser, true);
        const buttons = [];
        const completed = (result && result.completedAcademicEvents) ? result.completedAcademicEvents : [];
        for (const ev of completed.slice(0, 15)) {
            const shortTitle = ev.title.length > 25 ? ev.title.slice(0, 22) + '...' : ev.title;
            buttons.push([{
                text: `↩️ Вернуть: ${shortTitle}`,
                callback_data: `unmark_lms_${String(ev.id).slice(0, 45)}`
            }]);
        }
        buttons.push([{ text: '◀️ Назад к активным дедлайнам', callback_data: 'user_lms_refresh' }]);
        if (messageId) {
            return editMessageText(chatId, messageId, msgText, { reply_markup: { inline_keyboard: buttons } });
        }
        return sendMessage(chatId, msgText, { reply_markup: { inline_keyboard: buttons } });
    }

    // Возврат задания LMS в активные
    if (data.startsWith('unmark_lms_')) {
        const eventId = data.replace('unmark_lms_', '').trim();
        await lms.unmarkLmsEventCompleted(chatId, eventId);
        await answerCallbackQuery(cq.id, '↩️ Задание возвращено в активные дедлайны!', false);
        const refreshed = await lms.getUpcomingDeadlinesForUser(chatId);
        const isGauharUser = typeof aitu.isGauhar === 'function' && aitu.isGauhar(chatId);
        if (refreshed.completedCount > 0) {
            const msgText = lms.formatLmsDeadlinesMessage(refreshed, isGauharUser, true);
            const buttons = [];
            for (const ev of refreshed.completedAcademicEvents.slice(0, 15)) {
                const shortTitle = ev.title.length > 25 ? ev.title.slice(0, 22) + '...' : ev.title;
                buttons.push([{
                    text: `↩️ Вернуть: ${shortTitle}`,
                    callback_data: `unmark_lms_${String(ev.id).slice(0, 45)}`
                }]);
            }
            buttons.push([{ text: '◀️ Назад к активным дедлайнам', callback_data: 'user_lms_refresh' }]);
            if (messageId) {
                return editMessageText(chatId, messageId, msgText, { reply_markup: { inline_keyboard: buttons } });
            }
            return sendMessage(chatId, msgText, { reply_markup: { inline_keyboard: buttons } });
        } else {
            const msgText = lms.formatLmsDeadlinesMessage(refreshed, isGauharUser);
            const sessionKeyboard = getLmsSessionKeyboard(refreshed, 'active');
            if (messageId) {
                return editMessageText(chatId, messageId, msgText, { reply_markup: sessionKeyboard });
            }
            return sendMessage(chatId, msgText, { reply_markup: sessionKeyboard });
        }
    }

    // Меню отметки сданных квизов Learn
    if (data === 'learn_mark_menu') {
        const result = await aitu.getUpcomingQuizzesForUser(chatId);
        const active = (result && result.activeQuizzes) ? result.activeQuizzes : [];
        if (active.length === 0) {
            await answerCallbackQuery(cq.id, 'У вас нет активных несданных квизов!', true);
            return;
        }
        const buttons = [];
        for (const q of active.slice(0, 15)) {
            const shortTitle = q.title.length > 25 ? q.title.slice(0, 22) + '...' : q.title;
            const shortCourse = q.courseName.length > 15 ? q.courseName.slice(0, 12) + '...' : q.courseName;
            const qId = q.shortId || q.id || q.blockId;
            buttons.push([{
                text: `✅ ${shortCourse}: ${shortTitle}`,
                callback_data: `mark_lrn_${String(qId).slice(0, 45)}`
            }]);
        }
        buttons.push([{ text: '◀️ Назад к квизам', callback_data: 'user_quizzes_refresh' }]);
        const markPrompt = `<b>Выберите пройденный квиз AITU Learn:</b>\n\n` +
            `Нажмите на квиз, который вы уже сдали. Бот исключит его из списка и отключит звуковые напоминания и утреннюю сводку 🔕\n\n` +
            `<i>(Вы всегда сможете вернуть его обратно в разделе «📦 Показать сданные»)</i>`;
        if (messageId) {
            return editMessageText(chatId, messageId, markPrompt, { reply_markup: { inline_keyboard: buttons } });
        }
        return sendMessage(chatId, markPrompt, { reply_markup: { inline_keyboard: buttons } });
    }

    // Отметка квиза Learn как сданного
    if (data.startsWith('mark_lrn_')) {
        const quizId = data.replace('mark_lrn_', '').trim();
        await aitu.markQuizCompleted(chatId, quizId);
        await answerCallbackQuery(cq.id, '✅ Квиз отмечен как сданный!', false);
        const refreshed = await aitu.getUpcomingQuizzesForUser(chatId);
        const isGauharUser = typeof aitu.isGauhar === 'function' && aitu.isGauhar(chatId);
        const msgText = aitu.formatQuizzesMessage(refreshed, isGauharUser);
        const sessionKeyboard = getLearnSessionKeyboard(refreshed, 'active');
        if (messageId) {
            return editMessageText(chatId, messageId, msgText, { reply_markup: sessionKeyboard });
        }
        return sendMessage(chatId, msgText, { reply_markup: sessionKeyboard });
    }

    // Просмотр сданных квизов Learn
    if (data === 'learn_show_completed') {
        const result = await aitu.getUpcomingQuizzesForUser(chatId);
        const isGauharUser = typeof aitu.isGauhar === 'function' && aitu.isGauhar(chatId);
        const msgText = aitu.formatQuizzesMessage(result, isGauharUser, true);
        const buttons = [];
        const completed = (result && result.completedQuizzes) ? result.completedQuizzes : [];
        for (const q of completed.slice(0, 15)) {
            const shortTitle = q.title.length > 25 ? q.title.slice(0, 22) + '...' : q.title;
            const qId = q.shortId || q.id || q.blockId;
            buttons.push([{
                text: `↩️ Вернуть: ${shortTitle}`,
                callback_data: `unmark_lrn_${String(qId).slice(0, 45)}`
            }]);
        }
        buttons.push([{ text: '◀️ Назад к активным квизам', callback_data: 'user_quizzes_refresh' }]);
        if (messageId) {
            return editMessageText(chatId, messageId, msgText, { reply_markup: { inline_keyboard: buttons } });
        }
        return sendMessage(chatId, msgText, { reply_markup: { inline_keyboard: buttons } });
    }

    // Возврат квиза Learn в активные
    if (data.startsWith('unmark_lrn_')) {
        const quizId = data.replace('unmark_lrn_', '').trim();
        await aitu.unmarkQuizCompleted(chatId, quizId);
        await answerCallbackQuery(cq.id, '↩️ Квиз возвращен в активные!', false);
        const refreshed = await aitu.getUpcomingQuizzesForUser(chatId);
        const isGauharUser = typeof aitu.isGauhar === 'function' && aitu.isGauhar(chatId);
        if (refreshed.completedCount > 0) {
            const msgText = aitu.formatQuizzesMessage(refreshed, isGauharUser, true);
            const buttons = [];
            for (const q of refreshed.completedQuizzes.slice(0, 15)) {
                const shortTitle = q.title.length > 25 ? q.title.slice(0, 22) + '...' : q.title;
                const qId = q.shortId || q.id || q.blockId;
                buttons.push([{
                    text: `↩️ Вернуть: ${shortTitle}`,
                    callback_data: `unmark_lrn_${String(qId).slice(0, 45)}`
                }]);
            }
            buttons.push([{ text: '◀️ Назад к активным квизам', callback_data: 'user_quizzes_refresh' }]);
            if (messageId) {
                return editMessageText(chatId, messageId, msgText, { reply_markup: { inline_keyboard: buttons } });
            }
            return sendMessage(chatId, msgText, { reply_markup: { inline_keyboard: buttons } });
        } else {
            const msgText = aitu.formatQuizzesMessage(refreshed, isGauharUser);
            const sessionKeyboard = getLearnSessionKeyboard(refreshed, 'active');
            if (messageId) {
                return editMessageText(chatId, messageId, msgText, { reply_markup: sessionKeyboard });
            }
            return sendMessage(chatId, msgText, { reply_markup: sessionKeyboard });
        }
    }

    if (data.startsWith('add_final_')) {
        const parts = data.split('_');
        const rm = parts[2];
        const re = parts[3];
        session.step = 'total_final';
        session.data = { rm, re };
        return sendMessage(chatId, `📝 Введи полученную или ожидаемую оценку за <b>Файнал (экзамен)</b> от 0 до 100:\n<i>Например:</i> <code>85</code>`, { reply_markup: getCancelKeyboard() });
    }
}

// ==========================================
// ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ПОДКЛЮЧЕНИЯ LMS И LEARN
// ==========================================

function extractLmsCalendarOrCookie(input) {
    if (!input || typeof input !== 'string') return null;
    const str = input.trim();

    // 1. Прямая ссылка на экспорт календаря Moodle LMS (https / http / webcal)
    // Например: https://lms.astanait.edu.kz/calendar/export_execute.php?userid=18258&authtoken=0d3c12c531aeec350de2ca7cc064e882f761b418&preset_what=all&preset_time=recentupcoming
    const calMatch = str.match(/(?:https?:\/\/|webcal:\/\/)[^\s<>"]*lms\.astanait\.edu\.kz\/calendar\/export_execute\.php[^\s<>"]*/i) ||
                     str.match(/(?:https?:\/\/|webcal:\/\/)?[^\s<>"]*export_execute\.php\?[^\s<>"]*(?:authtoken|userid)=[^\s<>"]*/i);
    if (calMatch) {
        let url = calMatch[0];
        if (url.startsWith('webcal://')) {
            url = 'https://' + url.slice(9);
        } else if (!url.startsWith('http://') && !url.startsWith('https://')) {
            url = 'https://' + url;
        }
        return url;
    }

    // 2. Кука MoodleSession (MoodleSession=... или moodlesession: ...)
    const moodleMatch = str.match(/(?:moodlesession)\s*[:=]\s*([a-zA-Z0-9_\-]+)/i);
    if (moodleMatch && moodleMatch[1]) {
        return moodleMatch[1];
    }

    return null;
}

function extractLearnSessionId(input) {
    if (!input || typeof input !== 'string') return null;
    const str = input.trim();

    // 1. Явное указание sessionid=... или sessionid: ...
    const sidMatch = str.match(/(?:sessionid)\s*[:=]\s*([a-zA-Z0-9_\-]{16,64})/i);
    if (sidMatch && sidMatch[1]) {
        return sidMatch[1];
    }

    return null;
}

async function executeSetLms(chatId, val, isGauharUser) {
    let cleanVal = String(val).trim();
    if (cleanVal.startsWith('webcal://')) {
        cleanVal = 'https://' + cleanVal.slice(9);
    }

    const limitCheck = await lms.canUserSubscribe(chatId);
    if (!limitCheck.allowed) {
        return sendMessage(chatId, limitCheck.message, { reply_markup: getMainKeyboard(chatId) });
    }

    await sendMessage(chatId, '⏳ <i>Проверяю подключение к lms.astanait.edu.kz и генерирую вечный токен...</i>');
    const testRes = await lms.getUpcomingDeadlines(cleanVal);
    if (testRes.ok) {
        await lms.saveUserLmsSession(chatId, testRes.calendarUrl || cleanVal);
        const successNote = isGauharUser
            ? `🎉 <b>Гаухар, Moodle LMS успешно подключен!</b> 🧠✨\n` +
              `Найдено активных дедлайнов: <b>${testRes.quizzesCount}</b>\n\n` +
              `✅ Сгенерирован вечный токен: куки больше обновлять не нужно! Бот будет присылать напоминания каждое утро в 08:00 и за 1 час до дедлайна лично тебе.\n\n`
            : `🎉 <b>Moodle LMS успешно подключен!</b>\n` +
              `Найдено активных дедлайнов: <b>${testRes.quizzesCount}</b>\n\n` +
              `✅ Сгенерирован вечный токен календаря: сессия не истечет через 20 минут. Напоминания включены!\n\n`;

        return sendMessage(chatId, successNote + lms.formatLmsDeadlinesMessage(testRes, isGauharUser), {
            reply_markup: getMainKeyboard(chatId),
            disable_web_page_preview: true
        });
    } else {
        return sendMessage(chatId, '⚠️ <b>Ошибка подключения к LMS:</b> ' + testRes.error + '\n\nУбедитесь, что скопировали корректную ссылку на экспорт календаря или актуальное значение <code>MoodleSession</code> из lms.astanait.edu.kz.', {
            reply_markup: getMainKeyboard(chatId)
        });
    }
}

async function executeSetLearnCookie(chatId, cookieVal, isGauharUser) {
    const limitCheck = await aitu.canUserSubscribe(chatId);
    if (!limitCheck.allowed) {
        return sendMessage(chatId, limitCheck.message, { reply_markup: getMainKeyboard(chatId) });
    }

    let cleanSid = String(cookieVal).trim();
    const match = cleanSid.match(/sessionid=([^;\s]+)/i);
    if (match) cleanSid = match[1].trim();

    await sendMessage(chatId, '⏳ <i>Проверяю подключение к learn.astanait.edu.kz...</i>');
    const testRes = await aitu.getUpcomingQuizzes(cleanSid);
    if (testRes.ok) {
        await aitu.saveUserSession(chatId, cleanSid);
        const successNote = isGauharUser
            ? `🎉 <b>Гаухар, сессия успешно подключена!</b> 🧠✨\nНайдено дедлайнов: <b>${testRes.quizzes.length}</b>\n\n` +
              `✅ Теперь бот каждое утро в 08:00 и за 1 час до каждого дедлайна будет присылать персональные сигналы тревоги лично тебе, чтобы ты ничего не пропустила!\n\n`
            : `🎉 <b>Успешно подключено к AITU!</b>\nНайдено дедлайнов: <b>${testRes.quizzes.length}</b>\n\n` +
              `✅ Теперь бот каждое утро в 08:00 и экстренно за 1 час до дедлайна будет присылать персональные напоминания лично тебе!\n\n`;

        return sendMessage(chatId, successNote + aitu.formatQuizzesMessage(testRes, isGauharUser, false, 'week'), {
            reply_markup: getMainKeyboard(chatId),
            disable_web_page_preview: true
        });
    } else {
        return sendMessage(chatId, '⚠️ <b>Ошибка проверки сессии:</b> ' + testRes.error + '\n\nУбедитесь, что вы скопировали актуальный <code>sessionid</code> из браузера после входа в learn.astanait.edu.kz.', {
            reply_markup: getMainKeyboard(chatId)
        });
    }
}

// ==========================================
// ОБРАБОТКА ВХОДЯЩИХ ТЕКСТОВЫХ СООБЩЕНИЙ
// ==========================================

async function handleMessage(msg) {
    if (!msg || !msg.text) return;

    const chatId = msg.chat.id;
    const text = msg.text.trim();
    const userName = msg.from.username ? `@${msg.from.username}` : `${msg.from.first_name || ''} ${msg.from.last_name || ''}`.trim();
    activeUsers.add(String(chatId));

    const anonId = statsEngine.anonymizeUserId(chatId);
    await statsEngine.recordVisit({ anonId, platform: 'bot' }).catch(() => {});

    const session = getSession(chatId);
    const isGauharUser = typeof aitu.isGauhar === 'function' && aitu.isGauhar(chatId);

    // 0. Автоматическое обнаружение ссылки календаря Moodle LMS или MoodleSession (даже если отправлена напрямую без команды)
    const autoLms = extractLmsCalendarOrCookie(text);
    if (autoLms) {
        clearSession(chatId);
        return executeSetLms(chatId, autoLms, isGauharUser);
    }

    // 0.1. Автоматическое обнаружение cookie AITU Learn sessionid=... (даже если отправлена без команды)
    const autoLearn = extractLearnSessionId(text);
    if (autoLearn) {
        clearSession(chatId);
        return executeSetLearnCookie(chatId, autoLearn, isGauharUser);
    }

    // Обработка кнопки "Отмена / Главное меню" и любых вариантов отмены
    const isCancelText =
        text === 'Отмена / Главное меню' ||
        text === '❌ Отмена / Главное меню' ||
        text === 'Отмена' ||
        text === 'отмена' ||
        text === '/cancel' ||
        text === '/menu' ||
        text === '/stop' ||
        text === 'Главное меню' ||
        text === 'главное меню' ||
        text === 'Назад' ||
        text === 'назад' ||
        /^(?:❌\s*)?отмена(?:\s*\/\s*главное\s*меню)?$/i.test(text) ||
        /^(?:главное\s*меню|\/cancel|\/menu|\/stop|назад|меню)$/i.test(text);

    if (isCancelText) {
        clearSession(chatId);
        return sendMessage(chatId, '🏠 Действие отменено. Вы вернулись в главное меню.', { reply_markup: getMainKeyboard(chatId) });
    }

    // Приветствия и стандартные обращения (не пересылать админу и не вешать кулдаун)
    const isGreeting = /^(?:привет|приветик|салам|салам\s*алейкум|ассалаумағалейкум|здравствуй|здравствуйте|хай|hello|hi|добрый\s*(?:день|вечер|утро)|йоу|ку)(?![а-яёa-z0-9])/i.test(text);
    if (isGreeting) {
        const greetingText = isGauharUser
            ? `👋 <b>Привет, Гаухар!</b> Рады тебя видеть 🧠⚡️\n\nТы точно помнишь, какой калькулятор тебе нужен, или подсказать? 😉\nВыбирай кнопки внизу или пиши <code>/help</code>!`
            : `👋 <b>Привет!</b> Я академический бот-помощник <b>GradeMaster</b> для студентов AITU.\n\n` +
              `Я умею рассчитывать допуски, итоговые оценки, GPA, посещаемость и отслеживать дедлайны LMS/Learn.\n\n` +
              `👇 <i>Выберите нужный калькулятор на кнопках меню или напишите <code>/help</code>:</i>`;
        return sendMessage(chatId, greetingText, { reply_markup: getMainKeyboard(chatId) });
    }

    // Благодарности
    const isGratitude = /^(?:спасибо|благодарю|рахмет|спасиб|спасибочки|thx|thanks|thank\s*you)(?![а-яёa-z0-9])/i.test(text);
    if (isGratitude) {
        return sendMessage(chatId, '😊 <b>Пожалуйста!</b> Успешной учебы и высоких баллов на экзаменах! 🎓✨', { reply_markup: getMainKeyboard(chatId) });
    }

    // 1. /start
    if (text === '/start' || text.startsWith('/start ')) {
        clearSession(chatId);

        let welcome;
        if (isGauharUser) {
            welcome = `👋 <b>О, Гаухар (@goshoch), привет!</b> 🧠⚡️\n\n` +
                `Режим <i>«Не дать Гаухар всё забыть»</i> успешно активирован!\n` +
                `Ты точно помнишь, зачем сюда зашла, или тебе уже пора напомнить про дедлайны? 😉\n\n` +
                `Этот бот посчитает твои оценки, пропуски и не даст проспать сдачу лаб:\n` +
                `🚀 <b>Итоговая оценка</b> — расчет РегТерма и шансы на стипендию\n` +
                `📊 <b>Калькулятор GPA</b> — средний балл за триместр\n` +
                `📈 <b>Кумулятивный GPA</b> — общий балл за всё время учебы\n` +
                `📋 <b>Посещаемость</b> — чтобы случайно не уйти на летник\n` +
                `🔄 <b>Конвертер баллов</b> — перевод % в букву и GPA\n` +
                `⏰ <b>Дедлайны Learn & LMS</b> — экстренный сигнал за 1 час до закрытия приёма!\n\n` +
                `━━━━━━━━━━━━━━━━━━━━\n` +
                `🍪 <b>Гаухар, подключи дедлайны прямо сейчас, пока не забыла:</b>\n` +
                `• Квизы Learn: <code>/set_cookie ТВОЙ_SESSIONID</code>\n` +
                `• Лабы LMS: <code>/set_lms ТВОЙ_MOODLESESSION</code>\n` +
                `📖 <i>Если забыла, где брать куки — пиши <code>/cookie</code> (там гайд для забывчивых)!</i>\n` +
                `━━━━━━━━━━━━━━━━━━━━\n\n` +
                `👇 <i>Выбирай нужный калькулятор на кнопках ниже:</i>`;
        } else {
            welcome = `👋 <b>Добро пожаловать в GradeMaster Bot!</b> 🎓\n\n` +
                `Этот бот — ваш академический помощник и <b>полная замена сайту</b> в AITU:\n\n` +
                `🚀 <b>Итоговая оценка</b> — расчет РегТерма и прогноз баллов на экзамен (стипендия)\n` +
                `📊 <b>Калькулятор GPA</b> — средний балл за триместр с учетом кредитов\n` +
                `📈 <b>Кумулятивный GPA</b> — общий балл за всё время учебы\n` +
                `📋 <b>Посещаемость</b> — лимит 30% пропусков и безопасный остаток пар\n` +
                `🔄 <b>Конвертер баллов</b> — перевод % в буквенную оценку ECTS и GPA\n` +
                `⏰ <b>Дедлайны Learn & LMS</b> — авто-напоминания о квизах и лабах в 08:00 и за 1 час!\n\n` +
                `━━━━━━━━━━━━━━━━━━━━\n` +
                `🍪 <b>Как подключить напоминания по дедлайнам:</b>\n` +
                `1️⃣ <b>Квизы Learn:</b> войдите на <a href="https://learn.astanait.edu.kz/">learn.astanait.edu.kz</a> ➔ скопируйте <code>sessionid</code> из Cookies (F12 ➔ Application) ➔ отправьте боту:\n` +
                `👉 <code>/set_cookie ВАШ_SESSIONID</code>\n` +
                `2️⃣ <b>Лабы и задания LMS:</b> отправьте ссылку на экспорт календаря или куку <code>MoodleSession</code>:\n` +
                `👉 <code>/set_lms ВАША_КУКА_ИЛИ_ССЫЛКА</code>\n` +
                `<i>(💡 Бот сам создаст вечный токен, повторно вводить куки не придется)</i>\n\n` +
                `📖 <i>Полный пошаговый гайд с инструкцией для телефона: команда <code>/cookie</code></i>\n` +
                `━━━━━━━━━━━━━━━━━━━━\n\n` +
                `👇 <i>Выберите нужный калькулятор на кнопках ниже:</i>`;
        }

        return sendMessage(chatId, welcome, {
            reply_markup: getMainKeyboard(chatId),
            disable_web_page_preview: true
        });
    }

    // 1.5. Квизы AITU (/quizzes, /aitu) - Персональные квизы для каждого студента
    if (text === '📝 Квизы AITU' || text === '📝 Мои квизы AITU' || text === '/quizzes' || text === '/aitu' || text === 'Квизы AITU' || text === 'Квизы' || text === 'Мои квизы') {
        const userSid = await aitu.getUserSession(chatId);

        if (!userSid) {
            const setupMsg = isGauharUser
                ? `📝 <b>Персональные квизы learn.astanait.edu.kz для Гаухар</b> 🧠\n\n` +
                  `Подключи автоматические напоминания лично для себя, чтобы ничего не забыть:\n` +
                  `• 🎯 Бот проверяет твои личные курсы и присылает твои дедлайны.\n` +
                  `• ☀️ Каждое утро в 08:00 — сводка квизов на ближайшие 3 дня.\n` +
                  `• 🚨 За 1 час до конца дедлайна — громкое экстренное оповещение с сиреной и кнопкой сдачи!\n\n` +
                  `👉 <b>Как подключить за 1 минуту:</b>\n` +
                  `1. Войди на <a href="https://learn.astanait.edu.kz">learn.astanait.edu.kz</a> через браузер на компьютере.\n` +
                  `2. Нажми <b>F12</b> ➔ вкладка <b>Application (Приложение)</b> ➔ <b>Cookies</b> ➔ скопируй значение <code>sessionid</code>.\n` +
                  `3. Отправь боту команду сюда в чат:\n` +
                  `<code>/set_cookie ТВОЙ_SESSION_ID</code>\n\n` +
                  `🔒 <i>Твоя сессия хранится изолированно и доступна только тебе.</i>`
                : `📝 <b>Персональные квизы learn.astanait.edu.kz</b>\n\n` +
                  `Вы можете подключить автоматические напоминания лично для себя:\n` +
                  `• 🎯 Бот проверяет только ваши личные курсы и присылает ваши дедлайны.\n` +
                  `• ☀️ Каждое утро в 08:00 — сводка квизов на ближайшие 3 дня.\n` +
                  `• 🚨 За 1 час до конца дедлайна — громкое экстренное оповещение со звуком и кнопкой сдачи!\n\n` +
                  `👉 <b>Как подключить за 1 минуту:</b>\n` +
                  `1. Войдите на <a href="https://learn.astanait.edu.kz">learn.astanait.edu.kz</a> через браузер на компьютере.\n` +
                  `2. Нажмите <b>F12</b> (Инструменты разработчика) ➔ вкладка <b>Application (Приложение)</b> ➔ <b>Cookies</b> ➔ скопируйте значение <code>sessionid</code>.\n` +
                  `3. Отправьте боту команду в этот чат:\n` +
                  `<code>/set_cookie ВАШ_SESSION_ID</code>\n\n` +
                  `🔒 <i>100% изоляция: ваша сессия доступна только вам и хранится в защищенном виде.</i>`;

            return sendMessage(chatId, setupMsg, {
                reply_markup: getMainKeyboard(chatId),
                disable_web_page_preview: true
            });
        }

        const checkingText = isGauharUser
            ? '⏳ <i>Сверяю дедлайны для Гаухар... Спойлер: ты наверняка забыла минимум про один 🔍</i>'
            : '⏳ <i>Проверяю ваши квизы и дедлайны на learn.astanait.edu.kz...</i>';
        await sendMessage(chatId, checkingText);
        const result = await aitu.getUpcomingQuizzesForUser(chatId);
        const msgText = aitu.formatQuizzesMessage(result, isGauharUser, false, 'week');
        const sessionKeyboard = getLearnSessionKeyboard(result, 'week');
        return sendMessage(chatId, msgText, {
            reply_markup: sessionKeyboard,
            disable_web_page_preview: true
        });
    }

    // 1.5.1. /all_quizzes, /all_learn (Квизы Learn на весь семестр)
    if (text === '/all_quizzes' || text === '/all_learn') {
        const userSid = await aitu.getUserSession(chatId);
        if (!userSid) {
            return sendMessage(chatId, '⚠️ Сессия не найдена. Отправьте команду /set_cookie ВАШ_SESSION_ID.');
        }
        await sendMessage(chatId, '⏳ <i>Загружаю квизы Learn на весь семестр...</i>');
        const result = await aitu.getUpcomingQuizzesForUser(chatId);
        const msgText = aitu.formatQuizzesMessage(result, isGauharUser, false, 'all');
        const sessionKeyboard = getLearnSessionKeyboard(result, 'all');
        return sendMessage(chatId, msgText, {
            reply_markup: sessionKeyboard,
            disable_web_page_preview: true
        });
    }

    // 1.6. /cookie, /cookies, /cookie_guide, /гайд, /куки, /phone, /mobile (Руководство по подключению куки)
    if (
        text === '/cookie' || text === '/cookies' || text === '/cookie_guide' ||
        text === '/гайд' || text === '/куки' || text === '/инструкция_куки' ||
        text === '/phone' || text === '/mobile' || text === '/телефон' || text === '/смартфон' ||
        text === '🍪 Инструкция по кукам' || text === 'Инструкция по кукам' ||
        text.toLowerCase().includes('как подключить куки') ||
        text.toLowerCase().includes('как добавить куки') ||
        text.toLowerCase().includes('где взять куки') ||
        text.toLowerCase().includes('где взять sessionid') ||
        text.toLowerCase().includes('где взять moodlesession') ||
        text.toLowerCase().includes('как с телефона') ||
        text.toLowerCase().includes('как подключить с телефона') ||
        text.toLowerCase().includes('гайд с телефона') ||
        text.toLowerCase().includes('гайд как с телефона')
    ) {
        const guide = getCookieGuideText(isGauharUser);
        return sendMessage(chatId, guide, {
            reply_markup: getMainKeyboard(chatId),
            disable_web_page_preview: true
        });
    }

    // 1.6.1. /set_cookie <sessionid> (Персональное подключение сессии AITU)
    if (text.startsWith('/set_cookie') || text.startsWith('/cookie ')) {
        const cookieVal = text.replace(/^\/(?:set_cookie|cookie)\s*/, '').trim();
        if (!cookieVal) {
            const guide = getCookieGuideText(isGauharUser);
            return sendMessage(chatId, guide, {
                reply_markup: getMainKeyboard(chatId),
                disable_web_page_preview: true
            });
        }
        return executeSetLearnCookie(chatId, cookieVal, isGauharUser);
    }

    // 1.6.1. /logout или /del_cookie (Отключение персональной сессии)
    if (text === '/logout' || text === '/del_cookie' || text === '/disconnect') {
        await aitu.deleteUserSession(chatId);
        const logoutNote = isGauharUser
            ? '🚪 <b>Гаухар, твоя сессия отключена.</b>\nАвтоматические напоминания остановлены. Теперь вся надежда только на твою память! 😅'
            : '🚪 <b>Ваша сессия отключена.</b>\nАвтоматические напоминания по квизам остановлены, сессия удалена.';
        return sendMessage(chatId, logoutNote, {
            reply_markup: getMainKeyboard(chatId)
        });
    }

    // 1.7. /lms, /deadlines, /дедлайны или кнопка "📚 Дедлайны LMS"
    if (text === '/lms' || text === '/deadlines' || text === '/дедлайны' || text === '📚 Дедлайны LMS' || text === 'Дедлайны LMS') {
        const userLms = await lms.getUserLmsSession(chatId);
        if (!userLms) {
            const setupMsg = lms.formatLmsDeadlinesMessage({ ok: false, notConfigured: true }, isGauharUser);
            return sendMessage(chatId, setupMsg, {
                reply_markup: getMainKeyboard(chatId),
                disable_web_page_preview: true
            });
        }

        const checkingText = isGauharUser
            ? '⏳ <i>Сверяю дедлайны LMS для Гаухар... Главное ничего не забыть! 🔍</i>'
            : '⏳ <i>Загружаю актуальные дедлайны из Moodle LMS (lms.astanait.edu.kz)...</i>';
        await sendMessage(chatId, checkingText);
        const result = await lms.getUpcomingDeadlinesForUser(chatId);
        const msgText = lms.formatLmsDeadlinesMessage(result, isGauharUser, false, 'week');
        const sessionKeyboard = getLmsSessionKeyboard(result, 'week');
        return sendMessage(chatId, msgText, {
            reply_markup: sessionKeyboard,
            disable_web_page_preview: true
        });
    }

    // 1.7.1. /all_deadlines, /all_lms, /весь_семестр (Дедлайны LMS на весь семестр)
    if (text === '/all_deadlines' || text === '/all_lms' || text === '/весь_семестр') {
        const userLms = await lms.getUserLmsSession(chatId);
        if (!userLms) {
            const setupMsg = lms.formatLmsDeadlinesMessage({ ok: false, notConfigured: true }, isGauharUser);
            return sendMessage(chatId, setupMsg, {
                reply_markup: getMainKeyboard(chatId),
                disable_web_page_preview: true
            });
        }
        await sendMessage(chatId, '⏳ <i>Загружаю дедлайны LMS на весь семестр...</i>');
        const result = await lms.getUpcomingDeadlinesForUser(chatId);
        const msgText = lms.formatLmsDeadlinesMessage(result, isGauharUser, false, 'all');
        const sessionKeyboard = getLmsSessionKeyboard(result, 'all');
        return sendMessage(chatId, msgText, {
            reply_markup: sessionKeyboard,
            disable_web_page_preview: true
        });
    }

    // 1.7.2. /courses, /предметы, /курсы (Интерактивная фильтрация по предметам)
    if (text === '/courses' || text === '/предметы' || text === '/курсы') {
        const hasLms = Boolean(await lms.getUserLmsSession(chatId));
        const hasAitu = Boolean(await aitu.getUserSession(chatId));
        if (!hasLms && !hasAitu) {
            return sendMessage(chatId, 'ℹ️ У вас пока не подключены ни LMS, ни AITU Learn.\nПодключите их через команду <code>/cookie</code>, чтобы фильтровать дедлайны по предметам!', {
                reply_markup: getMainKeyboard(chatId)
            });
        }
        const buttons = [];
        if (hasLms) {
            buttons.push([{ text: '📚 Предметы Moodle LMS', callback_data: 'lms_courses_menu' }]);
        }
        if (hasAitu) {
            buttons.push([{ text: '📝 Предметы AITU Learn', callback_data: 'learn_courses_menu' }]);
        }
        return sendMessage(chatId, '🔍 <b>Выберите платформу для просмотра предметов:</b>', {
            reply_markup: { inline_keyboard: buttons }
        });
    }

    // 1.8. /set_lms <MoodleSession или Calendar URL>
    if (text.startsWith('/set_lms') || text.startsWith('/lms_cookie')) {
        const val = text.replace(/^\/(?:set_lms|lms_cookie)/, '').trim();
        if (!val) {
            const guide = getCookieGuideText(isGauharUser);
            return sendMessage(chatId, guide, {
                reply_markup: getMainKeyboard(chatId),
                disable_web_page_preview: true
            });
        }
        return executeSetLms(chatId, val, isGauharUser);
    }

    // 1.9. /del_lms или /logout_lms (Отключение сессии LMS)
    if (text === '/del_lms' || text === '/logout_lms' || text === '/lms_logout') {
        await lms.deleteUserLmsSession(chatId);
        const logoutNote = isGauharUser
            ? '🚪 <b>Гаухар, напоминания LMS отключены.</b>\nАвтоматические сигналы по заданиям остановлены. Не забудь сдать лабы! 😅'
            : '🚪 <b>Сессия Moodle LMS отключена.</b>\nАвтоматические напоминания о дедлайнах заданий остановлены.';
        return sendMessage(chatId, logoutNote, {
            reply_markup: getMainKeyboard(chatId)
        });
    }

    // 1.9.1. /done, /сдал, /сдано (Отметка сданных заданий и квизов)
    if (text === '/done' || text === '/сдал' || text === '/сдано' || text === '/completed' || text === '✅ Отметить сданное') {
        const hasLms = Boolean(await lms.getUserLmsSession(chatId));
        const hasAitu = Boolean(await aitu.getUserSession(chatId));

        if (!hasLms && !hasAitu) {
            return sendMessage(chatId, 'ℹ️ У вас пока не подключены ни LMS, ни AITU Learn.\n\nПодключите их:\n• <code>/set_lms ВАША_КУКА_ИЛИ_ССЫЛКА</code> — для домашних заданий LMS\n• <code>/set_cookie ВАШ_SESSION_ID</code> — для квизов Learn\n\nИли напишите <code>/cookie</code> для инструкции.', {
                reply_markup: getMainKeyboard(chatId)
            });
        }

        const buttons = [];
        if (hasLms) {
            buttons.push([{ text: '📚 Отметить задания Moodle LMS', callback_data: 'lms_mark_menu' }]);
        }
        if (hasAitu) {
            buttons.push([{ text: '📝 Отметить квизы AITU Learn', callback_data: 'learn_mark_menu' }]);
        }

        const promptText = isGauharUser
            ? `🎯 <b>Гаухар, отмечаем сданное!</b> 🎓\nВыбери сервис, где ты уже сдала задания, чтобы бот не доставал тебя напоминаниями по ним:`
            : `🎯 <b>Управление сданными заданиями:</b>\nВыберите сервис, в котором хотите отметить сданные работы, чтобы исключить их из напоминаний:`;

        return sendMessage(chatId, promptText, {
            reply_markup: { inline_keyboard: buttons }
        });
    }

    // 1.7. /test_reminder (Тестирование ежедневного напоминания Cron)
    if (text === '/test_reminder' || text === '/cron') {
        if (!isAdmin(chatId)) {
            return sendMessage(chatId, 'Доступ запрещен.');
        }
        await sendMessage(chatId, '⏳ Запускаю тестовую проверку напоминаний по квизам...');
        const result = await aitu.getUpcomingQuizzes();
        if (!result.ok) {
            return sendMessage(chatId, '❌ Ошибка: ' + result.error);
        }
        const urgent = result.quizzes.filter(q => !q.isPast && q.diffDays <= 3);
        if (urgent.length === 0) {
            return sendMessage(chatId, 'ℹ️ В ближайшие 3 дня срочных дедлайнов нет. Всего активных квизов в семестре: <b>' + result.quizzes.length + '</b>.');
        }
        let alertMsg = '🔔 <b>Тестовое напоминание о квизах AITU:</b>\n\n';
        for (const item of urgent) {
            const dateObj = new Date(item.dueDate);
            const astanaTime = new Intl.DateTimeFormat('ru-RU', {
                timeZone: 'Asia/Almaty',
                day: 'numeric',
                month: 'short',
                hour: '2-digit',
                minute: '2-digit'
            }).format(dateObj);
            alertMsg += '📚 <b>' + item.courseName + '</b>\n📝 <a href="' + item.link + '">' + item.title + '</a>\n⏰ Дедлайн: <b>' + astanaTime + '</b> (осталось ' + item.diffDays + ' дн.)\n\n';
        }
        return sendMessage(chatId, alertMsg, { disable_web_page_preview: true });
    }

    // 1.8. /test_1h (Тестирование экстренного оповещения за 1 час)
    if (text === '/test_1h' || text === '/urgent') {
        if (!isAdmin(chatId)) {
            return sendMessage(chatId, 'Доступ запрещен.');
        }
        await sendMessage(chatId, '⏳ Генерирую тестовое оповещение за 1 час до дедлайна...');
        const result = await aitu.getUpcomingQuizzes();
        let targetQuiz = null;
        if (result.ok && result.quizzes && result.quizzes.length > 0) {
            targetQuiz = result.quizzes.find(q => !q.isPast) || result.quizzes[0];
        }
        if (!targetQuiz) {
            targetQuiz = {
                courseName: 'Philosophy',
                title: 'Quiz 2. Epistemological Paradigms',
                link: 'https://learn.astanait.edu.kz/courses/course-v1:AITU+PHIL01+26-27_C1_Y3/course/',
                dueDate: new Date(Date.now() + 48 * 60 * 1000).toISOString(),
                diffMinutes: 48,
                diffHours: 0.8,
                diffDays: 0,
                isCriticalHour: true
            };
        }
        const { text: alertText, replyMarkup } = aitu.formatCriticalHourAlert(targetQuiz);
        return sendMessage(chatId, alertText, {
            reply_markup: replyMarkup,
            disable_notification: false
        });
    }

    // 2. /help или "Инструкция"
    if (text === '/help' || text === 'Инструкция' || text === '❓ Понятная инструкция') {
        return sendMessage(chatId, getFoolproofHelpText(isGauharUser), {
            reply_markup: getCalculatorsInlineKeyboard()
        });
    }

    // 2.1. Секретный тест памяти (Пасхалка для Гаухар)
    if (text === '/memory' || text === '/память' || text === '/ктоя' || text === '/whoami') {
        if (isGauharUser) {
            const memoryQuiz = `🧠 <b>Экспресс-тест памяти для Гаухар:</b>\n\n` +
                `1. Ты выключила утюг? 🤔\n` +
                `2. Ты закрыла входную дверь? 🔑\n` +
                `3. Ты сдала все квизы на learn.astanait.edu.kz? 📚\n\n` +
                `<i>(Спойлер: насчёт третьего пункта мы сильно сомневаемся, бегом проверять по кнопке «📝 Мои квизы AITU»!)</i> ⚡️`;
            return sendMessage(chatId, memoryQuiz, { reply_markup: getMainKeyboard(chatId) });
        } else {
            return sendMessage(chatId, `🧠 <b>Проверка памяти:</b>\n\nВаш Chat ID: <code>${chatId}</code>\nСессия AITU: <b>${(await aitu.getUserSession(chatId)) ? 'Подключена ✅' : 'Не подключена ❌'}</b>\n\nВсе системы работают штатно!`, { reply_markup: getMainKeyboard(chatId) });
        }
    }

    // 3. /admin или "Панель Администратора" (ТОЛЬКО ДЛЯ АДМИНА)
    if (text === '/admin' || text === 'Панель Администратора' || text === '⚙️ Панель Администратора') {
        if (!isAdmin(chatId)) {
            return sendMessage(chatId, 'Команда не найдена. Напишите <code>/help</code> для просмотра доступных функций.', { reply_markup: getMainKeyboard(chatId) });
        }
        return handleAdminPanel(chatId);
    }

    // 3.1. /stats (ТОЛЬКО ДЛЯ АДМИНА)
    if (text === '/stats' || text === '📊 Статистика') {
        if (!isAdmin(chatId)) {
            return sendMessage(chatId, 'Команда не найдена. Напишите <code>/help</code> для просмотра доступных функций.', { reply_markup: getMainKeyboard(chatId) });
        }
        const statsMsg = await statsEngine.formatStatsTelegram();
        return sendMessage(chatId, statsMsg, { reply_markup: getMainKeyboard(chatId) });
    }

    // 4. /id
    if (text === '/id') {
        return sendMessage(chatId, `Ваш Telegram Chat ID: <code>${chatId}</code>\nИмя: <b>${esc(userName)}</b>\nПрава: <b>${isAdmin(chatId) ? 'Администратор' : 'Студент'}</b>`);
    }

    // 5. /broadcast <текст> (ТОЛЬКО ДЛЯ АДМИНА)
    if (text.startsWith('/broadcast')) {
        if (!isAdmin(chatId)) {
            return sendMessage(chatId, 'Доступ запрещен.');
        }
        const broadcastText = text.replace('/broadcast', '').trim();
        if (!broadcastText) {
            return sendMessage(chatId, 'Введите текст для рассылки: <code>/broadcast Внимание! ...</code>');
        }

        let sent = 0;
        let failed = 0;
        for (const user of activeUsers) {
            try {
                await sendMessage(user, `<b>Объявление от GradeMaster:</b>\n\n${esc(broadcastText)}`);
                sent++;
            } catch {
                failed++;
            }
        }
        return sendMessage(chatId, `<b>Рассылка завершена!</b>\nУспешно отправлено: <b>${sent}</b>\nОшибок: <b>${failed}</b>`);
    }

    // 6. /reply <chat_id> <текст> (ТОЛЬКО ДЛЯ АДМИНА)
    if (text.startsWith('/reply')) {
        if (!isAdmin(chatId)) {
            return sendMessage(chatId, 'Доступ запрещен.');
        }
        const parts = text.split(/\s+/);
        if (parts.length < 3) {
            return sendMessage(chatId, '<b>Формат команды:</b> <code>/reply &lt;chat_id&gt; &lt;текст ответа&gt;</code>\n<i>Пример:</i> <code>/reply 123456789 Ваш вопрос решен!</code>');
        }
        const targetId = parts[1];
        const replyBody = parts.slice(2).join(' ');

        try {
            await sendMessage(targetId, `<b>Ответ от администратора GradeMaster:</b>\n\n${esc(replyBody)}\n\n<i>Вы можете написать сюда в ответ, чтобы продолжить диалог.</i>`);
            return sendMessage(chatId, `Ответ успешно доставлен студенту (ID: <code>${targetId}</code>)!`);
        } catch (err) {
            return sendMessage(chatId, `Ошибка отправки: ${esc(err.message)}`);
        }
    }

    // 7. Кнопки главного меню (Запуск мастеров)
    if (text === 'Итоговая оценка' || text === '🚀 Итоговая оценка') {
        session.step = 'total_regmid';
        session.data = {};
        return sendMessage(chatId, `<b>Калькулятор итоговой оценки (Шаг 1 из 2):</b>\n\nВведи твой балл за <b>РегМид</b> (число от 0 до 100).\n<i>Например:</i> <code>85</code>`, { reply_markup: getCancelKeyboard() });
    }

    if (text === 'Калькулятор GPA' || text === '📊 Калькулятор GPA') {
        session.step = 'gpa_input';
        session.data = {};
        return sendMessage(chatId, `<b>Калькулятор GPA за триместр:</b>\n\nОтправь оценки и кредиты предметов через запятую.\n<b>Формат:</b> <code>Оценка Кредиты</code>\n\n<i>Пример:</i> <code>90 3, 85 4, 95 2</code>`, { reply_markup: getCancelKeyboard() });
    }

    if (text === 'Кумулятивный GPA' || text === '📈 Кумулятивный GPA') {
        session.step = 'cum_input';
        session.data = {};
        return sendMessage(chatId, `<b>Кумулятивный GPA:</b>\n\nОтправь GPA и количество кредитов за каждый триместр через запятую.\n<b>Формат:</b> <code>GPA Кредиты</code>\n\n<i>Пример:</i> <code>3.5 15, 3.8 20, 3.2 18</code>`, { reply_markup: getCancelKeyboard() });
    }

    if (text === 'Посещаемость' || text === '📋 Посещаемость') {
        session.step = 'att_lessons';
        session.data = {};
        return sendMessage(chatId, `<b>Калькулятор посещаемости (Шаг 1 из 2):</b>\n\nСколько пар в неделю по предмету?\n<i>Введи число от 1 до 20 (например: <code>3</code>)</i>`, { reply_markup: getCancelKeyboard() });
    }

    if (text === 'Конвертер GPA' || text === '🔄 Конвертер GPA') {
        session.step = 'conv_input';
        session.data = {};
        return sendMessage(chatId, `<b>Конвертер оценок в GPA:</b>\n\nВведи процентную оценку (число от 0 до 100).\n<i>Например:</i> <code>87</code>`, { reply_markup: getCancelKeyboard() });
    }

    if (text === 'Отзыв / Поддержка' || text === '💬 Отзыв / Поддержка') {
        session.step = 'feed_input';
        session.data = {};
        const feedPrompt = isGauharUser
            ? `💬 <b>Служба поддержки и отзывов:</b>\n\nГаухар, ты точно хотела написать разработчику или случайно забыла, куда нажимала? 😉 Пиши свой вопрос или идею — создатель бота всё равно прочитает первым! 🫡`
            : `<b>Служба поддержки и обратной связи:</b>\n\nНапишите ваше сообщение, вопрос или предложение. Администратор прочитает его и сможет ответить вам прямо здесь!`;
        return sendMessage(chatId, feedPrompt, { reply_markup: getCancelKeyboard() });
    }

    // 8. Обработка быстрых команд одной строкой (/calc, /gpa, /cgpa, /att, /convert)
    if (text === '/calc' || text.startsWith('/calc ')) {
        const parts = text.split(/\s+/).slice(1);
        if (parts.length < 2) {
            return sendMessage(chatId, '❌ <b>Недостаточно данных.</b>\n<i>Формат:</i> <code>/calc РегМид РегЭнд [Файнал]</code>\n<i>Пример:</i> <code>/calc 80 85</code> или <code>/calc 80 85 90</code>');
        }
        await statsEngine.recordCalculation({ calcType: 'total', platform: 'bot' }).catch(() => {});
        const res = calculateGradeReport(parts[0], parts[1], parts[2], isGauharUser);
        return sendMessage(chatId, res, { reply_markup: getMainKeyboard(chatId) });
    }

    if (text === '/gpa' || text.startsWith('/gpa ')) {
        const raw = text.replace(/^\/gpa\s*/i, '');
        await statsEngine.recordCalculation({ calcType: 'gpa', platform: 'bot' }).catch(() => {});
        const res = calculateGPAReport(raw, isGauharUser);
        return sendMessage(chatId, res, { reply_markup: getMainKeyboard(chatId) });
    }

    if (/^\/(?:cgpa|cumulative|totalgpa|cum)(?:\s|$)/i.test(text)) {
        const raw = text.replace(/^(\/cgpa|\/cumulative|\/totalgpa|\/cum)\s*/i, '');
        await statsEngine.recordCalculation({ calcType: 'cumulative', platform: 'bot' }).catch(() => {});
        const res = calculateCumulativeGPAReport(raw, isGauharUser);
        return sendMessage(chatId, res, { reply_markup: getMainKeyboard(chatId) });
    }

    if (text === '/att' || text.startsWith('/att ')) {
        const parts = text.split(/\s+/).slice(1);
        if (parts.length === 0) {
            return sendMessage(chatId, '❌ <b>Укажите количество пар в неделю.</b>\n<i>Пример:</i> <code>/att 3</code> или <code>/att 3 2</code>');
        }
        await statsEngine.recordCalculation({ calcType: 'attendance', platform: 'bot' }).catch(() => {});
        const res = calculateAttendanceReport(parts[0], parts[1], isGauharUser);
        return sendMessage(chatId, res, { reply_markup: getMainKeyboard(chatId) });
    }

    if (/^\/(?:convert|conv)(?:\s|$)/i.test(text)) {
        const parts = text.split(/\s+/).slice(1);
        if (parts.length === 0) {
            return sendMessage(chatId, '❌ <b>Укажите балл для конвертации.</b>\n<i>Пример:</i> <code>/convert 87</code>');
        }
        const res = convertGradeReport(parts[0]);
        return sendMessage(chatId, res, { reply_markup: getMainKeyboard(chatId) });
    }

    // 9. Пошаговые сценарии (Interactive Wizard Steps)
    if (session.step === 'total_regmid') {
        const val = parseFloat(text);
        if (isNaN(val) || val < 0 || val > 100) {
            return sendMessage(chatId, '❌ Введи число от 0 до 100 за РегМид. Например: <code>85</code>');
        }
        session.data.rm = val;
        session.step = 'total_regend';
        return sendMessage(chatId, `✅ <b>РегМид: ${val}</b>\n\n<b>Шаг 2 из 2:</b> Теперь введи балл за <b>РегЭнд</b> (от 0 до 100):\n<i>Например:</i> <code>80</code>`);
    }

    if (session.step === 'total_regend') {
        const val = parseFloat(text);
        if (isNaN(val) || val < 0 || val > 100) {
            return sendMessage(chatId, '❌ Введи число от 0 до 100 за РегЭнд. Например: <code>80</code>');
        }
        const rm = session.data.rm;
        const re = val;
        clearSession(chatId);

        await statsEngine.recordCalculation({ calcType: 'total', platform: 'bot' }).catch(() => {});
        const forecast = calculateGradeReport(rm, re, null, isGauharUser);
        const inlineKeyboard = {
            inline_keyboard: [
                [{ text: '📝 Я уже сдал экзамен — ввести Файнал', callback_data: `add_final_${rm}_${re}` }],
                [{ text: '🔄 Рассчитать другой предмет', callback_data: 'wiz_total' }]
            ]
        };
        return sendMessage(chatId, forecast, {
            reply_markup: inlineKeyboard
        });
    }

    if (session.step === 'total_final') {
        const val = parseFloat(text);
        if (isNaN(val) || val < 0 || val > 100) {
            return sendMessage(chatId, '❌ Введи число от 0 до 100 за Файнал. Например: <code>90</code>');
        }
        const rm = session.data.rm;
        const re = session.data.re;
        clearSession(chatId);

        await statsEngine.recordCalculation({ calcType: 'total', platform: 'bot' }).catch(() => {});
        const res = calculateGradeReport(rm, re, val, isGauharUser);
        return sendMessage(chatId, res, { reply_markup: getMainKeyboard(chatId) });
    }

    if (session.step === 'gpa_input') {
        clearSession(chatId);
        await statsEngine.recordCalculation({ calcType: 'gpa', platform: 'bot' }).catch(() => {});
        const res = calculateGPAReport(text, isGauharUser);
        return sendMessage(chatId, res, { reply_markup: getMainKeyboard(chatId) });
    }

    if (session.step === 'cgpa_input' || session.step === 'cum_input') {
        clearSession(chatId);
        await statsEngine.recordCalculation({ calcType: 'cumulative', platform: 'bot' }).catch(() => {});
        const res = calculateCumulativeGPAReport(text, isGauharUser);
        return sendMessage(chatId, res, { reply_markup: getMainKeyboard(chatId) });
    }

    if (session.step === 'att_lessons') {
        const lessons = parseFloat(text);
        if (isNaN(lessons) || lessons < 1 || lessons > 20 || !Number.isInteger(lessons)) {
            return sendMessage(chatId, '❌ Введи целое число от 1 до 20 (количество занятий в неделю). Например: <code>3</code> или <code>4</code>');
        }
        session.data.lessons = lessons;
        session.step = 'att_missed';
        return sendMessage(chatId, `✅ <b>Занятий в неделю: ${lessons}</b>\n\n<b>Шаг 2 из 2:</b> Сколько занятий вы <b>уже пропустили</b>?\n<i>(💡 Напоминаем: сдвоенная пара на 100 мин = 2 пропущенных занятия)\nЕсли ещё не пропускали, введите <code>0</code>:</i>`);
    }

    if (session.step === 'att_missed') {
        const missed = parseFloat(text);
        if (isNaN(missed) || missed < 0 || !Number.isInteger(missed)) {
            return sendMessage(chatId, '❌ Введите целое неотрицательное число (например: <code>0</code> или <code>2</code>)');
        }
        const lessons = session.data.lessons;
        clearSession(chatId);

        await statsEngine.recordCalculation({ calcType: 'attendance', platform: 'bot' }).catch(() => {});
        const res = calculateAttendanceReport(lessons, missed, isGauharUser);
        return sendMessage(chatId, res, { reply_markup: getMainKeyboard(chatId) });
    }

    if (session.step === 'conv_input') {
        clearSession(chatId);
        const res = convertGradeReport(text);
        return sendMessage(chatId, res, { reply_markup: getMainKeyboard(chatId) });
    }

    if (session.step === 'feed_input') {
        const rl = checkRateLimit(chatId);
        if (!rl.allowed) {
            clearSession(chatId);
            return sendMessage(chatId, rl.message, { reply_markup: getMainKeyboard(chatId) });
        }
        recordRateLimit(chatId);
        clearSession(chatId);
        const targetAdmin = getPrimaryAdminId();
        if (targetAdmin && String(chatId) !== String(targetAdmin)) {
            try {
                const notify = `📨 <b>Новое обращение от студента:</b>\n\n` +
                    `👤 <b>От:</b> ${esc(userName)} (ID: <code>${chatId}</code>)\n` +
                    `💬 <b>Текст:</b>\n${esc(text)}\n\n` +
                    `<i>💡 Чтобы ответить студенту, отправьте:</i>\n<code>/reply ${chatId} Ваш ответ</code>`;
                await sendMessage(targetAdmin, notify);
            } catch (e) {
                console.error('Failed to notify admin:', e);
            }
        }
        return sendMessage(chatId, `✅ <b>Спасибо! Ваше обращение передано администратору.</b>\nМы ответим вам в этом диалоге.`, { reply_markup: getMainKeyboard(chatId) });
    }

    // 9.5. Парсинг естественного языка для академических вопросов (Top-6)
    const nlpReport = parseNaturalLanguageAcademicQuery(text, isGauharUser);
    if (nlpReport) {
        const rl = checkRateLimit(chatId);
        if (!rl.allowed) {
            return sendMessage(chatId, rl.message, { reply_markup: getMainKeyboard(chatId) });
        }
        recordRateLimit(chatId);
        await statsEngine.recordCalculation({ calcType: 'total', platform: 'bot' }).catch(() => {});
        return sendMessage(chatId, nlpReport, { reply_markup: getMainKeyboard(chatId) });
    }

    // 10. Попытка автоматического распознавания чисел (если пользователь просто отправил числа)
    const numTokens = text.split(/[\s,]+/).filter(Boolean).map(Number);
    if (numTokens.length >= 2 && numTokens.every(n => !isNaN(n) && n >= 0 && n <= 100)) {
        await statsEngine.recordCalculation({ calcType: 'total', platform: 'bot' }).catch(() => {});
        if (numTokens.length === 2) {
            const res = calculateGradeReport(numTokens[0], numTokens[1], null, isGauharUser);
            return sendMessage(chatId, `💡 <i>Распознан расчёт РегМид = ${numTokens[0]}, РегЭнд = ${numTokens[1]}:</i>\n\n${res}`, { reply_markup: getMainKeyboard(chatId) });
        }
        if (numTokens.length === 3) {
            const res = calculateGradeReport(numTokens[0], numTokens[1], numTokens[2], isGauharUser);
            return sendMessage(chatId, `💡 <i>Распознан итоговый расчёт РегМид = ${numTokens[0]}, РегЭнд = ${numTokens[1]}, Файнал = ${numTokens[2]}:</i>\n\n${res}`, { reply_markup: getMainKeyboard(chatId) });
        }
    }

    // 10.5. Неизвестная слэш-команда (опечатка студента)
    if (text.startsWith('/')) {
        const cmdName = text.split(/\s+/)[0];
        return sendMessage(chatId, `❓ Неизвестная команда <code>${esc(cmdName)}</code>.\n\nНапишите <code>/help</code> для списка доступных команд или выберите калькулятор на клавиатуре внизу.`, { reply_markup: getMainKeyboard(chatId) });
    }

    // 10.6. Случайные знаки или короткий шум (не создавать тикет админу и не тратить лимит студента)
    if (text.length < 3 || /^[!?. ,;:\-_+=@#$%^&*()]+$/.test(text)) {
        return sendMessage(chatId, `❓ Не удалось распознать сообщение.\n\nНажмите <b>«Инструкция»</b> или напишите <code>/help</code>, чтобы посмотреть возможности бота.`, { reply_markup: getMainKeyboard(chatId) });
    }

    // 11. Нераспознанное содержательное сообщение — пересылка админу как вопрос/отзыв
    const targetAdmin = getPrimaryAdminId();
    if (targetAdmin && String(chatId) !== String(targetAdmin)) {
        const rl = checkRateLimit(chatId);
        if (!rl.allowed) {
            return sendMessage(chatId, rl.message, { reply_markup: getMainKeyboard(chatId) });
        }
        recordRateLimit(chatId);
        try {
            const notify = `📨 <b>Сообщение от студента:</b>\n\n` +
                `👤 <b>От:</b> ${esc(userName)} (ID: <code>${chatId}</code>)\n` +
                `💬 <b>Текст:</b>\n${esc(text)}\n\n` +
                `<i>💡 Чтобы ответить:</i> <code>/reply ${chatId} Ваш ответ</code>`;
            await sendMessage(targetAdmin, notify);
        } catch (e) {
            console.error('Admin forward error:', e);
        }
        return sendMessage(chatId, `📨 <b>Ваше сообщение получено и передано разработчику!</b>\n\nДля выбора калькулятора используйте кнопки внизу меню или напишите <code>/help</code>.`, { reply_markup: getMainKeyboard(chatId) });
    }

    return sendMessage(chatId, `❓ Неизвестная команда.\nНажмите <b>«❓ Понятная инструкция»</b> или напишите <code>/help</code>.`, { reply_markup: getMainKeyboard(chatId) });
}

// ==========================================
// VERCEL SERVERLESS HANDLER
// ==========================================

module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-telegram-bot-api-secret-token');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method === 'GET') {
        const query = req.query || {};
        const urlObj = req.url ? new URL(req.url, 'http://localhost') : null;
        const setupParam = query.setup || query.action || (urlObj ? urlObj.searchParams.get('setup') || urlObj.searchParams.get('action') : null);

        if (setupParam === '1' || setupParam === 'setWebhook') {
            if (!getBotToken()) {
                return res.status(500).json({
                    ok: false,
                    error: 'TELEGRAM_BOT_TOKEN не задан в переменных окружения Vercel'
                });
            }
            try {
                const webhookUrl = `${WEBAPP_URL}/api/bot`;
                const payload = { url: webhookUrl };
                if (process.env.TELEGRAM_SECRET_TOKEN) {
                    payload.secret_token = process.env.TELEGRAM_SECRET_TOKEN;
                }
                const setRes = await apiCall('setWebhook', payload);
                const me = await apiCall('getMe').catch(() => ({}));
                return res.status(200).json({
                    ok: true,
                    message: '✅ Webhook успешно привязан к Vercel!',
                    bot: me.username ? `@${me.username}` : undefined,
                    webhook_url: webhookUrl,
                    telegram_response: setRes
                });
            } catch (err) {
                return res.status(500).json({
                    ok: false,
                    error: `Ошибка привязки Webhook: ${err.message}`
                });
            }
        }

        return res.status(200).json({
            status: 'ok',
            service: 'GradeMaster Telegram Webhook',
            time: new Date().toISOString()
        });
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    // Проверка секретного токена вебхука Telegram (если задан)
    const secretToken = process.env.TELEGRAM_SECRET_TOKEN;
    if (secretToken) {
        const headerToken = req.headers['x-telegram-bot-api-secret-token'];
        if (headerToken !== secretToken) {
            console.warn('Unauthorized webhook request: secret token mismatch');
            return res.status(401).json({ error: 'Unauthorized' });
        }
    }

    try {
        const update = req.body;
        if (update) {
            if (update.message) {
                await handleMessage(update.message);
            } else if (update.callback_query) {
                await handleCallbackQuery(update.callback_query);
            }
        }
        return res.status(200).json({ ok: true });
    } catch (error) {
        console.error('Webhook processing error:', error);
        return res.status(200).json({ ok: false, error: error.message });
    }
};

module.exports.percentageToGradeInfo = percentageToGradeInfo;
module.exports.calculateGradeReport = calculateGradeReport;
module.exports.calculateGPAReport = calculateGPAReport;
module.exports.calculateCumulativeGPAReport = calculateCumulativeGPAReport;
module.exports.calculateAttendanceReport = calculateAttendanceReport;
module.exports.convertGradeReport = convertGradeReport;
module.exports.isAdmin = isAdmin;
module.exports.getMainKeyboard = getMainKeyboard;
module.exports.getFoolproofHelpText = getFoolproofHelpText;
module.exports.statsEngine = statsEngine;
module.exports.anonymizeUserId = statsEngine.anonymizeUserId;
module.exports.getCookieGuideText = getCookieGuideText;
module.exports.getLmsSessionKeyboard = getLmsSessionKeyboard;
module.exports.getLearnSessionKeyboard = getLearnSessionKeyboard;
module.exports.parseNaturalLanguageAcademicQuery = parseNaturalLanguageAcademicQuery;
module.exports.checkRateLimit = checkRateLimit;
module.exports.recordRateLimit = recordRateLimit;
module.exports._userRateLimits = userRateLimits;
module.exports._userCourseListMemory = userCourseListMemory;
module.exports.extractLmsCalendarOrCookie = extractLmsCalendarOrCookie;
module.exports.extractLearnSessionId = extractLearnSessionId;
module.exports.executeSetLms = executeSetLms;
module.exports.executeSetLearnCookie = executeSetLearnCookie;

// ==========================================
// ЛОКАЛЬНЫЙ LONG-POLLING (ДЛЯ РАЗРАБОТКИ)
// ==========================================
if (require.main === module) {
    let offset = 0;
    async function poll() {
        console.log(`🤖 GradeMaster Telegram Bot запущен в режиме Long-Polling...`);
        while (true) {
            try {
                const updates = await apiCall('getUpdates', { offset, timeout: 30 });
                for (const update of updates) {
                    offset = update.update_id + 1;
                    if (update.message) {
                        await handleMessage(update.message).catch(console.error);
                    } else if (update.callback_query) {
                        await handleCallbackQuery(update.callback_query).catch(console.error);
                    }
                }
            } catch (err) {
                console.error('Polling error:', err.message);
                await new Promise(r => setTimeout(r, 4000));
            }
        }
    }
    poll();
}

