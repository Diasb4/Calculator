// api/cron.js
// Vercel Cron handler для ежедневных и экстренных напоминаний о квизах AITU
// Поддерживает полностью изолированные персональные проверки для каждого студента

const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const aitu = require('./bot/aitu.js');
const lms = require('./bot/lms.js');
const statsEngine = require('./stats/engine.js');
const { safeCompare, getBotToken, getAdminChatIds } = require('./_lib/util.js');

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
 * Определение срочности дедлайна по времени Алматы (UTC+5)
 */
function checkDeadlineUrgency(dueDateIso, nowDate = new Date()) {
    try {
        const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Almaty', year: 'numeric', month: '2-digit', day: '2-digit' });
        const [nowY, nowM, nowD] = fmt.format(nowDate).split('-').map(Number);
        const [dueY, dueM, dueD] = fmt.format(new Date(dueDateIso)).split('-').map(Number);
        const nowUtc = Date.UTC(nowY, nowM - 1, nowD);
        const dueUtc = Date.UTC(dueY, dueM - 1, dueD);
        const diffDays = Math.round((dueUtc - nowUtc) / (24 * 60 * 60 * 1000));

        const diffMs = new Date(dueDateIso).getTime() - nowDate.getTime();
        const diffHours = Math.round((diffMs / (3600 * 1000)) * 10) / 10;
        const diffMinutes = Math.round(diffMs / 60000);

        return {
            diffDays,
            diffHours,
            diffMinutes,
            isPast: diffMs < 0,
            isTonight: diffDays === 0 && diffMs > 0,
            isTomorrow: diffDays === 1,
            isRelevantForEvening: diffMs > 0 && (diffDays === 0 || diffDays === 1)
        };
    } catch {
        const diffMs = new Date(dueDateIso).getTime() - nowDate.getTime();
        const diffHours = Math.round((diffMs / (3600 * 1000)) * 10) / 10;
        const diffMinutes = Math.round(diffMs / 60000);
        return {
            diffDays: Math.ceil(diffMs / (24 * 3600 * 1000)),
            diffHours,
            diffMinutes,
            isPast: diffMs < 0,
            isTonight: diffHours > 0 && diffHours <= 8,
            isTomorrow: diffHours > 8 && diffHours <= 32,
            isRelevantForEvening: diffHours > 0 && diffHours <= 32
        };
    }
}

/**
 * Проверка и отправка уведомлений для одного конкретного студента
 */
async function processUserQuizzes(chatId, context) {
    const { isMorningWindow, isEveningWindow, forceSend, todayStr, adminChatIds } = context;
    const strChatId = String(chatId).trim();
    let criticalSent = 0;
    let dailySent = 0;
    let eveningSent = 0;

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

    // 1. Оповещения за 1 час до дедлайна
    const uncompletedQuizzes = result.activeQuizzes || (result.quizzes || []).filter(q => !q.isCompleted);
    const criticalQuizzes = uncompletedQuizzes.filter(q => !q.isPast && q.isCriticalHour);
    for (const item of criticalQuizzes) {
        const quizKey = `1h:${strChatId}:${item.courseId}:${item.blockId}`;
        const alreadySent = await hasAlertBeenSent(quizKey);

        if (!alreadySent) {
            const { text: alertText, replyMarkup } = aitu.formatCriticalHourAlert(item, isGauharUser);
            await sendTelegram(strChatId, alertText, {
                reply_markup: replyMarkup,
                disable_notification: false
            });
            await markAlertAsSent(quizKey);
            criticalSent++;
        }
    }

    // 2. Утренняя сводка квизов
    const dailyKey = `daily:${strChatId}:${todayStr}`;
    const alreadySentDaily = await hasAlertBeenSent(dailyKey);

    if (!alreadySentDaily && (isMorningWindow || (forceSend && !isEveningWindow))) {
        const urgentQuizzes = uncompletedQuizzes.filter(q => !q.isPast && q.diffDays <= 3);

        if (urgentQuizzes.length > 0) {
            let alertMsg = isGauharUser
                ? `🔔 <b>Напоминание о квизах для Гаухар:</b>\n\n`
                : `🔔 <b>Напоминание о квизах AITU:</b>\n\n`;
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
                    badge = `⏰ <b>Осталось ${item.diffMinutes} мин.</b>`;
                } else if (item.diffDays <= 0) {
                    badge = '⚠️ <b>Сегодня</b>';
                } else if (item.diffDays === 1) {
                    badge = '📌 <b>Завтра</b>';
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

    // 3. Вечерний чек-лист квизов Learn
    const eveningKey = `evening:${strChatId}:${todayStr}`;
    const alreadySentEvening = await hasAlertBeenSent(eveningKey);

    if (!alreadySentEvening && (isEveningWindow || (forceSend && isEveningWindow))) {
        const nowDate = (context && context.nowDate) ? context.nowDate : new Date();
        const tonightOrTomorrow = uncompletedQuizzes
            .map(q => ({ ...q, _urgency: checkDeadlineUrgency(q.dueDate, nowDate) }))
            .filter(q => !q.isPast && q._urgency.isRelevantForEvening);

        if (tonightOrTomorrow.length > 0) {
            let alertMsg = isGauharUser
                ? `🌆 <b>Гаухар, вечерний чек-лист квизов AITU:</b>\n<i>(Что нужно закрыть до сна или завтра):</i>\n\n`
                : `🌆 <b>Вечерний чек-лист квизов AITU Learn:</b>\n<i>(Дедлайны на сегодня и завтра):</i>\n\n`;

            for (const item of tonightOrTomorrow) {
                const dateObj = new Date(item.dueDate);
                const astanaTime = new Intl.DateTimeFormat('ru-RU', {
                    timeZone: 'Asia/Almaty',
                    day: 'numeric',
                    month: 'short',
                    hour: '2-digit',
                    minute: '2-digit'
                }).format(dateObj);

                const u = item._urgency;
                let badge = '';
                if (u.diffMinutes <= 60 && u.diffMinutes > 0) {
                    badge = `⏰ <b>Осталось ${u.diffMinutes} мин.</b>`;
                } else if (u.isTonight) {
                    badge = `⏳ <b>Сегодня: осталось ${u.diffHours} ч.</b>`;
                } else {
                    badge = `📌 <b>Завтра</b>`;
                }

                alertMsg += `📚 <b>${item.courseName}</b>\n` +
                            `📝 <a href="${item.link}">${item.title}</a>\n` +
                            `⏰ Дедлайн: <b>${astanaTime}</b> (${badge})\n\n`;
            }

            alertMsg += isGauharUser
                ? `☕️ Гаухар, закрой квизы сейчас, чтобы спокойно лечь спать! 🛌✨\n` +
                  `<i>(Сдала? Напиши /done, чтобы бот не шумел перед сном)</i>`
                : `💡 <i>Сдавайте заранее, чтобы серверы не зависли перед полуночью!\n(Сдали работу? Отметьте через /done)</i>`;

            await sendTelegram(strChatId, alertMsg);
            await markAlertAsSent(eveningKey);
            eveningSent++;
        }
    }

    return {
        chatId: strChatId,
        ok: true,
        quizzesCount: (result.quizzes || []).length,
        criticalQuizzesCount: criticalQuizzes.length,
        criticalSent,
        dailySent,
        eveningSent
    };
}

/**
 * Проверка и отправка уведомлений по дедлайнам Moodle LMS для конкретного студента
 */
async function processUserLms(chatId, context) {
    const { isMorningWindow, isEveningWindow, forceSend, todayStr, adminChatIds } = context;
    const strChatId = String(chatId).trim();
    let criticalSent = 0;
    let dailySent = 0;
    let eveningSent = 0;

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
        return { chatId: strChatId, ok: false, type: 'lms', error: result.error, criticalSent, dailySent, eveningSent };
    }

    const assignments = (result.activeAcademicEvents || result.academicEvents || []).filter(e => !e.isCompleted);

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

    if (!alreadySentDaily && (isMorningWindow || (forceSend && !isEveningWindow))) {
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
                    badge = `⏰ <b>Осталось ${item.diffMinutes} мин.</b>`;
                } else if (item.diffDays <= 0) {
                    badge = '⚠️ <b>Сегодня</b>';
                } else if (item.diffDays === 1) {
                    badge = '📌 <b>Завтра</b>';
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

    // 3. Вечерний чек-лист дедлайнов LMS
    const eveningKey = `evening:lms:${strChatId}:${todayStr}`;
    const alreadySentEvening = await hasAlertBeenSent(eveningKey);

    if (!alreadySentEvening && (isEveningWindow || (forceSend && isEveningWindow))) {
        const nowDate = (context && context.nowDate) ? context.nowDate : new Date();
        const tonightOrTomorrow = assignments
            .map(e => ({ ...e, _urgency: checkDeadlineUrgency(e.dueDate, nowDate) }))
            .filter(e => !e.isPast && e._urgency.isRelevantForEvening);

        if (tonightOrTomorrow.length > 0) {
            let alertMsg = isGauharUser
                ? `🌆 <b>Гаухар, вечерний чек-лист дедлайнов LMS:</b>\n<i>(Что нужно сдать сегодня до ночи или завтра):</i>\n\n`
                : `🌆 <b>Вечерний чек-лист Moodle LMS (AITU):</b>\n<i>(Дедлайны на сегодня и завтра):</i>\n\n`;

            for (const item of tonightOrTomorrow) {
                const dateObj = new Date(item.dueDate);
                const astanaTime = new Intl.DateTimeFormat('ru-RU', {
                    timeZone: 'Asia/Almaty',
                    day: 'numeric',
                    month: 'short',
                    hour: '2-digit',
                    minute: '2-digit'
                }).format(dateObj);

                const u = item._urgency;
                let badge = '';
                if (u.diffMinutes <= 60 && u.diffMinutes > 0) {
                    badge = `⏰ <b>Осталось ${u.diffMinutes} мин.</b>`;
                } else if (u.isTonight) {
                    badge = `⏳ <b>Сегодня: осталось ${u.diffHours} ч.</b>`;
                } else {
                    badge = `📌 <b>Завтра</b>`;
                }

                alertMsg += `📌 <b>${item.courseName}</b>\n` +
                            `👉 <a href="${item.link}">${item.title}</a>\n` +
                            `⏰ Дедлайн: <b>${astanaTime}</b> (${badge})\n\n`;
            }

            alertMsg += isGauharUser
                ? `⚡️ Гаухар, добей лабы сейчас, и ночь свободна! ☕️💻\n` +
                  `<i>(Сдала? Напиши /done, чтобы вычеркнуть)</i>`
                : `💡 <i>Лучше сдать сейчас, чем в 23:58 бороться с ошибками портала!\n(Сдали задание? Отметьте через /done)</i>`;

            await sendTelegram(strChatId, alertMsg);
            await markAlertAsSent(eveningKey);
            eveningSent++;
        }
    }

    return {
        chatId: strChatId,
        ok: true,
        type: 'lms',
        deadlinesCount: assignments.length,
        criticalDeadlinesCount: criticalEvents.length,
        criticalSent,
        dailySent,
        eveningSent
    };
}

module.exports = async function handler(req, res) {
    // Проверка CRON_SECRET от Vercel (timing-safe)
    const authHeader = req ? req.headers?.['authorization'] : null;
    if (process.env.CRON_SECRET) {
        if (!authHeader || !safeCompare(authHeader, `Bearer ${process.env.CRON_SECRET}`)) {
            return res.status(401).json({ error: 'Unauthorized' });
        }
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
        hourCycle: 'h23'
    }).format(new Date()));

    const isMorningWindow = astanaHour >= 6 && astanaHour <= 11;
    const isEveningWindow = astanaHour >= 19 && astanaHour <= 22;
    const forceSend = req && req.query && req.query.force === '1';

    const context = {
        isMorningWindow,
        isEveningWindow,
        forceSend,
        todayStr,
        adminChatIds
    };

    // Пакетная параллельная проверка (пачками по 6 пользователей) для предотвращения 429/502 и перегрузки серверов AITU
    const allTasks = [
        ...targetUsers.map(chatId => () => processUserQuizzes(chatId, context)),
        ...targetLmsUsers.map(chatId => () => processUserLms(chatId, context))
    ];

    const userResults = [];
    const chunkSize = 6;
    for (let i = 0; i < allTasks.length; i += chunkSize) {
        const batch = allTasks.slice(i, i + chunkSize);
        const batchRes = await Promise.allSettled(batch.map(fn => fn()));
        userResults.push(...batchRes);
        if (i + chunkSize < allTasks.length) {
            await new Promise(r => setTimeout(r, 50));
        }
    }

    let totalCriticalSent = 0;
    let totalDailySent = 0;
    let totalEveningSent = 0;
    let totalCriticalQuizzes = 0;
    const summary = [];

    for (const r of userResults) {
        if (r.status === 'fulfilled') {
            totalCriticalSent += r.value.criticalSent || 0;
            totalDailySent += r.value.dailySent || 0;
            totalEveningSent += r.value.eveningSent || 0;
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
            dailySent: totalDailySent,
            eveningSent: totalEveningSent,
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
        eveningSent: totalEveningSent,
        details: summary
    });
};

module.exports.hasAlertBeenSent = hasAlertBeenSent;
module.exports.markAlertAsSent = markAlertAsSent;
module.exports.clearSentAlertsMemory = clearSentAlertsMemory;
module.exports.sendTelegram = sendTelegram;
module.exports.processUserQuizzes = processUserQuizzes;
module.exports.processUserLms = processUserLms;
module.exports.checkDeadlineUrgency = checkDeadlineUrgency;
