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
const MAX_SUBSCRIBERS_LIMIT = parseInt(process.env.LMS_MAX_SUBSCRIBERS_LIMIT || process.env.MAX_SUBSCRIBERS_LIMIT || '200', 10);

function isGauhar(chatId) {
    return String(chatId).trim() === GAUHAR_CHAT_ID;
}

// In-memory fallback хранилище для serverless / тестов
const lmsUserSessionsMemory = new Map();
const lmsSubscribersMemory = new Set();
const lmsCompletedEventsMemory = new Map();
const lmsCacheMemory = new Map(); // cacheKey -> { timestamp, data }
const lmsLastSuccessfulSnapshot = new Map(); // cacheKey -> { timestamp, data }
const LMS_CACHE_TTL_MS = 60 * 1000; // 60 секунд SWR

/**
 * Вычислить дату конца текущей недели (Воскресенье 23:59:59.999 по времени Астаны UTC+5)
 */
function getEndOfWeek(nowDate = new Date()) {
    const nowUtcMs = nowDate.getTime();
    const almatyMs = nowUtcMs + 5 * 3600 * 1000;
    const almatyDate = new Date(almatyMs);
    const day = almatyDate.getUTCDay(); // 0 is Sunday, 1..6 is Mon..Sat
    const daysToSunday = (7 - (day === 0 ? 7 : day));
    const endOfWeekAlmatyMs = Date.UTC(
        almatyDate.getUTCFullYear(),
        almatyDate.getUTCMonth(),
        almatyDate.getUTCDate() + daysToSunday,
        23, 59, 59, 999
    );
    return new Date(endOfWeekAlmatyMs - 5 * 3600 * 1000);
}

function getLmsCacheFilePath() {
    try {
        return path.join(os.tmpdir(), 'gm_aitu_lms_session.json');
    } catch {
        return null;
    }
}

/**
 * Проверка безопасности URL платформы LMS (защита от SSRF / intranet сканирования)
 */
function isAllowedLmsUrl(rawUrl) {
    if (!rawUrl || typeof rawUrl !== 'string') return false;
    let urlStr = rawUrl.trim();
    if (urlStr.startsWith('webcal://')) {
        urlStr = 'https://' + urlStr.slice(9);
    }
    if (urlStr.startsWith('http://lms.astanait.edu.kz')) {
        urlStr = 'https://' + urlStr.slice(7);
    }
    try {
        const parsed = new URL(urlStr);
        if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
            return false;
        }
        // Запрет учетных данных в URL (user:pass@...)
        if (parsed.username || parsed.password) {
            return false;
        }
        // Запрет нестандартных портов для LMS
        if (parsed.port && parsed.port !== '443' && parsed.port !== '80') {
            return false;
        }
        const hostname = parsed.hostname.toLowerCase();
        const allowedHosts = ['lms.astanait.edu.kz'];
        if (process.env.LMS_ALLOWED_HOST) {
            allowedHosts.push(process.env.LMS_ALLOWED_HOST.trim().toLowerCase());
        }
        if (!allowedHosts.includes(hostname)) {
            return false;
        }
        // Защита от локальных/приватных адресов и облачных метаданных
        if (/^(?:127\.|10\.|172\.(?:1[6-9]|2\d|3[01])\.|192\.168\.|169\.254\.|0\.|localhost|::1)/i.test(hostname)) {
            return false;
        }
        return true;
    } catch {
        return false;
    }
}

function esc(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
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
        const mem = lmsUserSessionsMemory.get(strId);
        if ((mem.startsWith('http://') || mem.startsWith('https://') || mem.startsWith('webcal://')) && !isAllowedLmsUrl(mem)) {
            lmsUserSessionsMemory.delete(strId);
            lmsSubscribersMemory.delete(strId);
            return null;
        }
        return mem;
    }

    try {
        if (typeof statsEngine.kvCommand === 'function') {
            const res = await statsEngine.kvCommand(['GET', `gm:user:${strId}:lms_session`]);
            if (res && typeof res === 'string' && res.trim()) {
                const clean = res.trim();
                if ((clean.startsWith('http://') || clean.startsWith('https://') || clean.startsWith('webcal://')) && !isAllowedLmsUrl(clean)) {
                    console.warn(`getUserLmsSession purged invalid legacy URL for ${strId}: ${clean}`);
                    deleteUserLmsSession(strId).catch(() => {});
                    return null;
                }
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

    if ((clean.startsWith('http://') || clean.startsWith('https://') || clean.startsWith('webcal://')) && !isAllowedLmsUrl(clean)) {
        console.warn(`saveUserLmsSession SSRF protection blocked invalid URL: ${clean}`);
        return false;
    }

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
    lmsCompletedEventsMemory.delete(strId);

    try {
        if (typeof statsEngine.kvCommand === 'function') {
            await statsEngine.kvCommand(['DEL', `gm:user:${strId}:lms_session`]);
            await statsEngine.kvCommand(['DEL', `gm:user:${strId}:lms_completed`]);
            await statsEngine.kvCommand(['SREM', 'gm:lms_subscribers', strId]);
        }
    } catch (err) {
        console.warn(`deleteUserLmsSession Redis error for ${strId}:`, err.message);
    }

    return true;
}

/**
 * Получить список ID сданных студентом заданий LMS
 */
async function getUserCompletedLmsEvents(chatId) {
    if (!chatId) return new Set();
    const strId = String(chatId).trim();
    const result = new Set(lmsCompletedEventsMemory.get(strId) || []);

    try {
        if (typeof statsEngine.kvCommand === 'function') {
            const redisMembers = await statsEngine.kvCommand(['SMEMBERS', `gm:user:${strId}:lms_completed`]);
            if (Array.isArray(redisMembers)) {
                for (const m of redisMembers) {
                    if (m) result.add(String(m).trim());
                }
            }
        }
    } catch (err) {
        console.warn(`getUserCompletedLmsEvents Redis error for ${strId}:`, err.message);
    }
    return result;
}

/**
 * Отметить задание LMS как сданное
 */
async function markLmsEventCompleted(chatId, eventId) {
    if (!chatId || !eventId) return false;
    const strId = String(chatId).trim();
    const cleanId = String(eventId).trim();

    if (!lmsCompletedEventsMemory.has(strId)) {
        lmsCompletedEventsMemory.set(strId, new Set());
    }
    lmsCompletedEventsMemory.get(strId).add(cleanId);

    try {
        if (typeof statsEngine.kvCommand === 'function') {
            await statsEngine.kvCommand(['SADD', `gm:user:${strId}:lms_completed`, cleanId]);
        }
    } catch (err) {
        console.warn(`markLmsEventCompleted Redis error for ${strId}:`, err.message);
    }
    return true;
}

/**
 * Отметить сразу несколько заданий LMS как сданные (массовая отметка)
 */
async function markAllLmsEventsCompleted(chatId, eventIds = []) {
    if (!chatId || !Array.isArray(eventIds) || eventIds.length === 0) return 0;
    const strId = String(chatId).trim();
    if (!lmsCompletedEventsMemory.has(strId)) {
        lmsCompletedEventsMemory.set(strId, new Set());
    }
    const cleanIds = eventIds.map(id => String(id).trim()).filter(Boolean);
    for (const id of cleanIds) {
        lmsCompletedEventsMemory.get(strId).add(id);
    }
    try {
        if (typeof statsEngine.kvCommand === 'function' && cleanIds.length > 0) {
            await statsEngine.kvCommand(['SADD', `gm:user:${strId}:lms_completed`, ...cleanIds]);
        }
    } catch (err) {
        console.warn(`markAllLmsEventsCompleted Redis error for ${strId}:`, err.message);
    }
    return cleanIds.length;
}

/**
 * Снять отметку сданного с задания LMS (вернуть в активные)
 */
async function unmarkLmsEventCompleted(chatId, eventId) {
    if (!chatId || !eventId) return false;
    const strId = String(chatId).trim();
    const cleanId = String(eventId).trim();

    if (lmsCompletedEventsMemory.has(strId)) {
        lmsCompletedEventsMemory.get(strId).delete(cleanId);
    }

    try {
        if (typeof statsEngine.kvCommand === 'function') {
            await statsEngine.kvCommand(['SREM', `gm:user:${strId}:lms_completed`, cleanId]);
        }
    } catch (err) {
        console.warn(`unmarkLmsEventCompleted Redis error for ${strId}:`, err.message);
    }
    return true;
}

/**
 * Очистить все отметки сданных заданий пользователя (сброс)
 */
async function clearUserCompletedLmsEvents(chatId) {
    if (!chatId) return false;
    const strId = String(chatId).trim();
    lmsCompletedEventsMemory.delete(strId);
    try {
        if (typeof statsEngine.kvCommand === 'function') {
            await statsEngine.kvCommand(['DEL', `gm:user:${strId}:lms_completed`]);
        }
    } catch {}
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
async function getUpcomingDeadlines(sessionOrUrl, forceRefresh = false) {
    if (!sessionOrUrl) {
        return { ok: false, error: 'Сессия LMS не настроена' };
    }

    let calendarUrl = String(sessionOrUrl).trim();
    const cacheKey = calendarUrl;

    if (!forceRefresh && lmsCacheMemory.has(cacheKey)) {
        const cached = lmsCacheMemory.get(cacheKey);
        if (Date.now() - cached.timestamp < LMS_CACHE_TTL_MS) {
            return JSON.parse(JSON.stringify(cached.data));
        }
    }

    // Если передан не URL, а кука MoodleSession — генерируем постоянный URL
    if (!calendarUrl.startsWith('http://') && !calendarUrl.startsWith('https://') && !calendarUrl.startsWith('webcal://')) {
        const cleanCookie = calendarUrl.replace(/^MoodleSession=/i, '').trim();
        if (!/^[a-zA-Z0-9_\-]{16,128}$/.test(cleanCookie)) {
            return { ok: false, error: 'Некорректный формат сессии MoodleSession' };
        }
        const genRes = await generatePermanentCalendarUrl(calendarUrl);
        if (!genRes.ok) {
            if (lmsLastSuccessfulSnapshot.has(cacheKey)) {
                const snap = lmsLastSuccessfulSnapshot.get(cacheKey);
                return {
                    ...JSON.parse(JSON.stringify(snap.data)),
                    isStale: true,
                    staleTimestamp: snap.timestamp
                };
            }
            return genRes;
        }
        calendarUrl = genRes.calendarUrl;
    } else {
        if (!isAllowedLmsUrl(calendarUrl)) {
            return {
                ok: false,
                error: 'Недопустимый адрес календаря. Разрешены только защищенные ссылки на lms.astanait.edu.kz'
            };
        }
    }

    try {
        const res = await fetch(calendarUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) GradeMasterBot/2.0'
            },
            redirect: 'error',
            signal: AbortSignal.timeout(5000)
        });

        if (res.status === 403 || res.status === 401) {
            return { ok: false, sessionExpired: true, error: 'Токен календаря Moodle недействителен' };
        }

        if (!res.ok) {
            if (lmsLastSuccessfulSnapshot.has(cacheKey)) {
                const snap = lmsLastSuccessfulSnapshot.get(cacheKey);
                return {
                    ...JSON.parse(JSON.stringify(snap.data)),
                    isStale: true,
                    staleTimestamp: snap.timestamp
                };
            }
            return { ok: false, error: `LMS server returned status ${res.status}` };
        }

        const icalText = await res.text();
        if (!icalText.includes('BEGIN:VCALENDAR')) {
            if (lmsLastSuccessfulSnapshot.has(cacheKey)) {
                const snap = lmsLastSuccessfulSnapshot.get(cacheKey);
                return {
                    ...JSON.parse(JSON.stringify(snap.data)),
                    isStale: true,
                    staleTimestamp: snap.timestamp
                };
            }
            return { ok: false, error: 'Ответ сервера не является iCalendar' };
        }

        const allEvents = parseIcalEvents(icalText);
        // Фильтруем: только будущие события, в первую очередь учебные задания и квизы
        const activeEvents = allEvents.filter(e => !e.isPast);
        const academicEvents = activeEvents.filter(e => !e.isAttendance);
        const attendanceEvents = activeEvents.filter(e => e.isAttendance);

        const data = {
            ok: true,
            calendarUrl,
            allEvents,
            activeEvents,
            academicEvents,
            attendanceEvents,
            quizzesCount: academicEvents.length
        };

        // Сохраняем в кэш и в snapshot
        lmsCacheMemory.set(cacheKey, { timestamp: Date.now(), data });
        lmsLastSuccessfulSnapshot.set(cacheKey, { timestamp: Date.now(), data });

        return JSON.parse(JSON.stringify(data));
    } catch (err) {
        if (lmsLastSuccessfulSnapshot.has(cacheKey)) {
            const snap = lmsLastSuccessfulSnapshot.get(cacheKey);
            return {
                ...JSON.parse(JSON.stringify(snap.data)),
                isStale: true,
                staleTimestamp: snap.timestamp
            };
        }
        return { ok: false, error: `Ошибка загрузки дедлайнов LMS: ${err.message}` };
    }
}

/**
 * Получить дедлайны LMS для конкретного пользователя (по chatId)
 */
async function getUpcomingDeadlinesForUser(chatId, forceRefresh = false) {
    const sessionOrUrl = await getUserLmsSession(chatId);
    if (!sessionOrUrl) {
        return { ok: false, sessionExpired: true, notConfigured: true, error: 'Сессия LMS не привязана' };
    }
    const res = await getUpcomingDeadlines(sessionOrUrl, forceRefresh);
    if (!res.ok) return res;

    const completedSet = await getUserCompletedLmsEvents(chatId);
    const completedList = Array.from(completedSet);
    if (res.academicEvents) {
        for (const ev of res.academicEvents) {
            const evId = String(ev.id || '');
            const uid = String(ev.uid || '');
            ev.isCompleted = completedSet.has(evId) || completedSet.has(uid) ||
                             completedList.some(cId => (evId && evId.startsWith(cId)) || (uid && uid.startsWith(cId)));
        }
        res.activeAcademicEvents = res.academicEvents.filter(e => !e.isCompleted);
        res.completedAcademicEvents = res.academicEvents.filter(e => e.isCompleted);
        res.completedCount = res.completedAcademicEvents.length;
        res.pendingCount = res.activeAcademicEvents.length;
        res.quizzesCount = res.activeAcademicEvents.length;
    }
    return res;
}

/**
 * Форматирование списка дедлайнов LMS в красивое HTML-сообщение
 * @param {Object} result
 * @param {boolean} isGauharUser
 * @param {boolean} showCompletedOnly
 * @param {'week'|'all'} viewMode Режим отображения: 'week' (по умолчанию - текущая неделя) или 'all' (весь семестр)
 * @param {string|null} targetCourse Фильтр по конкретному предмету
 */
function formatLmsDeadlinesMessage(result, isGauharUser = false, showCompletedOnly = false, viewMode = 'week', targetCourse = null) {
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

    let staleBanner = '';
    if (result.isStale) {
        const timeStr = result.staleTimestamp
            ? new Intl.DateTimeFormat('ru-RU', { timeZone: 'Asia/Almaty', hour: '2-digit', minute: '2-digit' }).format(new Date(result.staleTimestamp))
            : 'недавно';
        staleBanner = `⚠️ <i>Сервер LMS сейчас перегружен. Показана сохранённая копия дедлайнов от ${timeStr} 📦</i>\n\n`;
    }

    if (showCompletedOnly) {
        const completed = result.completedAcademicEvents || [];
        if (completed.length === 0) {
            return staleBanner + `📋 <b>Сданные задания Moodle LMS:</b>\n\n` +
                `У вас пока нет отмеченных сданных заданий.\n` +
                `Чтобы скрыть сданное задание из списка активных дедлайнов, нажмите кнопку «✅ Отметить сданное».`;
        }
        let compText = staleBanner + `📋 <b>Ваши сданные задания Moodle LMS (${completed.length}):</b>\n\n`;
        for (const item of completed) {
            compText += `✅ <b>${esc(item.courseName)}</b>\n` +
                        `• <a href="${item.link}">${esc(item.title)}</a>\n\n`;
        }
        compText += `<i>💡 Эти задания скрыты из списка дедлайнов и утренних напоминаний. Чтобы вернуть задание в активные, выберите его в меню ниже.</i>`;
        return compText;
    }

    let assignments = (result.activeAcademicEvents !== undefined)
        ? result.activeAcademicEvents
        : (result.academicEvents || []);

    if (targetCourse) {
        const cleanTarget = String(targetCourse).trim().toLowerCase();
        assignments = assignments.filter(e => e.courseName && e.courseName.toLowerCase().includes(cleanTarget));
    }

    if (assignments.length === 0) {
        if (targetCourse) {
            return staleBanner + `ℹ️ <b>По предмету «${targetCourse}» активных дедлайнов не найдено!</b> 🥳`;
        }
        if (result.completedCount && result.completedCount > 0) {
            if (isGauharUser) {
                return staleBanner + `🎉 <b>Гаухар, все задания в LMS сданы!</b> 🧠✨\n` +
                    `Ты закрыла все задания (сдано: <b>${result.completedCount}</b>)! Бот больше не потревожит тебя тревожными сигналами. Отличная работа! ☕🥳`;
            }
            return staleBanner + `🎉 <b>Все задания в Moodle LMS сданы!</b>\n` +
                `Вы отметили сданными все задания (всего: <b>${result.completedCount}</b>). Бот исключил их из напоминаний. Отличная работа! 👏`;
        }
        if (isGauharUser) {
            return staleBanner + `🎉 <b>Гаухар, активных заданий в LMS нет!</b>\n` +
                `Ты всё сдала (или преподаватели ещё не создали дедлайны). Можно спокойно пить чай! ☕✨`;
        }
        return staleBanner + `🎉 <b>В Moodle LMS нет горящих дедлайнов!</b>\nВсе задания и лабораторные сданы. Отличная работа! 👏`;
    }

    // Режим текущей недели (по умолчанию)
    if (viewMode === 'week' && !targetCourse) {
        const endOfWeek = getEndOfWeek();
        const weekAssignments = assignments.filter(e => new Date(e.dueDate) <= endOfWeek);

        if (weekAssignments.length === 0) {
            let emptyWeekMsg = isGauharUser
                ? `🎉 <b>Гаухар, на этой неделе горящих дедлайнов нет!</b> ☕️✨\n\n` +
                  `Все ближайшие задания запланированы уже на следующей неделе (всего в семестре: <b>${assignments.length}</b>).\n` +
                  `Нажми кнопку ниже, чтобы заглянуть во все дедлайны на семестр!`
                : `🎉 <b>На этой неделе (до конца воскресенья) горящих дедлайнов нет!</b> ☕️\n\n` +
                  `Ближайшие задания запланированы на следующей неделе (всего в семестре: <b>${assignments.length}</b>).\n` +
                  `Нажмите кнопку <b>«🗓 Показать весь семестр»</b> ниже, чтобы посмотреть их.`;
            if (result.completedCount && result.completedCount > 0) {
                emptyWeekMsg += `\n\n✅ <i>Сдано вами: <b>${result.completedCount}</b> заданий (скрыты из напоминаний)</i>`;
            }
            return staleBanner + emptyWeekMsg;
        }

        let text = isGauharUser
            ? `📅 <b>Дедлайны LMS на эту неделю для Гаухар:</b> 🧠\n<i>(Смотри внимательно и ничего не откладывай!)</i>\n\n`
            : `📅 <b>Дедлайны Moodle LMS на эту неделю:</b>\n\n`;

        const dayGroups = new Map();
        for (const item of weekAssignments) {
            const dateObj = new Date(item.dueDate);
            const dayName = new Intl.DateTimeFormat('ru-RU', {
                timeZone: 'Asia/Almaty',
                weekday: 'short',
                day: 'numeric',
                month: 'short'
            }).format(dateObj);
            const capDay = dayName.charAt(0).toUpperCase() + dayName.slice(1);
            if (!dayGroups.has(capDay)) dayGroups.set(capDay, []);
            dayGroups.get(capDay).push(item);
        }

        for (const [day, items] of dayGroups.entries()) {
            text += `🗓 <b>${day}:</b>\n`;
            for (const item of items) {
                const dateObj = new Date(item.dueDate);
                const astanaTime = new Intl.DateTimeFormat('ru-RU', {
                    timeZone: 'Asia/Almaty',
                    hour: '2-digit',
                    minute: '2-digit'
                }).format(dateObj);

                let badge = '';
                if (item.diffMinutes <= 60 && item.diffMinutes > 0) {
                    badge = `⏰ <b>Осталось ${item.diffMinutes} мин.</b>`;
                } else if (item.diffDays <= 0) {
                    badge = '⚠️ <b>Сегодня</b>';
                } else if (item.diffDays === 1) {
                    badge = '📌 <b>Завтра</b>';
                } else {
                    badge = `⏳ через ${item.diffDays} дн.`;
                }

                const icon = item.isQuiz ? '📝' : '📌';
                text += `${icon} <b>${esc(item.courseName)}</b> — <a href="${item.link}">${esc(item.title)}</a>\n` +
                        `⏰ До <b>${astanaTime}</b> (${badge})\n\n`;
            }
        }

        if (result.completedCount && result.completedCount > 0) {
            text += `✅ <i>Сдано вами: <b>${result.completedCount}</b> заданий (скрыты из напоминаний)</i>\n\n`;
        }

        text += `💡 <i>Показаны задачи на эту неделю: <b>${weekAssignments.length}</b>. Всего в семестре: <b>${assignments.length}</b>.</i>`;
        return staleBanner + text;
    }

    // Режим всего семестра ('all') или просмотр одного курса
    let text = targetCourse
        ? `🔍 <b>Дедлайны по предмету: ${esc(targetCourse)}</b>\n\n`
        : (isGauharUser
            ? `📚 <b>Все дедлайны Moodle LMS на семестр для Гаухар:</b> 🧠\n\n`
            : `📚 <b>Все актуальные дедлайны Moodle LMS на семестр:</b>\n\n`);

    for (let i = 0; i < Math.min(assignments.length, 12); i++) {
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
            badge = `⏰ <b>Осталось ${item.diffMinutes} мин.</b>`;
        } else if (item.diffDays <= 0) {
            badge = '⚠️ <b>Сегодня</b>';
        } else if (item.diffDays === 1) {
            badge = '📌 <b>Завтра</b>';
        } else {
            badge = `⏳ через ${item.diffDays} дн.`;
        }

        const icon = item.isQuiz ? '📝' : '📌';
        text += `${icon} <b>${esc(item.courseName)}</b>\n` +
                `👉 <a href="${item.link}">${esc(item.title)}</a>\n` +
                `⏰ Дедлайн: <b>${astanaTime}</b> (${badge})\n\n`;
    }

    if (result.completedCount && result.completedCount > 0) {
        text += `✅ <i>Сдано вами: <b>${result.completedCount}</b> заданий (скрыты из напоминаний)</i>\n\n`;
    }

    text += `<i>💡 Нажмите на название задания, чтобы сразу перейти на страницу сдачи.</i>`;
    return staleBanner + text;
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
        text = `⏰ <b>Гаухар, дедлайн в LMS: ${minsLeft} мин.</b>\n\n` +
            `🧠 <b>Напоминаем о сдаче задания:</b>\n` +
            `📚 <b>Предмет:</b> ${esc(event.courseName)}\n` +
            `📌 <b>Задание:</b> <code>${esc(event.title)}</code>\n` +
            `⏰ <b>Срок сдачи:</b> <b>${astanaTime}</b> (через ${minsLeft} мин.)\n\n` +
            `🚀 <i>Перейдите по кнопке ниже и отправьте работу вовремя.</i> 👇`;
    } else {
        text = `⏰ <b>Горящий дедлайн в LMS: 1 час</b>\n\n` +
            `📚 <b>Курс:</b> ${esc(event.courseName)}\n` +
            `📌 <b>Задание:</b> <code>${esc(event.title)}</code>\n` +
            `⏰ <b>Окончание приёма:</b> <b>${astanaTime}</b> (осталось <b>${minsLeft} мин.</b>)\n\n` +
            `⚡️ Не откладывайте на последние минуты — сдайте работу вовремя.`;
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
    isAllowedLmsUrl,
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
    getUserCompletedLmsEvents,
    markLmsEventCompleted,
    markAllLmsEventsCompleted,
    unmarkLmsEventCompleted,
    clearUserCompletedLmsEvents,
    getEndOfWeek,
    _lmsUserSessionsMemory: lmsUserSessionsMemory,
    _lmsSubscribersMemory: lmsSubscribersMemory,
    _lmsCompletedEventsMemory: lmsCompletedEventsMemory,
    _lmsCacheMemory: lmsCacheMemory,
    _lmsLastSuccessfulSnapshot: lmsLastSuccessfulSnapshot
};
