// bot/bot.js
// Telegram-бот GradeMaster & Reply Bot

const config = require('./config');

const API_BASE = `https://api.telegram.org/bot${config.BOT_TOKEN}`;

// Хранилище сообщений для функции «Ответ на обращение» (Reply)
// messageIdInAdminChat -> targetUserId
const messageMap = new Map();

// Helper для вызова Telegram API
async function apiCall(method, payload = {}) {
    const response = await fetch(`${API_BASE}/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });
    const data = await response.json();
    if (!data.ok) {
        throw new Error(`Telegram API [${method}] Error: ${data.description || 'Unknown error'}`);
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
            [{ text: '📱 Открыть GradeMaster', web_app: { url: config.WEBAPP_URL } }],
            [{ text: '🚀 Расчёт оценки' }, [{ text: '📋 Посещаемость' }]],
            [{ text: 'ℹ️ Помощь' }, { text: '🆔 Мой Chat ID' }]
        ].flat(1).reduce((rows, key, idx) => {
            if (idx === 0) rows.push([key]);
            else if (idx === 1) rows.push([key, { text: '📋 Посещаемость' }]);
            else if (idx === 3) rows.push([key, { text: '🆔 Мой Chat ID' }]);
            return rows;
        }, []),
        resize_keyboard: true
    };
}

// ==========================================
// ЛОГИКА КАЛЬКУЛЯТОРОВ
// ==========================================

// Расчет итоговой оценки и прогноза
function calculateGrade(regmid, regend, finalGrade = null) {
    regmid = parseFloat(regmid);
    regend = parseFloat(regend);

    if (isNaN(regmid) || isNaN(regend) || regmid < 0 || regmid > 100 || regend < 0 || regend > 100) {
        return '❌ <b>Ошибка:</b> Оценки должны быть числами от 0 до 100.\n<i>Пример:</i> <code>/calc 80 85</code> или <code>/calc 80 85 90</code>';
    }

    if (regmid < 25) {
        return '❌ <b>Летник без вариантов!</b>\nРегМид меньше 25 баллов (критический порог). Курс не может быть сдан.';
    }
    if (regend < 25) {
        return '❌ <b>Летник без вариантов!</b>\nРегЭнд меньше 25 баллов (критический порог). Курс не может быть сдан.';
    }

    const regterm = (regmid + regend) / 2;

    if (regterm < 50) {
        return `❌ <b>Летник!</b>\nРегТерм = <b>${regterm.toFixed(2)}</b> (меньше 50 баллов). Допуск к файналу не получен.`;
    }

    // Если файнал указан
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

    // Режим прогноза на файнал
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

// Расчет посещаемости
function calculateAttendance(lessonsPerWeek) {
    const lessons = parseFloat(lessonsPerWeek);
    if (isNaN(lessons) || lessons < 1 || lessons > 20 || !Number.isInteger(lessons)) {
        return '❌ <b>Ошибка:</b> Введите целое число пар в неделю от 1 до 20.\n<i>Пример:</i> <code>/att 3</code>';
    }

    const totalLessons = lessons * config.ATTENDANCE_WEEKS;
    const allowedAbsences = Math.floor(totalLessons * config.ATTENDANCE_LIMIT_PERCENT);
    const percent = Math.round(config.ATTENDANCE_LIMIT_PERCENT * 100);

    return `📋 <b>Расчёт посещаемости (${config.ATTENDANCE_WEEKS} недель):</b>\n\n` +
        `• Пар в неделю: <b>${lessons}</b>\n` +
        `• Всего пар за триместр: <b>${totalLessons}</b>\n` +
        `• Порог допустимых пропусков: <b>${percent}%</b>\n\n` +
        `🚪 <b>Можно пропустить максимум: ${allowedAbsences} пар</b>\n\n` +
        `⚠️ <i>Примечание: При превышении ${allowedAbsences} пропусков студент не допускается к экзамену.</i>`;
}

// ==========================================
// ОБРАБОТКА КОМАНД И СООБЩЕНИЙ
// ==========================================

async function handleMessage(msg) {
    if (!msg || !msg.text) return;

    const chatId = msg.chat.id;
    const text = msg.text.trim();
    const userId = msg.from.id;
    const userName = msg.from.username ? `@${msg.from.username}` : `${msg.from.first_name || ''} ${msg.from.last_name || ''}`.trim();

    // 1. Команда /start
    if (text === '/start' || text.startsWith('/start ')) {
        const welcome = `👋 <b>Добро пожаловать в бота GradeMaster!</b>\n\n` +
            `Я помогу вам быстро рассчитать оценки, составить прогноз на файнал, проверить пропуски и связаться с поддержкой.\n\n` +
            `<b>Быстрые команды:</b>\n` +
            `• <code>/calc 80 85</code> — прогноз на файнал\n` +
            `• <code>/calc 80 85 90</code> — точный итоговый балл\n` +
            `• <code>/att 3</code> — допустимые пропуски (3 пары в неделю)\n` +
            `• <code>/id</code> — узнать свой Chat ID\n` +
            `• <code>/help</code> — подробная справка\n\n` +
            `📱 Нажмите <b>«Открыть GradeMaster»</b> для полного веб-калькулятора.`;
        return sendMessage(chatId, welcome, { reply_markup: getMainKeyboard() });
    }

    // 2. Команда /id
    if (text === '/id' || text === '🆔 Мой Chat ID') {
        return sendMessage(chatId, `🆔 Ваш Chat ID: <code>${chatId}</code>\n👤 Пользователь: <b>${esc(userName)}</b>`);
    }

    // 3. Команда /help
    if (text === '/help' || text === 'ℹ️ Помощь') {
        const helpText = `📚 <b>Справка по командам GradeMaster Bot:</b>\n\n` +
            `<b>1. Расчёт итоговой оценки и прогноз:</b>\n` +
            `<code>/calc &lt;РегМид&gt; &lt;РегЭнд&gt;</code>\n` +
            `<i>Пример:</i> <code>/calc 75 80</code> — посчитает РегТерм и покажет, сколько нужно набрать на файнале для сдачи, обычной и повышенной стипендии.\n\n` +
            `<code>/calc &lt;РегМид&gt; &lt;РегЭнд&gt; &lt;Файнал&gt;</code>\n` +
            `<i>Пример:</i> <code>/calc 75 80 85</code> — посчитает точный итоговый балл с вердиктом.\n\n` +
            `<b>2. Калькулятор посещаемости:</b>\n` +
            `<code>/att &lt;пар в неделю&gt;</code>\n` +
            `<i>Пример:</i> <code>/att 4</code> — покажет лимит пропусков на 10 недель.\n\n` +
            `<b>3. Ответ на обращение (для администратора):</b>\n` +
            `• Сделайте <b>Reply (Ответить)</b> на сообщение от бота с обращением студента.\n` +
            `• Или используйте: <code>/reply &lt;chat_id&gt; &lt;текст&gt;</code>\n\n` +
            `🌐 Веб-версия: ${config.WEBAPP_URL}`;
        return sendMessage(chatId, helpText, { reply_markup: getMainKeyboard() });
    }

    // 4. Кнопки меню
    if (text === '🚀 Расчёт оценки') {
        return sendMessage(chatId, `🚀 <b>Калькулятор оценки:</b>\n\nОтправьте команду:\n<code>/calc РегМид РегЭнд</code> (для прогноза)\nили\n<code>/calc РегМид РегЭнд Файнал</code> (для итоговой оценки)\n\n<i>Пример:</i> <code>/calc 80 85</code>`);
    }

    if (text === '📋 Посещаемость') {
        return sendMessage(chatId, `📋 <b>Калькулятор посещаемости:</b>\n\nОтправьте команду:\n<code>/att количество_пар_в_неделю</code>\n\n<i>Пример:</i> <code>/att 3</code>`);
    }

    // 5. Команда /calc
    if (text.startsWith('/calc')) {
        const parts = text.split(/\s+/).slice(1);
        if (parts.length < 2) {
            return sendMessage(chatId, '❌ <b>Недостаточно данных.</b>\nИспользуйте: <code>/calc РегМид РегЭнд [Файнал]</code>\n<i>Пример:</i> <code>/calc 80 85</code>');
        }
        const result = calculateGrade(parts[0], parts[1], parts[2] || null);
        return sendMessage(chatId, result);
    }

    // 6. Команда /att
    if (text.startsWith('/att')) {
        const parts = text.split(/\s+/).slice(1);
        if (parts.length < 1) {
            return sendMessage(chatId, '❌ <b>Укажите количество пар в неделю.</b>\n<i>Пример:</i> <code>/att 3</code>');
        }
        const result = calculateAttendance(parts[0]);
        return sendMessage(chatId, result);
    }

    // 7. Функция «Ответ на обращение» (команда /reply <chat_id> <текст>)
    if (text.startsWith('/reply')) {
        const parts = text.split(/\s+/);
        if (parts.length < 3) {
            return sendMessage(chatId, '❌ <b>Формат команды:</b> <code>/reply &lt;chat_id&gt; &lt;текст ответа&gt;</code>');
        }
        const targetChatId = parts[1];
        const replyText = parts.slice(2).join(' ');

        try {
            await sendMessage(targetChatId, `💬 <b>Ответ от администратора GradeMaster:</b>\n\n${esc(replyText)}\n\n<i>Если у вас остались вопросы, ответьте на это сообщение.</i>`);
            return sendMessage(chatId, `✅ <b>Ответ успешно доставлен</b> пользователю <code>${targetChatId}</code>!`);
        } catch (err) {
            return sendMessage(chatId, `❌ <b>Ошибка отправки ответа:</b> ${esc(err.message)}`);
        }
    }

    // 8. Ответ на обращение через прямой Reply на сообщение в чате админа
    if (msg.reply_to_message) {
        const repliedMsgId = msg.reply_to_message.message_id;
        const targetUserId = messageMap.get(repliedMsgId);

        if (targetUserId) {
            try {
                await sendMessage(targetUserId, `💬 <b>Ответ от администратора GradeMaster:</b>\n\n${esc(text)}\n\n<i>Вы можете написать в ответ, чтобы продолжить диалог.</i>`);
                return sendMessage(chatId, `✅ <b>Ответ отправлен пользователю <code>${targetUserId}</code>!</b>`);
            } catch (err) {
                return sendMessage(chatId, `❌ Не удалось отправить ответ: ${esc(err.message)}`);
            }
        }
    }

    // 9. Обработка входящего обращения от обычного пользователя боту
    // Если боту пишет студент напрямую — пересылаем админу с возможностью Reply
    if (config.ADMIN_CHAT_ID && String(chatId) !== String(config.ADMIN_CHAT_ID)) {
        try {
            const adminNotify = `📨 <b>Новое прямое сообщение в бот:</b>\n\n` +
                `👤 <b>От:</b> ${esc(userName)} (ID: <code>${chatId}</code>)\n` +
                `💬 <b>Текст:</b>\n${esc(text)}\n\n` +
                `<i>💡 Чтобы ответить студенту, просто сделайте Reply на это сообщение или напишите:</i>\n<code>/reply ${chatId} Ваш ответ</code>`;

            const sentMsg = await sendMessage(config.ADMIN_CHAT_ID, adminNotify);
            if (sentMsg && sentMsg.message_id) {
                messageMap.set(sentMsg.message_id, chatId);
            }

            return sendMessage(chatId, `✅ <b>Ваше сообщение принято и передано администратору!</b>\nМы ответим вам прямо в этот чат.`);
        } catch (e) {
            console.error('Failed to notify admin:', e);
        }
    }

    // Ответ по умолчанию
    return sendMessage(chatId, `❓ Неизвестная команда. Напишите <code>/help</code> или <code>/calc 80 85</code> для расчёта.`, { reply_markup: getMainKeyboard() });
}

// ==========================================
// ДВИЖОК LONG-POLLING
// ==========================================

let offset = 0;
let isRunning = true;

async function pollUpdates() {
    console.log(`🤖 GradeMaster Telegram Bot запущен (@Reply_1423bot)...`);

    while (isRunning) {
        try {
            const updates = await apiCall('getUpdates', {
                offset,
                timeout: 30,
                allowed_updates: ['message', 'callback_query']
            });

            for (const update of updates) {
                offset = update.update_id + 1;
                if (update.message) {
                    await handleMessage(update.message).catch(err => {
                        console.error('Error handling message:', err);
                    });
                }
            }
        } catch (error) {
            if (error.message && error.message.includes('Conflict: terminated by other getUpdates request')) {
                console.error('Polling conflict: другой процесс бота уже запущен. Ожидание 10 секунд...');
                await new Promise(r => setTimeout(r, 10000));
            } else {
                console.error('Polling error:', error.message);
                await new Promise(r => setTimeout(r, 3000));
            }
        }
    }
}

// Грамотное завершение при CTRL+C
process.on('SIGINT', () => {
    console.log('\nОстановка бота...');
    isRunning = false;
    process.exit(0);
});

process.on('SIGTERM', () => {
    isRunning = false;
    process.exit(0);
});

// Запуск бота
pollUpdates();

