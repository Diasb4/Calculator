// api/bot/index.js
// Универсальный Telegram-бот GradeMaster (@aitugrademaster_bot)
// Полноценная замена веб-сайта GradeMaster прямо в Telegram.
// Работает и как Vercel Serverless Webhook (/api/bot), и как локальный Long-Polling скрипт.

const aitu = require('./aitu.js');
const BOT_TOKEN = (process.env.TELEGRAM_BOT_TOKEN || '').trim();
const ADMIN_CHAT_ID = (process.env.TELEGRAM_CHAT_ID || '').trim();
const WEBAPP_URL = process.env.WEBAPP_URL || 'https://calculator-not-404.vercel.app';
const API_BASE = `https://api.telegram.org/bot${BOT_TOKEN}`;

const ATTENDANCE_WEEKS = 10;
const ATTENDANCE_LIMIT_PERCENT = 0.30;

// Хранилище сессий пользователей (для пошаговых диалогов)
// В serverless сохраняется в памяти инстанса с TTL
const userSessions = new Map();
// Хранилище списка пользователей для рассылки админа
const activeUsers = new Set();
if (ADMIN_CHAT_ID) activeUsers.add(ADMIN_CHAT_ID);

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
    if (!BOT_TOKEN) {
        throw new Error('TELEGRAM_BOT_TOKEN environment variable is not configured');
    }
    const response = await fetch(`${API_BASE}/${method}`, {
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
    return Boolean(ADMIN_CHAT_ID && String(chatId).trim() === String(ADMIN_CHAT_ID).trim());
}

// ==========================================
// КЛАВИАТУРЫ И МЕНЮ
// ==========================================

function getMainKeyboard(chatId) {
    const isUserAdmin = isAdmin(chatId);
    const keyboard = [
        [{ text: '📝 Квизы AITU' }],
        [{ text: 'Итоговая оценка' }, { text: 'Калькулятор GPA' }],
        [{ text: 'Кумулятивный GPA' }, { text: 'Посещаемость' }],
        [{ text: 'Конвертер GPA' }, { text: 'Отзыв / Поддержка' }],
        [{ text: 'Инструкция' }, { text: 'Открыть сайт', web_app: { url: WEBAPP_URL } }]
    ];

    if (isUserAdmin) {
        keyboard.unshift([{ text: 'Панель Администратора' }]);
    }

    return {
        keyboard,
        resize_keyboard: true
    };
}

function getCancelKeyboard() {
    return {
        keyboard: [
            [{ text: 'Отмена / Главное меню' }]
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
function calculateGradeReport(regmid, regend, finalGrade = null) {
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

        return `🎯 <b>ИТОГОВЫЙ РАСЧЁТ ОЦЕНКИ:</b>\n\n` +
            `📊 <b>РегТерм (60%):</b> ${regterm.toFixed(2)} (РегМид: ${regmid}, РегЭнд: ${regend})\n` +
            `📝 <b>Файнал (40%):</b> ${finalVal}\n` +
            `🏆 <b>Итоговый балл:</b> <code>${total.toFixed(2)}</code> (${gradeInfo ? gradeInfo.letter + ', GPA ' + gradeInfo.gpa.toFixed(2) : ''})\n\n` +
            `${verdict}\n\n` +
            `<i>💡 Формула: (РегТерм × 0.6) + (Файнал × 0.4)</i>`;
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

    report += `\n<i>⚠️ Важно: на самом экзамене необходимо набрать не менее 50 баллов для сдачи без пересдачи.</i>`;
    return report;
}

// 2. Калькулятор GPA за семестр/триместр
function calculateGPAReport(inputStr) {
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
            return `❌ <b>Ошибка:</b> Оценка в предмете #${i + 1} должна быть от 0 до 100 (получено: ${grade}).`;
        }
        if (credits <= 0 || credits > 30) {
            return `❌ <b>Ошибка:</b> Кредиты в предмете #${i + 1} должны быть больше 0 (получено: ${credits}).`;
        }

        const qp = gradeInfo.gpa * credits;
        totalQualityPoints += qp;
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

    return msg;
}

// 3. Калькулятор кумулятивного GPA
function calculateCumulativeGPAReport(inputStr) {
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

    return msg;
}

// 4. Калькулятор посещаемости
function calculateAttendanceReport(lessonsPerWeek, alreadyMissed = 0) {
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

    return `📋 <b>РАСЧЁТ ПОСЕЩАЕМОСТИ (10 недель семестра):</b>\n\n` +
        `${statusHeader}\n\n` +
        `• Пар в неделю: <b>${lessons}</b>\n` +
        `• Всего занятий за семестр: <b>${totalLessons}</b>\n` +
        `• Порог недопуска (30%): <b>${allowedAbsences} пар максимум</b>\n` +
        `• Уже пропущено: <b>${missed} пар (${currentPercent.toFixed(1)}%)</b>\n\n` +
        `📊 <b>Шкала риска:</b>\n[${bar}]\n\n` +
        `🚪 <b>Осталось безопасных пропусков:</b> <b>${remaining >= 0 ? remaining : 0} пар</b>\n\n` +
        `<i>⚠️ Важно: При пропуске ${allowedAbsences + 1} пар и более студент автоматически отправляется на летник без права сдачи экзамена.</i>`;
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

// ==========================================
// ПОШАГОВЫЙ ИНСТРУКЦИОННЫЙ ГИД ("КАК ДЛЯ ДЕБИЛОВ")
// ==========================================

function getFoolproofHelpText() {
    return `📖 <b>ИНСТРУКЦИЯ ПО ИСПОЛЬЗОВАНИЮ БОТА:</b>\n\n` +
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
        `👉 <i>Как пользоваться:</i>\n` +
        `• Нажмите <b>«📋 Посещаемость»</b>.\n` +
        `• Отправьте: <code>/att 3</code> (3 пары в неделю) или <code>/att 3 2</code> (если 2 уже пропустили).\n\n` +
        `🔄 <b>5. Конвертер баллов в GPA</b>\n` +
        `Мгновенно переводит проценты (например 87) в букву B+ и балл 3.33.\n` +
        `👉 Отправьте: <code>/convert 87</code>\n\n` +
        `💬 <b>6. Поддержка и отзывы</b>\n` +
        `Нажмите <b>«💬 Отзыв / Поддержка»</b> и напишите любое сообщение — администратор получит его и ответит вам!`;
}

// ==========================================
// АДМИН-ПАНЕЛЬ (ТОЛЬКО ДЛЯ ADMIN_CHAT_ID)
// ==========================================

async function handleAdminPanel(chatId, messageId = null) {
    if (!isAdmin(chatId)) {
        return sendMessage(chatId, '❌ <b>Доступ запрещён.</b> Эта команда доступна только создателю бота.');
    }

    const hasBotToken = Boolean(BOT_TOKEN);
    const hasAdminId = Boolean(ADMIN_CHAT_ID);
    const hasSecret = Boolean(process.env.TELEGRAM_SECRET_TOKEN);

    const adminMsg = `⚙️ <b>ПАНЕЛЬ АДМИНИСТРАТОРА GRADEMASTER:</b>\n\n` +
        `👤 <b>Ваш Admin Chat ID:</b> <code>${chatId}</code>\n` +
        `🌐 <b>Web App URL:</b> ${WEBAPP_URL}\n` +
        `👥 <b>Активных пользователей в памяти:</b> ${activeUsers.size}\n\n` +
        `🔑 <b>Статус переменных окружения (Vercel):</b>\n` +
        `• <code>TELEGRAM_BOT_TOKEN</code>: ${hasBotToken ? '✅ Настроен' : '❌ Не задан'}\n` +
        `• <code>TELEGRAM_CHAT_ID</code>: ${hasAdminId ? '✅ Настроен' : '❌ Не задан'}\n` +
        `• <code>TELEGRAM_SECRET_TOKEN</code>: ${hasSecret ? '✅ Включен' : '⚪ Не включен (опционально)'}\n\n` +
        `🛠 <b>Команды управления:</b>\n` +
        `• <code>/reply &lt;chat_id&gt; &lt;текст&gt;</code> — ответить студенту\n` +
        `• <code>/broadcast &lt;текст&gt;</code> — разослать объявление всем пользователям\n` +
        `• <code>/status</code> — проверить соединение с Telegram API`;

    const inlineKeyboard = {
        inline_keyboard: [
            [
                { text: '🔄 Перепривязать Webhook в Vercel', callback_data: 'adm_setwebhook' },
                { text: '📡 Проверить Webhook Info', callback_data: 'adm_webhookinfo' }
            ],
            [
                { text: '👥 Список пользователей', callback_data: 'adm_users' },
                { text: '🏠 Главное меню', callback_data: 'adm_home' }
            ]
        ]
    };

    if (messageId) {
        return editMessageText(chatId, messageId, adminMsg, { reply_markup: inlineKeyboard });
    }
    return sendMessage(chatId, adminMsg, { reply_markup: inlineKeyboard });
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

        if (data === 'adm_users') {
            const list = Array.from(activeUsers).map(u => `• <code>${u}</code>`).join('\n') || 'Пока нет пользователей';
            return sendMessage(chatId, `👥 <b>Активные пользователи:</b>\n\n${list}`);
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
        return sendMessage(chatId, `📋 <b>Калькулятор посещаемости (Шаг 1 из 2):</b>\n\nСколько пар в неделю по предмету?\n<i>Введи число от 1 до 20 (например: <code>3</code>)</i>`, { reply_markup: getCancelKeyboard() });
    }

    if (data === 'wiz_conv') {
        session.step = 'conv_input';
        session.data = {};
        return sendMessage(chatId, `🔄 <b>Конвертер оценок в GPA:</b>\n\nВведи процентную оценку (число от 0 до 100).\n<i>Например:</i> <code>87</code>`, { reply_markup: getCancelKeyboard() });
    }

    if (data === 'wiz_feed') {
        session.step = 'feed_input';
        session.data = {};
        return sendMessage(chatId, `💬 <b>Служба поддержки и отзывов:</b>\n\nНапишите ваше предложение, вопрос или сообщение об ошибке. Администратор получит его и ответит вам!`, { reply_markup: getCancelKeyboard() });
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
// ОБРАБОТКА ВХОДЯЩИХ ТЕКСТОВЫХ СООБЩЕНИЙ
// ==========================================

async function handleMessage(msg) {
    if (!msg || !msg.text) return;

    const chatId = msg.chat.id;
    const text = msg.text.trim();
    const userName = msg.from.username ? `@${msg.from.username}` : `${msg.from.first_name || ''} ${msg.from.last_name || ''}`.trim();
    activeUsers.add(String(chatId));

    const session = getSession(chatId);

    // Обработка кнопки "Отмена / Главное меню"
    if (text === '❌ Отмена / Главное меню' || text === '/cancel') {
        clearSession(chatId);
        return sendMessage(chatId, '🏠 Действие отменено. Вы вернулись в главное меню.', { reply_markup: getMainKeyboard(chatId) });
    }

    // 1. /start
    if (text === '/start' || text.startsWith('/start ')) {
        clearSession(chatId);
        const welcome = `👋 <b>Добро пожаловать в GradeMaster Bot!</b> 🎓\n\n` +
            `Этот бот — ваша <b>полная замена сайту</b> для всех академических расчётов:\n\n` +
            `🚀 <b>Итоговая оценка</b> — расчет РегТерма и прогноз на стипендию (обычная/повышенная).\n` +
            `📊 <b>Калькулятор GPA</b> — средний балл за триместр с учетом кредитов.\n` +
            `📈 <b>Кумулятивный GPA</b> — общий балл за всё время учебы.\n` +
            `📋 <b>Посещаемость</b> — лимит 30% пропусков и расчет оставшихся пар.\n` +
            `🔄 <b>Конвертер баллов</b> — перевод % в буквенную оценку и GPA.\n` +
            `💬 <b>Поддержка</b> — прямая связь с администрацией.\n\n` +
            `👇 <i>Выберите нужный калькулятор на кнопках ниже:</i>`;

        return sendMessage(chatId, welcome, {
            reply_markup: getMainKeyboard(chatId)
        });
    }

    // 1.5. Квизы AITU (/quizzes, /aitu)
    if (text === '📝 Квизы AITU' || text === '/quizzes' || text === '/aitu' || text === 'Квизы AITU' || text === 'Квизы') {
        await sendMessage(chatId, '⏳ <i>Проверяю квизы и дедлайны на learn.astanait.edu.kz...</i>');
        const result = await aitu.getUpcomingQuizzes();
        const msgText = aitu.formatQuizzesMessage(result);
        return sendMessage(chatId, msgText, {
            reply_markup: getMainKeyboard(chatId),
            disable_web_page_preview: true
        });
    }

    // 1.6. /set_cookie <sessionid> (Обновление сессии AITU)
    if (text.startsWith('/set_cookie') || text.startsWith('/cookie')) {
        if (!isAdmin(chatId)) {
            return sendMessage(chatId, 'Доступ запрещен.');
        }
        const cookieVal = text.replace(/^\/(?:set_cookie|cookie)/, '').trim();
        if (!cookieVal) {
            return sendMessage(chatId, 'Отправьте значение sessionid:\n<code>/set_cookie ВАШ_SESSION_ID</code>');
        }
        let cleanSid = cookieVal;
        const match = cookieVal.match(/sessionid=([^;\s]+)/);
        if (match) cleanSid = match[1].trim();

        process.env.AITU_SESSION_ID = cleanSid;
        await sendMessage(chatId, '✅ <b>Cookie сохранен!</b> Проверяю подключение к learn.astanait.edu.kz...');
        const testRes = await aitu.getUpcomingQuizzes(cleanSid);
        if (testRes.ok) {
            return sendMessage(chatId, '🎉 <b>Успешно подключено к AITU!</b>\nНайдено дедлайнов: <b>' + testRes.quizzes.length + '</b>\n\n' + aitu.formatQuizzesMessage(testRes), {
                reply_markup: getMainKeyboard(chatId),
                disable_web_page_preview: true
            });
        } else {
            return sendMessage(chatId, '⚠️ Ошибка проверки сессии: ' + testRes.error + '\nУбедитесь, что sessionid скопирован корректно.', {
                reply_markup: getMainKeyboard(chatId)
            });
        }
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

    // 2. /help или "Инструкция"
    if (text === '/help' || text === 'Инструкция' || text === '❓ Понятная инструкция') {
        return sendMessage(chatId, getFoolproofHelpText(), {
            reply_markup: getCalculatorsInlineKeyboard()
        });
    }

    // 3. /admin или "Панель Администратора" (ТОЛЬКО ДЛЯ АДМИНА)
    if (text === '/admin' || text === 'Панель Администратора' || text === '⚙️ Панель Администратора') {
        if (!isAdmin(chatId)) {
            return sendMessage(chatId, 'Команда не найдена. Напишите <code>/help</code> для просмотра доступных функций.', { reply_markup: getMainKeyboard(chatId) });
        }
        return handleAdminPanel(chatId);
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
        return sendMessage(chatId, `<b>Служба поддержки и обратной связи:</b>\n\nНапишите ваше сообщение, вопрос или предложение. Администратор прочитает его и сможет ответить вам прямо здесь!`, { reply_markup: getCancelKeyboard() });
    }

    // 8. Обработка быстрых команд одной строкой (/calc, /gpa, /cgpa, /att, /convert)
    if (text.startsWith('/calc')) {
        const parts = text.split(/\s+/).slice(1);
        if (parts.length < 2) {
            return sendMessage(chatId, '❌ <b>Недостаточно данных.</b>\n<i>Формат:</i> <code>/calc РегМид РегЭнд [Файнал]</code>\n<i>Пример:</i> <code>/calc 80 85</code> или <code>/calc 80 85 90</code>');
        }
        const res = calculateGradeReport(parts[0], parts[1], parts[2]);
        return sendMessage(chatId, res, { reply_markup: getMainKeyboard(chatId) });
    }

    if (text.startsWith('/gpa')) {
        const raw = text.replace(/^\/gpa\s*/i, '');
        const res = calculateGPAReport(raw);
        return sendMessage(chatId, res, { reply_markup: getMainKeyboard(chatId) });
    }

    if (text.startsWith('/cgpa') || text.startsWith('/cumulative') || text.startsWith('/totalgpa') || text.startsWith('/cum')) {
        const raw = text.replace(/^(\/cgpa|\/cumulative|\/totalgpa|\/cum)\s*/i, '');
        const res = calculateCumulativeGPAReport(raw);
        return sendMessage(chatId, res, { reply_markup: getMainKeyboard(chatId) });
    }

    if (text.startsWith('/att')) {
        const parts = text.split(/\s+/).slice(1);
        if (parts.length === 0) {
            return sendMessage(chatId, '❌ <b>Укажите количество пар в неделю.</b>\n<i>Пример:</i> <code>/att 3</code> или <code>/att 3 2</code>');
        }
        const res = calculateAttendanceReport(parts[0], parts[1]);
        return sendMessage(chatId, res, { reply_markup: getMainKeyboard(chatId) });
    }

    if (text.startsWith('/convert') || text.startsWith('/conv')) {
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

        const forecast = calculateGradeReport(rm, re);
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

        const res = calculateGradeReport(rm, re, val);
        return sendMessage(chatId, res, { reply_markup: getMainKeyboard(chatId) });
    }

    if (session.step === 'gpa_input') {
        clearSession(chatId);
        const res = calculateGPAReport(text);
        return sendMessage(chatId, res, { reply_markup: getMainKeyboard(chatId) });
    }

    if (session.step === 'cgpa_input' || session.step === 'cum_input') {
        clearSession(chatId);
        const res = calculateCumulativeGPAReport(text);
        return sendMessage(chatId, res, { reply_markup: getMainKeyboard(chatId) });
    }

    if (session.step === 'att_lessons') {
        const lessons = parseFloat(text);
        if (isNaN(lessons) || lessons < 1 || lessons > 20 || !Number.isInteger(lessons)) {
            return sendMessage(chatId, '❌ Введи целое число от 1 до 20 (количество пар в неделю). Например: <code>3</code>');
        }
        session.data.lessons = lessons;
        session.step = 'att_missed';
        return sendMessage(chatId, `✅ <b>Пар в неделю: ${lessons}</b>\n\n<b>Шаг 2 из 2:</b> Сколько пар вы <b>уже пропустили</b>?\n<i>Если ещё не пропускали, введите <code>0</code>:</i>`);
    }

    if (session.step === 'att_missed') {
        const missed = parseFloat(text);
        if (isNaN(missed) || missed < 0 || !Number.isInteger(missed)) {
            return sendMessage(chatId, '❌ Введите целое неотрицательное число (например: <code>0</code> или <code>2</code>)');
        }
        const lessons = session.data.lessons;
        clearSession(chatId);

        const res = calculateAttendanceReport(lessons, missed);
        return sendMessage(chatId, res, { reply_markup: getMainKeyboard(chatId) });
    }

    if (session.step === 'conv_input') {
        clearSession(chatId);
        const res = convertGradeReport(text);
        return sendMessage(chatId, res, { reply_markup: getMainKeyboard(chatId) });
    }

    if (session.step === 'feed_input') {
        clearSession(chatId);
        if (ADMIN_CHAT_ID && String(chatId) !== String(ADMIN_CHAT_ID)) {
            try {
                const notify = `📨 <b>Новое обращение от студента:</b>\n\n` +
                    `👤 <b>От:</b> ${esc(userName)} (ID: <code>${chatId}</code>)\n` +
                    `💬 <b>Текст:</b>\n${esc(text)}\n\n` +
                    `<i>💡 Чтобы ответить студенту, отправьте:</i>\n<code>/reply ${chatId} Ваш ответ</code>`;
                await sendMessage(ADMIN_CHAT_ID, notify);
            } catch (e) {
                console.error('Failed to notify admin:', e);
            }
        }
        return sendMessage(chatId, `✅ <b>Спасибо! Ваше обращение передано администратору.</b>\nМы ответим вам в этом диалоге.`, { reply_markup: getMainKeyboard(chatId) });
    }

    // 10. Попытка автоматического распознавания чисел (если пользователь просто отправил числа)
    const numTokens = text.split(/[\s,]+/).filter(Boolean).map(Number);
    if (numTokens.length >= 2 && numTokens.every(n => !isNaN(n) && n >= 0 && n <= 100)) {
        if (numTokens.length === 2) {
            const res = calculateGradeReport(numTokens[0], numTokens[1]);
            return sendMessage(chatId, `💡 <i>Распознан расчёт РегМид = ${numTokens[0]}, РегЭнд = ${numTokens[1]}:</i>\n\n${res}`, { reply_markup: getMainKeyboard(chatId) });
        }
        if (numTokens.length === 3) {
            const res = calculateGradeReport(numTokens[0], numTokens[1], numTokens[2]);
            return sendMessage(chatId, `💡 <i>Распознан итоговый расчёт РегМид = ${numTokens[0]}, РегЭнд = ${numTokens[1]}, Файнал = ${numTokens[2]}:</i>\n\n${res}`, { reply_markup: getMainKeyboard(chatId) });
        }
    }

    // 11. Нераспознанное сообщение — пересылка админу как вопрос/отзыв
    if (ADMIN_CHAT_ID && String(chatId) !== String(ADMIN_CHAT_ID)) {
        try {
            const notify = `📨 <b>Сообщение от студента:</b>\n\n` +
                `👤 <b>От:</b> ${esc(userName)} (ID: <code>${chatId}</code>)\n` +
                `💬 <b>Текст:</b>\n${esc(text)}\n\n` +
                `<i>💡 Чтобы ответить:</i> <code>/reply ${chatId} Ваш ответ</code>`;
            await sendMessage(ADMIN_CHAT_ID, notify);
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
            if (!BOT_TOKEN) {
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

