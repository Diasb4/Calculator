// api/cron.js
// Vercel Cron handler для ежедневных и экстренных напоминаний о квизах AITU
// Поддерживает полностью изолированные персональные проверки для каждого студента

const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const aitu = require('./bot/aitu.js');
const lms = require('./bot/lms.js');
const statsEngine = require('./stats/engine.js');

function getBotToken() {
    return (process.env.TELEGRAM_BOT_TOKEN || '').trim();
}

function getAdminChatIds() {
    const raw = (process.env.ADMIN_CHAT_ID || process.env.TELEGRAM_CHAT_ID || '').trim();
    return raw ? raw.split(/[,\s;]+/).map(s => s.trim()).filter(Boolean) : [];
}

const sentAlertsMemory = new Set();

function getAlertsCacheFilePath() {
    try {
        return path.join(os.tmpdir(), 'gm_sent_alerts.json');
    } catch {
        return null;
    }
}

function readSentAlertsFile() {
    const p = getAlertsCacheFilePath();
    if (!p) return new Set();
    try {
        if (fs.existsSync(p)) {
            const arr = JSON.parse(fs.readFileSync(p, 'utf8'));
            return new Set(Array.isArray(arr) ? arr : []);
        }
    } catch {
        // Ignore file read errors
    }
    return new Set();
}

function writeSentAlertsFile(set) {
    const p = getAlertsCacheFilePath();
    if (!p) return;
    try {
        fs.writeFileSync(p, JSON.stringify(Array.from(set)), 'utf8');
    } catch {
        // Ignore file write errors
    }
}

async function hasAlertBeenSent(alertKey) {
    if (sentAlertsMemory.has(alertKey)) return true;

    const fileSet = readSentAlertsFile();
    if (fileSet.has(alertKey)) {
        sentAlertsMemory.add(alertKey);
        return true;
    }

    if (typeof statsEngine.kvCommand === 'function') {
        try {
            const res = await statsEngine.kvCommand(['GET', `gm:alert:${alertKey}`]);
            if (res) {
                sentAlertsMemory.add(alertKey);
                return true;
            }
        } catch {
            // Ignore Redis read errors
        }
    }

    return false;
}

async function markAlertAsSent(alertKey) {
    sentAlertsMemory.add(alertKey);

    const fileSet = readSentAlertsFile();
    fileSet.add(alertKey);
    writeSentAlertsFile(fileSet);

    if (typeof statsEngine.kvCommand === 'function') {
        try {
            // Храним отметку об отправке 3 дня (259200 сек)
            await statsEngine.kvCommand(['SET', `gm:alert:${alertKey}`, '1', 'EX', 259200]);
        } catch {
            // Ignore Redis write errors
        }
    }
}

function clearSentAlertsMemory() {
    sentAlertsMemory.clear();
    const p = getAlertsCacheFilePath();
    if (p && fs.existsSync(p)) {
        try {
            fs.unlinkSync(p);
        } catch {}
    }
}

async function sendTelegram(chatId, text, options = {}) {
    const token = getBotToken();
    if (!token || !chatId) return;
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            chat_id: chatId,
            text,
            parse_mode: 'HTML',
            disable_web_page_preview: true,
            ...options
        })
    });
    return res.json();
}

/**
 * Проверка и отправка уведомлений для одного конкретного студента
 */
async function processUserQuizzes(chatId, context) {
    const { isMorningWindow, forceSend, todayStr, adminChatIds } = context;
    const strChatId = String(chatId).trim();
    let criticalSent = 0;
    let dailySent = 0;

    const isGauharUser = typeof aitu.isGauhar === 'function' && aitu.isGauhar(strChatId);
    const result = await aitu.getUpcomingQuizzesForUser(strChatId);

    if (!result.ok) {
        if (result.sessionExpired) {
            const expKey = `expired:${strChatId}:${todayStr}`;
            const alreadyNotified = await hasAlertBeenSent(expKey);
            if (!alreadyNotified) {
                const expiredMsg = isGauharUser
                    ? `⚠️ <b>Гаухар, твоя сессия learn.astanait.edu.kz истекла!</b> 😱\n\n` +
                      `Бот не может проверить твои дедлайны. Войди через Microsoft SSO, скопируй <code>sessionid</code> и отправь боту:\n\n` +
                      `<code>/set_cookie ТВОЙ_SESSION_ID</code>\n\n` +
                      `🧠 <i>Иначе забудешь сдать квиз!</i>`
                    : `⚠️ <b>Твоя сессия learn.astanait.edu.kz истекла!</b>\n\n` +
                      `Бот не может проверить дедлайны по твоим квизам. Пожалуйста, войди на платформу через Microsoft SSO, скопируй <code>sessionid</code> и отправь боту:\n\n` +
                      `<code>/set_cookie ВАШ_SESSION_ID</code>\n\n` +
                      `💡 <i>Сессия обновится, и автоматические напоминания сразу продолжат работать.</i>`;
                await sendTelegram(strChatId, expiredMsg);
                await markAlertAsSent(expKey);
            }
        }
        return { chatId: strChatId, ok: false, error: result.error, criticalSent, dailySent };
    }

    // =========================================================================
    // 1. ЭКСТРЕННЫЕ ОПОВЕЩЕНИЯ ЗА 1 ЧАС ДО ДЕДЛАЙНА (🔥 САМАЯ ГОРЯЧАЯ НАПОМИНАЛКА)
    // =========================================================================
    const criticalQuizzes = (result.quizzes || []).filter(q => !q.isPast && q.isCriticalHour);
    for (const item of criticalQuizzes) {
        const quizKey = `1h:${strChatId}:${item.courseId}:${item.blockId}`;
        const alreadySent = await hasAlertBeenSent(quizKey);

        if (!alreadySent) {
            const { text: alertText, replyMarkup } = aitu.formatCriticalHourAlert(item, isGauharUser);
            await sendTelegram(strChatId, alertText, {
                reply_markup: replyMarkup,
                disable_notification: false // Максимальный приоритет: громкий звук и вибрация!
            });
            await markAlertAsSent(quizKey);
            criticalSent++;
        }
    }

    // =========================================================================
    // 2. РЕГУЛЯРНАЯ УТРЕННЯЯ СВОДКА (Квизы на 3 дня + статистика для админа)
    // =========================================================================
    const dailyKey = `daily:${strChatId}:${todayStr}`;
    const alreadySentDaily = await hasAlertBeenSent(dailyKey);

    if (!alreadySentDaily && (isMorningWindow || forceSend)) {
        const urgentQuizzes = (result.quizzes || []).filter(q => !q.isPast && q.diffDays <= 3);

        if (urgentQuizzes.length > 0) {
            let alertMsg = isGauharUser
                ? `🔔 <b>Напоминание о квизах для Гаухар!</b> 🧠\n\n`
                : `🔔 <b>Напоминание о квизах AITU!</b>\n\n`;
            for (const item of urgentQuizzes) {
                const dateObj = new Date(item.dueDate);
                const astanaTime = new Intl.DateTimeFormat('ru-RU', {
                    timeZone: 'Asia/Almaty',
                    day: 'numeric',
                    month: 'short',
                    hour: '2-digit',
                    minute: '2-digit'
                }).format(dateObj);

                let badge = '';
                if (item.diffMinutes !== undefined && item.diffMinutes <= 60 && item.diffMinutes > 0) {
                    badge = `🚨 <b>ОСТАЛОСЬ ${item.diffMinutes} МИН.!</b>`;
                } else if (item.diffDays <= 0) {
                    badge = '🚨 <b>СЕГОДНЯ!</b>';
                } else if (item.diffDays === 1) {
                    badge = '🔥 <b>ЗАВТРА!</b>';
                } else {
                    badge = `⏳ через ${item.diffDays} дн.`;
                }

                alertMsg += `📚 <b>${item.courseName}</b>\n` +
                            `📝 <a href="${item.link}">${item.title}</a>\n` +
                            `⏰ Дедлайн: <b>${astanaTime}</b> (${badge})\n\n`;
            }
            alertMsg += isGauharUser
                ? `Гаухар, не забудь сдать вовремя и поставь будильник! ⏰🚀`
                : `Не забудь сдать вовремя! 🚀`;

            if (adminChatIds.includes(strChatId)) {
                try {
                    const stats = await statsEngine.getStatsSummary();
                    if (stats && (stats.dauYesterday > 0 || stats.calcsYesterday > 0)) {
                        alertMsg += `\n\n📊 <i>Вчера GradeMaster: <b>${stats.dauYesterday}</b> активных пользователей, <b>${stats.calcsYesterday}</b> расчётов.</i>`;
                    }
                } catch { /* Optional */ }
            }

            await sendTelegram(strChatId, alertMsg);
            await markAlertAsSent(dailyKey);
            dailySent++;
        } else if (adminChatIds.includes(strChatId)) {
            // Утренняя сводка админу при отсутствии дедлайнов
            try {
                const stats = await statsEngine.getStatsSummary();
                if (stats && (stats.dauYesterday > 0 || stats.calcsYesterday > 0)) {
                    const morningNote = `☀️ <b>Доброе утро! GradeMaster:</b>\n` +
                        `Срочных дедлайнов на ближайшие 3 дня нет (активных квизов: ${result.quizzes.length}).\n\n` +
                        `📊 <i>Вчера сервисом воспользовались <b>${stats.dauYesterday}</b> студентов (сделано <b>${stats.calcsYesterday}</b> расчётов).</i>`;
                    await sendTelegram(strChatId, morningNote);
                    await markAlertAsSent(dailyKey);
                    dailySent++;
                }
            } catch { /* Optional */ }
        }
    }

    return {
        chatId: strChatId,
        ok: true,
        quizzesCount: (result.quizzes || []).length,
        criticalQuizzesCount: criticalQuizzes.length,
        criticalSent,
        dailySent
    };
}

/**
 * Проверка и отправка уведомлений по дедлайнам Moodle LMS для конкретного студента
 */
async function processUserLms(chatId, context) {
    const { isMorningWindow, forceSend, todayStr, adminChatIds } = context;
    const strChatId = String(chatId).trim();
    let criticalSent = 0;
    let dailySent = 0;

    const isGauharUser = typeof lms.isGauhar === 'function' && lms.isGauhar(strChatId);
    const result = await lms.getUpcomingDeadlinesForUser(strChatId);

    if (!result.ok) {
        if (result.sessionExpired) {
            const expKey = `expired:lms:${strChatId}:${todayStr}`;
            const alreadyNotified = await hasAlertBeenSent(expKey);
            if (!alreadyNotified) {
                const expiredMsg = isGauharUser
                    ? `⚠️ <b>Гаухар, сессия Moodle LMS истекла!</b> 😱\n\n` +
                      `Бот не может проверить дедлайны по лабораторным и заданиям.\n` +
                      `Войди в <a href="https://lms.astanait.edu.kz/">lms.astanait.edu.kz</a>, скопируй <code>MoodleSession</code> и отправь:\n\n` +
                      `<code>/set_lms ТВОЙ_MOODLESESSION</code>`
                    : `⚠️ <b>Сессия Moodle LMS истекла!</b>\n\n` +
                      `Бот не может проверить актуальные дедлайны по заданиям.\n` +
                      `Пожалуйста, войдите в <a href="https://lms.astanait.edu.kz/">lms.astanait.edu.kz</a>, скопируйте <code>MoodleSession</code> и отправьте боту:\n\n` +
                      `<code>/set_lms ВАШ_MOODLESESSION</code>`;
                await sendTelegram(strChatId, expiredMsg);
                await markAlertAsSent(expKey);
            }
        }
        return { chatId: strChatId, ok: false, type: 'lms', error: result.error, criticalSent, dailySent };
    }

    const assignments = result.academicEvents || [];

    // 1. Экстренное 1-часовое оповещение по заданиям LMS
    const criticalEvents = assignments.filter(e => !e.isPast && e.isCriticalHour);
    for (const item of criticalEvents) {
        const itemKey = `1h:lms:${strChatId}:${item.id || item.uid}`;
        const alreadySent = await hasAlertBeenSent(itemKey);

        if (!alreadySent) {
            const { text: alertText, replyMarkup } = lms.formatCriticalHourLmsAlert(item, isGauharUser);
            await sendTelegram(strChatId, alertText, {
                reply_markup: replyMarkup,
                disable_notification: false
            });
            await markAlertAsSent(itemKey);
            criticalSent++;
        }
    }

    // 2. Регулярная утренняя сводка по дедлайнам LMS (на 3 дня)
    const dailyKey = `daily:lms:${strChatId}:${todayStr}`;
    const alreadySentDaily = await hasAlertBeenSent(dailyKey);

    if (!alreadySentDaily && (isMorningWindow || forceSend)) {
        const urgentAssignments = assignments.filter(e => !e.isPast && e.diffDays <= 3);

        if (urgentAssignments.length > 0) {
            let alertMsg = isGauharUser
                ? `📚 <b>Утреннее напоминание по LMS для Гаухар!</b> 🧠\n<i>(Срочные задания на ближайшие 3 дня):</i>\n\n`
                : `📚 <b>Утренние дедлайны Moodle LMS (AITU):</b>\n<i>(Задания со сроком сдачи до 3 дней):</i>\n\n`;

            for (const item of urgentAssignments) {
                const dateObj = new Date(item.dueDate);
                const astanaTime = new Intl.DateTimeFormat('ru-RU', {
                    timeZone: 'Asia/Almaty',
                    day: 'numeric',
                    month: 'short',
                    hour: '2-digit',
                    minute: '2-digit'
                }).format(dateObj);

                let badge = '';
                if (item.diffMinutes !== undefined && item.diffMinutes <= 60 && item.diffMinutes > 0) {
                    badge = `🚨 <b>ОСТАЛОСЬ ${item.diffMinutes} МИН.!</b>`;
                } else if (item.diffDays <= 0) {
                    badge = '🚨 <b>СЕГОДНЯ!</b>';
                } else if (item.diffDays === 1) {
                    badge = '🔥 <b>ЗАВТРА!</b>';
                } else {
                    badge = `⏳ через ${item.diffDays} дн.`;
                }

                alertMsg += `📌 <b>${item.courseName}</b>\n` +
                            `👉 <a href="${item.link}">${item.title}</a>\n` +
                            `⏰ Дедлайн: <b>${astanaTime}</b> (${badge})\n\n`;
            }

            alertMsg += isGauharUser
                ? `Гаухар, не откладывай лабы на вечер! ☕️⚡️`
                : `Сдавайте работы заранее, чтобы избежать перегрузки портала! 🚀`;

            await sendTelegram(strChatId, alertMsg);
            await markAlertAsSent(dailyKey);
            dailySent++;
        }
    }

    return {
        chatId: strChatId,
        ok: true,
        type: 'lms',
        deadlinesCount: assignments.length,
        criticalDeadlinesCount: criticalEvents.length,
        criticalSent,
        dailySent
    };
}

module.exports = async function handler(req, res) {
    // Проверка CRON_SECRET от Vercel (если настроен)
    const authHeader = req ? req.headers?.['authorization'] : null;
    if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    const adminChatIds = getAdminChatIds();
    let allRegisteredUsers = [];
    let allLmsUsers = [];
    try {
        allRegisteredUsers = await aitu.getAllQuizUsers();
    } catch (err) {
        console.warn('getAllQuizUsers warning in cron:', err.message);
    }
    try {
        allLmsUsers = await lms.getAllLmsUsers();
    } catch (err) {
        console.warn('getAllLmsUsers warning in cron:', err.message);
    }

    const targetUsers = Array.from(new Set([...allRegisteredUsers, ...adminChatIds])).filter(Boolean);
    const targetLmsUsers = Array.from(new Set([...allLmsUsers, ...adminChatIds])).filter(chatId => {
        return allLmsUsers.includes(chatId) || process.env.AITU_LMS_SESSION_ID;
    });

    const allTargetUsers = Array.from(new Set([...targetUsers, ...targetLmsUsers]));

    if (allTargetUsers.length === 0) {
        return res.status(500).json({ error: 'No quiz users or TELEGRAM_CHAT_ID configured' });
    }

    const todayStr = statsEngine.getTodayDateStr ? statsEngine.getTodayDateStr() : new Date().toISOString().slice(0, 10);
    const astanaHour = Number(new Intl.DateTimeFormat('en-US', {
        timeZone: 'Asia/Almaty',
        hour: 'numeric',
        hour12: false
    }).format(new Date()));

    const isMorningWindow = astanaHour >= 6 && astanaHour <= 11;
    const forceSend = req && req.query && req.query.force === '1';

    const context = {
        isMorningWindow,
        forceSend,
        todayStr,
        adminChatIds
    };

    // Параллельная проверка всех студентов (квизы Learn + задания LMS)
    const quizPromises = targetUsers.map(chatId => processUserQuizzes(chatId, context));
    const lmsPromises = targetLmsUsers.map(chatId => processUserLms(chatId, context));

    const userResults = await Promise.allSettled([...quizPromises, ...lmsPromises]);

    let totalCriticalSent = 0;
    let totalDailySent = 0;
    let totalCriticalQuizzes = 0;
    const summary = [];

    for (const r of userResults) {
        if (r.status === 'fulfilled') {
            totalCriticalSent += r.value.criticalSent || 0;
            totalDailySent += r.value.dailySent || 0;
            totalCriticalQuizzes += (r.value.criticalQuizzesCount || r.value.criticalDeadlinesCount || 0);
            summary.push(r.value);
        } else {
            console.error('Error processing user in cron:', r.reason);
            summary.push({ ok: false, error: r.reason?.message });
        }
    }

    if (totalCriticalSent > 0) {
        return res.status(200).json({
            ok: true,
            type: 'critical_1h',
            criticalSent: totalCriticalSent,
            criticalQuizzes: totalCriticalQuizzes,
            usersChecked: allTargetUsers.length,
            details: summary
        });
    }

    return res.status(200).json({
        ok: true,
        message: 'All users checked successfully',
        usersChecked: allTargetUsers.length,
        criticalSent: totalCriticalSent,
        criticalQuizzes: totalCriticalQuizzes,
        dailySent: totalDailySent,
        details: summary
    });
};

module.exports.hasAlertBeenSent = hasAlertBeenSent;
module.exports.markAlertAsSent = markAlertAsSent;
module.exports.clearSentAlertsMemory = clearSentAlertsMemory;
module.exports.sendTelegram = sendTelegram;
module.exports.processUserQuizzes = processUserQuizzes;
module.exports.processUserLms = processUserLms;
