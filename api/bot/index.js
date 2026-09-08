// api/bot/index.js
// Универсальный Telegram-бот GradeMaster (@Reply_1423bot)
// Работает и как Vercel Serverless Webhook (/api/bot), и как локальный Long-Polling скрипт

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '8865588303:AAEmEiM59TPvgrEH9CBJ6ojD9lIf9uF2SVI';
const ADMIN_CHAT_ID = process.env.TELEGRAM_CHAT_ID || '';
const WEBAPP_URL = process.env.WEBAPP_URL || 'https://calculator-not-404.vercel.app';
const API_BASE = `https://api.telegram.org/bot${BOT_TOKEN}`;

const ATTENDANCE_WEEKS = 10;
const ATTENDANCE_LIMIT_PERCENT = 0.30;

// Helper для вызова Telegram API
async function apiCall(method, payload = {}) {
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

// Отправка текстового сообщения
async function sendMessage(chatId, text, options = {}) {
    return apiCall('sendMessage', {
        chat_id: chatId,
        text,
        parse_mode: 'HTML',
        ...options
    });
}

// Экранирование HTML
function esc(str) {
    return String(str ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

// Главная клавиатура
function getMainKeyboard() {
    return {
        keyboard: [
            [{ text: '📱 Открыть GradeMaster', web_app: { url: WEBAPP_URL } }],
            [{ text: '🚀 Расчёт оценки' }, { text: '📋 Посещаемость' }],
            [{ text: 'ℹ️ Помощь' }, { text: '🆔 Мой Chat ID' }]
        ],
        resize_keyboard: true
    };
}

// ==========================================
// ЛОГИКА КАЛЬКУЛЯТОРОВ
// ==========================================

function calculateGrade(regmid, regend, finalGrade = null) {
    regmid = parseFloat(regmid);
    regend = parseFloat(regend);

    if (isNaN(regmid) || isNaN(regend) || regmid < 0 || regmid > 100 || regend < 0 || regend > 100) {
        return '❌ <b>Ошибка:</b> Оценки должны быть числами от 0 до 100.\n<i>Пример:</i> <code>/calc 80 85</code> или <code>/calc 80 85 90</code>';
    }

    if (regmid < 25) {
        return '❌ <b>Летник без вариантов!</b>\nРегМид меньше 25 баллов (порог). Курс не может быть сдан.';
    }
    if (regend < 25) {
        return '❌ <b>Летник без вариантов!</b>\nРегЭнд меньше 25 баллов (порог). Курс не может быть сдан.';
    }

    const regterm = (regmid + regend) / 2;

    if (regterm < 50) {
        return `❌ <b>Летник!</b>\nРегТерм = <b>${regterm.toFixed(2)}</b> (меньше 50 баллов). Допуск к экзамену не получен.`;
    }

    if (finalGrade !== null && !isNaN(parseFloat(finalGrade))) {
        const finalVal = parseFloat(finalGrade);
        if (finalVal < 0 || finalVal > 100) {
            return '❌ <b>Ошибка:</b> Оценка за файнал должна быть от 0 до 100.';
        }

        const total = (regterm * 0.6) + (finalVal * 0.4);

        if (finalVal < 25) {
            return `❌ <b>Летник!</b>\nФайнал меньше 25 баллов.\nРегТерм: <b>${regterm.toFixed(2)}</b> | Итог: <b>${total.toFixed(2)}</b>`;
        }
        if (finalVal >= 25 && finalVal < 50) {
            return `⚠️ <b>Пересдача (Retake)!</b>\nФайнал в диапазоне 25–49 баллов.\nРегТерм: <b>${regterm.toFixed(2)}</b> | Итог: <b>${total.toFixed(2)}</b>`;
        }
        if (total < 50) {
            return `❌ <b>Летник!</b> Итоговый балл ниже 50.\nРегТерм: <b>${regterm.toFixed(2)}</b> | Итог: <b>${total.toFixed(2)}</b>`;
        }
        if (total >= 90) {
            return `💎 <b>Превосходно! Повышенная стипендия!</b>\nРегТерм: <b>${regterm.toFixed(2)}</b> | Файнал: <b>${finalVal}</b>\nИтоговый балл: <b>${total.toFixed(2)}</b>`;
        }
        if (total >= 70) {
            return `✅ <b>Успех! Обычная стипендия!</b>\nРегТерм: <b>${regterm.toFixed(2)}</b> | Файнал: <b>${finalVal}</b>\nИтоговый балл: <b>${total.toFixed(2)}</b>`;
        }
        return `⚠️ <b>Курс сдан (без стипендии)</b>\nРегТерм: <b>${regterm.toFixed(2)}</b> | Файнал: <b>${finalVal}</b>\nИтоговый балл: <b>${total.toFixed(2)}</b>`;
    }

    // Прогноз на файнал
    const minPass = Math.max(50, Math.ceil((50 - (regterm * 0.6)) / 0.4));
    const minRegular = Math.ceil((70 - (regterm * 0.6)) / 0.4);
    const minHigh = Math.ceil((90 - (regterm * 0.6)) / 0.4);

    let report = `🔮 <b>Прогноз баллов на файнал:</b>\n`;
    report += `📊 РегТерм: <b>${regterm.toFixed(2)}</b> (РегМид: ${regmid}, РегЭнд: ${regend})\n\n`;

    if (minPass > 100) {
        report += `❌ <b>Для сдачи курса:</b> Невозможно (нужно > 100 баллов на экзамене).\n`;
    } else {
        report += `📝 <b>Для сдачи курса:</b> минимум <b>${Math.max(50, minPass)}</b> баллов\n`;
    }

    if (minRegular > 100) {
        report += `⚠️ <b>Обычная стипендия (70+):</b> Невозможна при текущем РегТерме.\n`;
    } else if (minRegular <= 50) {
        report += `✅ <b>Обычная стипендия (70+):</b> гарантирована при сдаче экзамена (от 50 баллов)!\n`;
    } else {
        report += `✅ <b>Обычная стипендия (70+):</b> минимум <b>${minRegular}</b> баллов\n`;
    }

    if (minHigh > 100) {
        report += `⚠️ <b>Повышенная стипендия (90+):</b> Невозможна.\n`;
    } else if (minHigh <= 50) {
        report += `💎 <b>Повышенная стипендия (90+):</b> гарантирована при сдаче экзамена!\n`;
    } else {
        report += `💎 <b>Повышенная стипендия (90+):</b> минимум <b>${minHigh}</b> баллов\n`;
    }

    return report;
}

function calculateAttendance(lessonsPerWeek) {
    const lessons = parseFloat(lessonsPerWeek);
    if (isNaN(lessons) || lessons < 1 || lessons > 20 || !Number.isInteger(lessons)) {
        return '❌ <b>Ошибка:</b> Введите целое число пар в неделю от 1 до 20.\n<i>Пример:</i> <code>/att 3</code>';
    }

    const totalLessons = lessons * ATTENDANCE_WEEKS;
    const allowedAbsences = Math.floor(totalLessons * ATTENDANCE_LIMIT_PERCENT);
    const percent = Math.round(ATTENDANCE_LIMIT_PERCENT * 100);

    return `📋 <b>Расчёт посещаемости (${ATTENDANCE_WEEKS} недель):</b>\n\n` +
        `• Пар в неделю: <b>${lessons}</b>\n` +
        `• Всего пар за триместр: <b>${totalLessons}</b>\n` +
        `• Порог допустимых пропусков: <b>${percent}%</b>\n\n` +
        `🚪 <b>Можно пропустить максимум: ${allowedAbsences} пар</b>\n\n` +
        `⚠️ <i>Примечание: При превышении ${allowedAbsences} пропусков студент не допускается к экзамену.</i>`;
}

// ==========================================
// ОБРАБОТКА ВХОДЯЩИХ СООБЩЕНИЙ
// ==========================================

async function handleMessage(msg) {
    if (!msg || !msg.text) return;

    const chatId = msg.chat.id;
    const text = msg.text.trim();
    const userName = msg.from.username ? `@${msg.from.username}` : `${msg.from.first_name || ''} ${msg.from.last_name || ''}`.trim();

    // 1. /start
    if (text === '/start' || text.startsWith('/start ')) {
        const welcome = `👋 <b>Добро пожаловать в бота GradeMaster!</b>\n\n` +
            `Я помогу вам рассчитать оценки, составить прогноз на файнал, проверить допустимые пропуски и связаться с поддержкой.\n\n` +
            `<b>Быстрые команды:</b>\n` +
            `• <code>/calc 80 85</code> — прогноз баллов на файнал\n` +
            `• <code>/calc 80 85 90</code> — точный итоговый балл\n` +
            `• <code>/att 3</code> — допустимые пропуски (3 пары в неделю)\n` +
            `• <code>/id</code> — узнать свой Chat ID\n` +
            `• <code>/help</code> — полная справка\n\n` +
            `📱 Нажмите <b>«Открыть GradeMaster»</b> для запуска калькулятора прямо в Telegram.`;
        return sendMessage(chatId, welcome, { reply_markup: getMainKeyboard() });
    }

    // 2. /id
    if (text === '/id' || text === '🆔 Мой Chat ID') {
        return sendMessage(chatId, `🆔 Ваш Chat ID: <code>${chatId}</code>\n👤 Пользователь: <b>${esc(userName)}</b>`);
    }

    // 3. /help
    if (text === '/help' || text === 'ℹ️ Помощь') {
        const helpText = `📚 <b>Справка по командам GradeMaster:</b>\n\n` +
            `<b>1. Расчёт и прогноз:</b>\n` +
            `<code>/calc &lt;РегМид&gt; &lt;РегЭнд&gt;</code>\n` +
            `<i>Пример:</i> <code>/calc 75 80</code> — прогноз на файнал.\n\n` +
            `<code>/calc &lt;РегМид&gt; &lt;РегЭнд&gt; &lt;Файнал&gt;</code>\n` +
            `<i>Пример:</i> <code>/calc 75 80 85</code> — итоговый балл с вердиктом.\n\n` +
            `<b>2. Посещаемость:</b>\n` +
            `<code>/att &lt;пар в неделю&gt;</code>\n` +
            `<i>Пример:</i> <code>/att 3</code> — лимит пропусков на 10 недель.\n\n` +
            `<b>3. Ответ на обращение студента (для админа):</b>\n` +
            `<code>/reply &lt;chat_id&gt; &lt;текст&gt;</code>\n` +
            `<i>Пример:</i> <code>/reply 123456789 Ваш вопрос решен!</code>\n\n` +
            `🌐 Веб-сайт: ${WEBAPP_URL}`;
        return sendMessage(chatId, helpText, { reply_markup: getMainKeyboard() });
    }

    // 4. Меню
    if (text === '🚀 Расчёт оценки') {
        return sendMessage(chatId, `🚀 <b>Калькулятор оценки:</b>\n\nОтправьте команду:\n<code>/calc 80 85</code> (для прогноза)\nили\n<code>/calc 80 85 90</code> (для точного расчёта)`);
    }

    if (text === '📋 Посещаемость') {
        return sendMessage(chatId, `📋 <b>Калькулятор посещаемости:</b>\n\nОтправьте команду:\n<code>/att 3</code> (где 3 — количество пар в неделю)`);
    }

    // 5. /calc
    if (text.startsWith('/calc')) {
        const parts = text.split(/\s+/).slice(1);
        if (parts.length < 2) {
            return sendMessage(chatId, '❌ <b>Недостаточно данных.</b>\nИспользуйте: <code>/calc РегМид РегЭнд [Файнал]</code>\n<i>Пример:</i> <code>/calc 80 85</code>');
        }
        const result = calculateGrade(parts[0], parts[1], parts[2] || null);
        return sendMessage(chatId, result);
    }

    // 6. /att
    if (text.startsWith('/att')) {
        const parts = text.split(/\s+/).slice(1);
        if (parts.length < 1) {
            return sendMessage(chatId, '❌ <b>Укажите количество пар в неделю.</b>\n<i>Пример:</i> <code>/att 3</code>');
        }
        const result = calculateAttendance(parts[0]);
        return sendMessage(chatId, result);
    }

    // 7. /reply <chat_id> <текст>
    if (text.startsWith('/reply')) {
        const parts = text.split(/\s+/);
        if (parts.length < 3) {
            return sendMessage(chatId, '❌ <b>Формат команды:</b> <code>/reply &lt;chat_id&gt; &lt;текст ответа&gt;</code>');
        }
        const targetChatId = parts[1];
        const replyText = parts.slice(2).join(' ');

        try {
            await sendMessage(targetChatId, `💬 <b>Ответ от администратора GradeMaster:</b>\n\n${esc(replyText)}\n\n<i>Вы можете написать в ответ, чтобы продолжить диалог.</i>`);
            return sendMessage(chatId, `✅ <b>Ответ успешно отправлен пользователю</b> <code>${targetChatId}</code>!`);
        } catch (err) {
            return sendMessage(chatId, `❌ <b>Ошибка отправки:</b> ${esc(err.message)}`);
        }
    }

    // 8. Пересылка входящих сообщений администратору
    if (ADMIN_CHAT_ID && String(chatId) !== String(ADMIN_CHAT_ID)) {
        try {
            const adminNotify = `📨 <b>Новое обращение от студента в бот:</b>\n\n` +
                `👤 <b>От:</b> ${esc(userName)} (ID: <code>${chatId}</code>)\n` +
                `💬 <b>Текст:</b>\n${esc(text)}\n\n` +
                `<i>💡 Чтобы ответить студенту, отправьте:</i>\n<code>/reply ${chatId} Ваш ответ</code>`;
            await sendMessage(ADMIN_CHAT_ID, adminNotify);
            return sendMessage(chatId, `✅ <b>Ваше сообщение получено и передано администратору!</b>\nМы скоро ответим вам.`);
        } catch (e) {
            console.error('Failed to forward message to admin:', e);
        }
    }

    return sendMessage(chatId, `❓ Неизвестная команда. Напишите <code>/help</code> или <code>/calc 80 85</code> для расчёта.`, { reply_markup: getMainKeyboard() });
}

// ==========================================
// VERCEL SERVERLESS HANDLER
// ==========================================

module.exports = async function handler(req, res) {
    // Разрешаем CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method === 'GET') {
        return res.status(200).json({
            status: 'ok',
            bot: '@Reply_1423bot',
            service: 'GradeMaster Telegram Webhook',
            time: new Date().toISOString()
        });
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const update = req.body;
        if (update && update.message) {
            await handleMessage(update.message);
        }
        return res.status(200).json({ ok: true });
    } catch (error) {
        console.error('Webhook error:', error);
        return res.status(200).json({ ok: false, error: error.message });
    }
};

// ==========================================
// ЛОКАЛЬНЫЙ LONG-POLLING (если запуск через node index.js)
// ==========================================
if (require.main === module) {
    let offset = 0;
    async function poll() {
        console.log(`🤖 GradeMaster Telegram Bot запущен в режиме Long-Polling (@Reply_1423bot)...`);
        while (true) {
            try {
                const updates = await apiCall('getUpdates', { offset, timeout: 30 });
                for (const update of updates) {
                    offset = update.update_id + 1;
                    if (update.message) {
                        await handleMessage(update.message).catch(console.error);
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

