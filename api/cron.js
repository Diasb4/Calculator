// api/cron.js
// Ежедневные и экстренные напоминания о квизах AITU Learn и дедлайнах Moodle LMS.
// Вызывается фоновым планировщиком server.js (VPS) или по HTTP /api/cron.

const aitu = require('./bot/aitu.js');
const lms = require('./bot/lms.js');
const statsEngine = require('./stats/engine.js');
const { safeCompare, getAdminChatIds, BoundedSet } = require('./_lib/util.js');
const { sendText, isChatGoneError } = require('./_lib/telegram.js');

// Быстрый кэш отметок об отправке; источник истины — KV (gm:alert:<key>, 3 дня).
const sentAlertsMemory = new BoundedSet(20000);

async function hasAlertBeenSent(alertKey) {
    if (sentAlertsMemory.has(alertKey)) return true;

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
}

/**
 * Отправляет сообщение. { ok: true } только при подтверждённой доставке;
 * gone: true — чат больше недоступен (бот заблокирован, аккаунт удалён).
 */
async function sendTelegram(chatId, text, options = {}) {
    try {
        await sendText(chatId, text, options);
        return { ok: true };
    } catch (err) {
        console.warn(`Cron send to ${chatId} failed: ${err.message}`);
        return { ok: false, gone: isChatGoneError(err), error: err.message };
    }
}

/** Отписывает чат, который заблокировал бота, чтобы cron больше его не опрашивал. */
async function dropGoneChat(chatId) {
    if (getAdminChatIds().includes(chatId)) return;
    await Promise.all([
        aitu.deleteUserSession(chatId).catch(() => { }),
        lms.deleteUserLmsSession(chatId).catch(() => { }),
        Promise.resolve(statsEngine.kvCommand(['SREM', 'gm:all_users', chatId])).catch(() => { })
    ]);
    console.log(`Removed chat that blocked the bot: ${chatId}`);
}

/** Отправляет алерт и помечает его отправленным только после успешной доставки. */
async function deliverAlert(chatId, alertKey, text, options) {
    const sendRes = await sendTelegram(chatId, text, options);
    if (sendRes.ok) {
        await markAlertAsSent(alertKey);
    } else if (sendRes.gone) {
        await dropGoneChat(chatId);
    }
    return sendRes;
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
                const sendRes = await deliverAlert(strChatId, expKey, expiredMsg);
                if (sendRes.gone) return { chatId: strChatId, ok: false, type: 'quiz', gone: true };
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
            const sendRes = await deliverAlert(strChatId, quizKey, alertText, {
                reply_markup: replyMarkup,
                disable_notification: false
            });
            if (sendRes.gone) return { chatId: strChatId, ok: false, type: 'quiz', gone: true };
            if (sendRes.ok) criticalSent++;
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

            const sendRes = await deliverAlert(strChatId, dailyKey, alertMsg);
            if (sendRes.gone) return { chatId: strChatId, ok: false, type: 'quiz', gone: true };
            if (sendRes.ok) dailySent++;
        } else if (adminChatIds.includes(strChatId)) {
            // Утренняя сводка админу при отсутствии дедлайнов
            try {
                const stats = await statsEngine.getStatsSummary();
                if (stats && (stats.dauYesterday > 0 || stats.calcsYesterday > 0)) {
                    const morningNote = `☀️ <b>Доброе утро! GradeMaster:</b>\n` +
                        `Срочных дедлайнов на ближайшие 3 дня нет (активных квизов: ${result.quizzes.length}).\n\n` +
                        `📊 <i>Вчера сервисом воспользовались <b>${stats.dauYesterday}</b> студентов (сделано <b>${stats.calcsYesterday}</b> расчётов).</i>`;
                    const sendRes = await deliverAlert(strChatId, dailyKey, morningNote);
                    if (sendRes.ok) dailySent++;
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

            const sendRes = await deliverAlert(strChatId, eveningKey, alertMsg);
            if (sendRes.gone) return { chatId: strChatId, ok: false, type: 'quiz', gone: true };
            if (sendRes.ok) eveningSent++;
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
                const sendRes = await deliverAlert(strChatId, expKey, expiredMsg);
                if (sendRes.gone) return { chatId: strChatId, ok: false, type: 'lms', gone: true };
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
            const sendRes = await deliverAlert(strChatId, itemKey, alertText, {
                reply_markup: replyMarkup,
                disable_notification: false
            });
            if (sendRes.gone) return { chatId: strChatId, ok: false, type: 'lms', gone: true };
            if (sendRes.ok) criticalSent++;
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

            const sendRes = await deliverAlert(strChatId, dailyKey, alertMsg);
            if (sendRes.gone) return { chatId: strChatId, ok: false, type: 'lms', gone: true };
            if (sendRes.ok) dailySent++;
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

            const sendRes = await deliverAlert(strChatId, eveningKey, alertMsg);
            if (sendRes.gone) return { chatId: strChatId, ok: false, type: 'lms', gone: true };
            if (sendRes.ok) eveningSent++;
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

/**
 * Один проход напоминаний по всем подписчикам (Learn + LMS). Используется и
 * HTTP-обработчиком /api/cron, и фоновым планировщиком server.js.
 */
async function runCron({ now = new Date(), force = false } = {}) {
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
        return { ok: false, error: 'No quiz users or TELEGRAM_CHAT_ID configured' };
    }

    const todayStr = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Almaty',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).format(now);
    const astanaHour = Number(new Intl.DateTimeFormat('en-US', {
        timeZone: 'Asia/Almaty',
        hour: 'numeric',
        hourCycle: 'h23'
    }).format(now));

    // Утренняя сводка обещана на 08:00, вечерний чек-лист — на 20:00 (Астана); повторные
    // тики внутри окна идемпотентны благодаря ключам дедупликации.
    const isMorningWindow = astanaHour >= 8 && astanaHour <= 11;
    const isEveningWindow = astanaHour >= 20 && astanaHour <= 22;
    const forceSend = force;

    const context = {
        isMorningWindow,
        isEveningWindow,
        forceSend,
        todayStr,
        adminChatIds,
        nowDate: now
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
        return {
            ok: true,
            type: 'critical_1h',
            criticalSent: totalCriticalSent,
            criticalQuizzes: totalCriticalQuizzes,
            dailySent: totalDailySent,
            eveningSent: totalEveningSent,
            usersChecked: allTargetUsers.length,
            details: summary
        };
    }

    return {
        ok: true,
        message: 'All users checked successfully',
        usersChecked: allTargetUsers.length,
        criticalSent: totalCriticalSent,
        criticalQuizzes: totalCriticalQuizzes,
        dailySent: totalDailySent,
        eveningSent: totalEveningSent,
        details: summary
    };
}

module.exports = async function handler(req, res) {
    // Проверка CRON_SECRET (timing-safe)
    const authHeader = req ? req.headers?.['authorization'] : null;
    if (process.env.CRON_SECRET) {
        if (!authHeader || !safeCompare(authHeader, `Bearer ${process.env.CRON_SECRET}`)) {
            return res.status(401).json({ error: 'Unauthorized' });
        }
    }

    const result = await runCron({ force: req?.query?.force === '1' });
    return res.status(result.ok === false ? 500 : 200).json(result);
};

module.exports.runCron = runCron;

module.exports.hasAlertBeenSent = hasAlertBeenSent;
module.exports.markAlertAsSent = markAlertAsSent;
module.exports.clearSentAlertsMemory = clearSentAlertsMemory;
module.exports.sendTelegram = sendTelegram;
module.exports.processUserQuizzes = processUserQuizzes;
module.exports.processUserLms = processUserLms;
module.exports.checkDeadlineUrgency = checkDeadlineUrgency;
