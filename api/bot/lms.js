// api/bot/lms.js
// Модуль интеграции с платформой Moodle LMS (lms.astanait.edu.kz)
// Поддерживает как "вечные токены" экспорта календаря (iCal authtoken),
// так и автоматическую генерацию токена из cookie MoodleSession.

const os = require('os');
const path = require('path');
const fs = require('fs');
const statsEngine = require('../stats/engine.js');

const LMS_BASE_URL = 'https://lms.astanait.edu.kz';
const GAUHAR_CHAT_ID = '1365231049';
const MAX_SUBSCRIBERS_LIMIT = parseInt(process.env.MAX_SUBSCRIBERS_LIMIT || '55', 10);

function isGauhar(chatId) {
    return String(chatId).trim() === GAUHAR_CHAT_ID;
}

// In-memory fallback хранилище для serverless / тестов
const lmsUserSessionsMemory = new Map();
const lmsSubscribersMemory = new Set();

function getLmsCacheFilePath() {
    try {
        return path.join(os.tmpdir(), 'gm_aitu_lms_session.json');
    } catch {
        return null;
    }
}

/**
 * Проверить, не превышен ли лимит подписчиков (55 человек)
 * @param {string|number} chatId
 * @param {'lms'|'learn'} type
 */
async function canUserSubscribe(chatId, type = 'lms') {
    const strId = String(chatId).trim();

    // Администраторы всегда без лимита
    const rawAdminIds = (process.env.ADMIN_CHAT_ID || process.env.TELEGRAM_CHAT_ID || '').trim();
    const adminIds = rawAdminIds ? rawAdminIds.split(/[,\s;]+/).map(s => s.trim()).filter(Boolean) : [];
    if (adminIds.includes(strId)) {
        return { allowed: true, currentCount: 0, limit: MAX_SUBSCRIBERS_LIMIT, isExisting: true };
    }

    // Пользователи, которые уже подписаны и просто обновляют куку/токен
    const existing = await getUserLmsSession(strId);
    if (existing) {
        return { allowed: true, currentCount: lmsSubscribersMemory.size, limit: MAX_SUBSCRIBERS_LIMIT, isExisting: true };
    }

    // Проверяем текущее количество подписчиков (исключая админов)
    const subscribers = (await getAllLmsUsers()).filter(id => !adminIds.includes(id));
    const currentCount = subscribers.length;

    if (currentCount >= MAX_SUBSCRIBERS_LIMIT) {
        return {
            allowed: false,
            currentCount,
            limit: MAX_SUBSCRIBERS_LIMIT,
            isExisting: false,
            message: `⚠️ <b>Достигнут лимит активных пользователей (${currentCount}/${MAX_SUBSCRIBERS_LIMIT}).</b>\n` +
                `Для обеспечения высокой скорости и стабильности приём новых подписчиков временно приостановлен.`
        };
    }

    return { allowed: true, currentCount, limit: MAX_SUBSCRIBERS_LIMIT, isExisting: false };
}

/**
 * Получить сохраненный URL календаря или сессию пользователя
 */
async function getUserLmsSession(chatId) {
    if (!chatId) return process.env.AITU_LMS_SESSION_ID || null;
    const strId = String(chatId).trim();

    if (lmsUserSessionsMemory.has(strId)) {
        return lmsUserSessionsMemory.get(strId);
    }

    try {
        if (typeof statsEngine.kvCommand === 'function') {
            const res = await statsEngine.kvCommand(['GET', `gm:user:${strId}:lms_session`]);
            if (res && typeof res === 'string' && res.trim()) {
                const clean = res.trim();
                lmsUserSessionsMemory.set(strId, clean);
                lmsSubscribersMemory.add(strId);
                return clean;
            }
        }
    } catch (err) {
        console.warn(`getUserLmsSession error for ${strId}:`, err.message);
    }

    // Если админ и есть дефолтная переменная
    const rawAdminIds = (process.env.ADMIN_CHAT_ID || process.env.TELEGRAM_CHAT_ID || '').trim();
    const adminIds = rawAdminIds ? rawAdminIds.split(/[,\s;]+/).map(s => s.trim()).filter(Boolean) : [];
    if (adminIds.includes(strId) && process.env.AITU_LMS_SESSION_ID) {
        return process.env.AITU_LMS_SESSION_ID.trim();
    }

    return null;
}

/**
 * Сохранить персональную сессию или URL календаря LMS для пользователя
 */
async function saveUserLmsSession(chatId, sessionOrUrl) {
    if (!chatId || !sessionOrUrl) return false;
    const strId = String(chatId).trim();
    const clean = String(sessionOrUrl).trim();

    lmsUserSessionsMemory.set(strId, clean);
    lmsSubscribersMemory.add(strId);

    try {
        if (typeof statsEngine.kvCommand === 'function') {
            // Сохраняем сессию на 90 дней (2592000 сек * 3)
            await statsEngine.kvCommand(['SET', `gm:user:${strId}:lms_session`, clean, 'EX', 7776000]);
            await statsEngine.kvCommand(['SADD', 'gm:lms_subscribers', strId]);
        }
    } catch (err) {
        console.warn(`saveUserLmsSession Redis error for ${strId}:`, err.message);
    }

    return true;
}

/**
 * Удалить персональную сессию LMS (отписка)
 */
async function deleteUserLmsSession(chatId) {
    if (!chatId) return false;
    const strId = String(chatId).trim();

    lmsUserSessionsMemory.delete(strId);
    lmsSubscribersMemory.delete(strId);

    try {
        if (typeof statsEngine.kvCommand === 'function') {
            await statsEngine.kvCommand(['DEL', `gm:user:${strId}:lms_session`]);
            await statsEngine.kvCommand(['SREM', 'gm:lms_subscribers', strId]);
        }
    } catch (err) {
        console.warn(`deleteUserLmsSession Redis error for ${strId}:`, err.message);
    }

    return true;
}

/**
 * Получить список всех пользователей, подписанных на дедлайны LMS
 */
async function getAllLmsUsers() {
    const users = new Set(lmsSubscribersMemory);

    try {
        if (typeof statsEngine.kvCommand === 'function') {
            const redisMembers = await statsEngine.kvCommand(['SMEMBERS', 'gm:lms_subscribers']);
            if (Array.isArray(redisMembers)) {
                for (const m of redisMembers) {
                    if (m) users.add(String(m).trim());
                }
            }
        }
    } catch (err) {
        console.warn('getAllLmsUsers Redis error:', err.message);
    }

    const rawAdminIds = (process.env.ADMIN_CHAT_ID || process.env.TELEGRAM_CHAT_ID || '').trim();
    const adminIds = rawAdminIds ? rawAdminIds.split(/[,\s;]+/).map(s => s.trim()).filter(Boolean) : [];
    for (const adm of adminIds) {
        if (process.env.AITU_LMS_SESSION_ID || lmsUserSessionsMemory.has(adm)) {
            users.add(adm);
        }
    }

    return Array.from(users).filter(Boolean);
}

/**
 * По куке MoodleSession автоматически сгенерировать постоянный iCal URL с authtoken
 */
async function generatePermanentCalendarUrl(moodleSession) {
    const cleanSession = String(moodleSession).trim().replace(/^MoodleSession=/i, '');
    const cookieHeader = `MoodleSession=${cleanSession}`;

    // 1. Проверяем валидность и получаем sesskey из /calendar/export.php
    const exportPageRes = await fetch(`${LMS_BASE_URL}/calendar/export.php`, {
        headers: {
            'Cookie': cookieHeader,
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) GradeMasterBot/2.0'
        },
        redirect: 'manual'
    });

    if (exportPageRes.status === 302 || exportPageRes.status === 303) {
        const loc = exportPageRes.headers.get('location') || '';
        if (loc.includes('login/index.php')) {
            return { ok: false, sessionExpired: true, error: 'Сессия MoodleSession недействительна или истекла' };
        }
    }

    const html = await exportPageRes.text();
    if (html.includes('name="logintoken"') || html.includes('login-form')) {
        return { ok: false, sessionExpired: true, error: 'Сессия MoodleSession недействительна' };
    }

    // Имя пользователя
    const userMatch = html.match(/class="usertext\s+me-1">([^<]+)/i) ||
                      html.match(/class="usertext\s+mr-1">([^<]+)/i) ||
                      html.match(/class="userbutton"[^>]*>[\s\S]*?<span class="usertext[^"]*">([^<]+)/i);
    const userName = userMatch ? userMatch[1].trim() : '';

    // Ищем sesskey
    const sesskeyMatch = html.match(/name="sesskey"\s+value="([^"]+)"/i) || html.match(/"sesskey":"([^"]+)"/i);
    const sesskey = sesskeyMatch ? sesskeyMatch[1] : null;

    if (!sesskey) {
        return { ok: false, error: 'Не удалось получить sesskey из формы экспорта Moodle' };
    }

    // 2. Отправляем форму получения ссылки календаря
    const formData = new URLSearchParams();
    formData.append('sesskey', sesskey);
    formData.append('_qf__core_calendar_export_form', '1');
    formData.append('events[exportevents]', 'all');
    formData.append('period[timeperiod]', 'recentupcoming');
    formData.append('generateurl', 'Get calendar URL');

    const generateRes = await fetch(`${LMS_BASE_URL}/calendar/export.php`, {
        method: 'POST',
        headers: {
            'Cookie': cookieHeader,
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) GradeMasterBot/2.0'
        },
        body: formData.toString()
    });

    const resHtml = await generateRes.text();
    const urlMatch = resHtml.match(/https:\/\/lms\.astanait\.edu\.kz\/calendar\/export_execute\.php[^\s"'<>]+/i) ||
                     resHtml.match(/webcal:\/\/[^\s"'<>]+/i);

    if (!urlMatch) {
        return { ok: false, error: 'Не удалось сгенерировать постоянную ссылку на календарь Moodle' };
    }

    const calendarUrl = urlMatch[0].replace(/^webcal:\/\//i, 'https://').replace(/&amp;/g, '&');
    return {
        ok: true,
        calendarUrl,
        userName,
        sesskey
    };
}

/**
 * Парсер iCalendar (VEVENT) формата Moodle
 */
function parseIcalEvents(icalText) {
    const events = [];
    const vevents = icalText.split('BEGIN:VEVENT').slice(1);

    for (const block of vevents) {
        const endIdx = block.indexOf('END:VEVENT');
        const content = endIdx !== -1 ? block.slice(0, endIdx) : block;

        const summaryMatch = content.match(/SUMMARY:(.*)/);
        const descMatch = content.match(/DESCRIPTION:([\s\S]*?)(?=(?:CLASS|LAST-MODIFIED|DTSTAMP|DTSTART|CATEGORIES|UID):)/);
        const catMatch = content.match(/CATEGORIES:(.*)/);
        const dtstartMatch = content.match(/DTSTART:([0-9TZ]+)/);
        const dtendMatch = content.match(/DTEND:([0-9TZ]+)/);
        const uidMatch = content.match(/UID:(.*)/);

        function parseIcalDate(str) {
            if (!str) return null;
            const m = str.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z?$/);
            if (m) {
                return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]));
            }
            return null;
        }

        const rawTitle = summaryMatch ? summaryMatch[1].trim() : 'Event';
        const cleanTitle = rawTitle.replace(/\s+is due$/i, '').replace(/\\,/g, ',');
        const courseName = catMatch ? catMatch[1].trim().replace(/\\,/g, ',') : 'Курс AITU';
        const dueDate = parseIcalDate(dtendMatch ? dtendMatch[1] : (dtstartMatch ? dtstartMatch[1] : null));
        const desc = descMatch ? descMatch[1].replace(/\\n/g, '\n').replace(/\\,/g, ',').trim() : '';
        const uid = uidMatch ? uidMatch[1].trim() : '';
        const eventId = uid.replace(/@.*$/, '');

        // Извлекаем прямую ссылку на активность из описания, если есть
        const linkMatch = desc.match(/https:\/\/lms\.astanait\.edu\.kz\/mod\/[^\s"'<>]+/i);
        const activityLink = linkMatch
            ? linkMatch[0]
            : `${LMS_BASE_URL}/calendar/view.php?view=upcoming`;

        if (dueDate) {
            const now = Date.now();
            const diffMs = dueDate.getTime() - now;
            const diffMinutes = Math.round(diffMs / (60 * 1000));
            const diffHours = Math.round(diffMs / (60 * 60 * 1000) * 10) / 10;
            const diffDays = Math.ceil(diffMs / (24 * 60 * 60 * 1000));

            const lowerTitle = cleanTitle.toLowerCase();
            const lowerCourse = courseName.toLowerCase();
            const isAttendance = lowerTitle.includes('attendance') ||
                lowerCourse.includes('attendance') ||
                lowerTitle.includes('посещаемость') ||
                lowerCourse.includes('посещаемость') ||
                lowerTitle.includes('қатысу') ||
                lowerCourse.includes('қатысу') ||
                activityLink.includes('/mod/attendance/');

            const isAssignment = lowerTitle.includes('assignment') || lowerTitle.includes('lab') || lowerTitle.includes('submission') || lowerTitle.includes('задание') || lowerTitle.includes('отчет') || activityLink.includes('/mod/assign/');
            const isQuiz = lowerTitle.includes('quiz') || lowerTitle.includes('test') || lowerTitle.includes('тест') || lowerTitle.includes('чек') || activityLink.includes('/mod/quiz/');

            events.push({
                id: eventId,
                uid,
                title: cleanTitle,
                courseName,
                dueDate: dueDate.toISOString(),
                timestamp: Math.floor(dueDate.getTime() / 1000),
                diffMinutes,
                diffHours,
                diffDays,
                isPast: diffMs < 0,
                isCriticalHour: diffMinutes > 0 && diffMinutes <= 60,
                isAttendance,
                isAssignment,
                isQuiz,
                link: activityLink,
                desc: desc.slice(0, 300)
            });
        }
    }

    // Сортируем по возрастанию дедлайна (ближайшие первыми)
    events.sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime());
    return events;
}

/**
 * Получить список всех актуальных дедлайнов LMS по сессии или URL календаря
 */
async function getUpcomingDeadlines(sessionOrUrl) {
    if (!sessionOrUrl) {
        return { ok: false, error: 'Сессия LMS не настроена' };
    }

    let calendarUrl = String(sessionOrUrl).trim();

    // Если передан не URL, а кука MoodleSession — генерируем постоянный URL
    if (!calendarUrl.startsWith('http://') && !calendarUrl.startsWith('https://')) {
        const genRes = await generatePermanentCalendarUrl(calendarUrl);
        if (!genRes.ok) {
            return genRes;
        }
        calendarUrl = genRes.calendarUrl;
    }

    try {
        const res = await fetch(calendarUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) GradeMasterBot/2.0'
            },
            signal: AbortSignal.timeout(6000)
        });

        if (res.status === 403 || res.status === 401) {
            return { ok: false, sessionExpired: true, error: 'Токен календаря Moodle недействителен' };
        }

        if (!res.ok) {
            return { ok: false, error: `LMS server returned status ${res.status}` };
        }

        const icalText = await res.text();
        if (!icalText.includes('BEGIN:VCALENDAR')) {
            return { ok: false, error: 'Ответ сервера не является iCalendar' };
        }

        const allEvents = parseIcalEvents(icalText);
        // Фильтруем: только будущие события, в первую очередь учебные задания и квизы
        const activeEvents = allEvents.filter(e => !e.isPast);
        const academicEvents = activeEvents.filter(e => !e.isAttendance);
        const attendanceEvents = activeEvents.filter(e => e.isAttendance);

        return {
            ok: true,
            calendarUrl,
            allEvents,
            activeEvents,
            academicEvents,
            attendanceEvents,
            quizzesCount: academicEvents.length
        };
    } catch (err) {
        return { ok: false, error: `Ошибка загрузки дедлайнов LMS: ${err.message}` };
    }
}

/**
 * Получить дедлайны LMS для конкретного пользователя (по chatId)
 */
async function getUpcomingDeadlinesForUser(chatId) {
    const sessionOrUrl = await getUserLmsSession(chatId);
    if (!sessionOrUrl) {
        return { ok: false, sessionExpired: true, notConfigured: true, error: 'Сессия LMS не привязана' };
    }
    return getUpcomingDeadlines(sessionOrUrl);
}

/**
 * Форматирование списка дедлайнов LMS в красивое HTML-сообщение
 */
function formatLmsDeadlinesMessage(result, isGauharUser = false) {
    if (!result || !result.ok) {
        if (result?.notConfigured || result?.sessionExpired) {
            const gauharPrefix = isGauharUser ? `Гаухар, мы знаем, что ты забыла подключить LMS! 😅\n\n` : '';
            return `📚 <b>Дедлайны Moodle LMS (lms.astanait.edu.kz)</b>\n\n` +
                `${gauharPrefix}` +
                `У вас не подключены дедлайны LMS.\n\n` +
                `<b>Как подключить за 1 минуту:</b>\n` +
                `1. Откройте в браузере <a href="https://lms.astanait.edu.kz/">lms.astanait.edu.kz</a>\n` +
                `2. Нажмите <b>F12</b> (Инструменты разработчика) → вкладка <b>Application</b> → <b>Cookies</b>\n` +
                `3. Скопируйте значение <code>MoodleSession</code>\n` +
                `4. Отправьте боту команду:\n<code>/set_lms ВАШ_MOODLESESSION</code>\n\n` +
                `<i>💡 Бот автоматически сгенерирует вечный токен календаря, и напоминания будут работать весь семестр без повторных вводов!</i>`;
        }
        return `❌ <b>Ошибка загрузки дедлайнов LMS:</b>\n${result?.error || 'Неизвестная ошибка'}`;
    }

    const assignments = result.academicEvents || [];

    if (assignments.length === 0) {
        if (isGauharUser) {
            return `🎉 <b>Гаухар, активных заданий в LMS нет!</b>\n` +
                `Ты всё сдала (или преподаватели ещё не создали дедлайны). Можно спокойно пить чай! ☕✨`;
        }
        return `🎉 <b>В Moodle LMS нет горящих дедлайнов!</b>\nВсе задания и лабораторные сданы. Отличная работа! 👏`;
    }

    let text = isGauharUser
        ? `📚 <b>Дедлайны Moodle LMS для Гаухар:</b> 🧠\n<i>(Смотри внимательно и ничего не откладывай!)</i>\n\n`
        : `📚 <b>Актуальные дедлайны Moodle LMS (AITU):</b>\n\n`;

    // Выводим только реальные учебные задания (лабы, отчеты, квизы)
    for (let i = 0; i < Math.min(assignments.length, 8); i++) {
        const item = assignments[i];
        const dateObj = new Date(item.dueDate);
        const astanaTime = new Intl.DateTimeFormat('ru-RU', {
            timeZone: 'Asia/Almaty',
            day: 'numeric',
            month: 'short',
            hour: '2-digit',
            minute: '2-digit'
        }).format(dateObj);

        let badge = '';
        if (item.diffMinutes <= 60 && item.diffMinutes > 0) {
            badge = `🚨 <b>ОСТАЛОСЬ ${item.diffMinutes} МИН.!</b>`;
        } else if (item.diffDays <= 0) {
            badge = '🚨 <b>СЕГОДНЯ!</b>';
        } else if (item.diffDays === 1) {
            badge = '🔥 <b>ЗАВТРА!</b>';
        } else {
            badge = `⏳ через ${item.diffDays} дн.`;
        }

        const icon = item.isQuiz ? '📝' : '📌';
        text += `${icon} <b>${item.courseName}</b>\n` +
                `👉 <a href="${item.link}">${item.title}</a>\n` +
                `⏰ Дедлайн: <b>${astanaTime}</b> (${badge})\n\n`;
    }

    text += `<i>💡 Нажмите на название задания, чтобы сразу открыть страницу сдачи.</i>`;
    return text;
}

/**
 * Экстренное 1-часовое оповещение о горящем дедлайне LMS
 */
function formatCriticalHourLmsAlert(event, isGauharUser = false) {
    const minsLeft = event.diffMinutes || 60;
    const dateObj = new Date(event.dueDate);
    const astanaTime = new Intl.DateTimeFormat('ru-RU', {
        timeZone: 'Asia/Almaty',
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit'
    }).format(dateObj);

    let text = '';
    if (isGauharUser) {
        text = `🚨🚨🚨 <b>ГАУХАР! СРОЧНЫЙ ДЕДЛАЙН В LMS: ${minsLeft} МИНУТ!</b> 🚨🚨🚨\n\n` +
            `🧠 <b>Мы знали, что ты забыла! Срочно бросай всё и открывай:</b>\n` +
            `📚 <b>Предмет:</b> ${event.courseName}\n` +
            `📌 <b>Задание:</b> <code>${event.title}</code>\n` +
            `⏰ <b>Срок сдачи:</b> <b>${astanaTime}</b> (ровно через ${minsLeft} мин.!)\n\n` +
            `🚀 <i>Нажми кнопку ниже прямо сейчас, пока портал не закрыл прием работ!</i> 👇`;
    } else {
        text = `🚨🚨🚨 <b>ВНИМАНИЕ! ГОРЯЩИЙ ДЕДЛАЙН В LMS: 1 ЧАС!</b> 🚨🚨🚨\n\n` +
            `📚 <b>Курс:</b> ${event.courseName}\n` +
            `📌 <b>Задание:</b> <code>${event.title}</code>\n` +
            `⏰ <b>Окончание приёма:</b> <b>${astanaTime}</b> (осталось всего <b>${minsLeft} мин.</b>)\n\n` +
            `⚡️ Не откладывай на последние 5 минут — сдай работу прямо сейчас!`;
    }

    const replyMarkup = {
        inline_keyboard: [
            [{ text: isGauharUser ? '🚀 Спасти оценку в LMS' : '🚀 Сдать задание в LMS', url: event.link }]
        ]
    };

    return { text, replyMarkup };
}

module.exports = {
    MAX_SUBSCRIBERS_LIMIT,
    isGauhar,
    canUserSubscribe,
    getUserLmsSession,
    saveUserLmsSession,
    deleteUserLmsSession,
    getAllLmsUsers,
    generatePermanentCalendarUrl,
    parseIcalEvents,
    getUpcomingDeadlines,
    getUpcomingDeadlinesForUser,
    formatLmsDeadlinesMessage,
    formatCriticalHourLmsAlert,
    _lmsUserSessionsMemory: lmsUserSessionsMemory,
    _lmsSubscribersMemory: lmsSubscribersMemory
};
