// api/bot/schedule.js
// Модуль интеграции с расписанием занятий My DU (my-du.astanait.edu.kz)
// Поддерживает:
// 1. Получение расписания академических групп (SE-2301, IT-2204 и др.) через /api/edu-process/classSchedule/search
// 2. Персональное расписание студента через /api/edu-process/classSchedule/student/me/search
// 3. Авторизацию по OAuth коду Microsoft и автоматическое обновление токенов (/api/auth/refresh)
// 4. Форматирование расписания (сегодня, завтра, неделя) и генерацию iCal (.ics) календаря

const statsEngine = require('../stats/engine.js');

const MY_DU_BASE_URL = (process.env.MY_DU_BASE_URL || 'https://my-du.astanait.edu.kz').replace(/\/+$/, '');
const GAUHAR_CHAT_ID = '1365231049';
const SCHEDULE_CACHE_TTL_MS = 15 * 60 * 1000; // 15 минут SWR-кэш

function isGauhar(chatId) {
    return String(chatId).trim() === GAUHAR_CHAT_ID;
}

// In-memory хранилище для serverless / тестов
const scheduleUserSessionsMemory = new Map();
const scheduleSubscribersMemory = new Set();
const scheduleCacheMemory = new Map(); // key -> { timestamp, data }
const scheduleLastSuccessfulSnapshot = new Map();

/**
 * Экранирование HTML для Telegram HTML parse mode
 */
function esc(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/**
 * Валидация и нормализация названия академической группы (например: "SE 2301" -> "SE-2301")
 */
function normalizeGroupName(rawName) {
    if (!rawName || typeof rawName !== 'string') return null;
    let clean = rawName.trim().toUpperCase();
    clean = clean.replace(/[\s_]+/g, '-');
    // Разрешаем только латиницу, цифры, дефис (длина 3-20 символов)
    if (!/^[A-Z0-9]{2,10}-[A-Z0-9]{2,10}$/i.test(clean) && !/^[A-Z0-9]{3,20}$/i.test(clean)) {
        return null;
    }
    return clean;
}

/**
 * Получить текущее время и день недели по часовому поясу Астаны (UTC+5 / Asia/Almaty)
 */
function getAstanaDateInfo(baseDate = new Date()) {
    const formatter = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Almaty',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23'
    });
    const parts = formatter.formatToParts(baseDate);
    const map = {};
    for (const p of parts) map[p.type] = p.value;

    const dateStr = `${map.year}-${map.month}-${map.day}`;
    const timeStr = `${map.hour}:${map.minute}`;

    // День недели (1 = Пн, 7 = Вс)
    const localDate = new Date(`${dateStr}T12:00:00Z`);
    const dayOfWeek = localDate.getUTCDay() === 0 ? 7 : localDate.getUTCDay();

    return {
        dateStr,
        timeStr,
        dayOfWeek,
        year: parseInt(map.year, 10),
        month: parseInt(map.month, 10),
        day: parseInt(map.day, 10),
        hour: parseInt(map.hour, 10),
        minute: parseInt(map.minute, 10)
    };
}

/**
 * Название дня недели на русском
 */
function getDayTitle(dayNumber) {
    const days = {
        1: 'Понедельник',
        2: 'Вторник',
        3: 'Среда',
        4: 'Четверг',
        5: 'Пятница',
        6: 'Суббота',
        7: 'Воскресенье'
    };
    return days[dayNumber] || `День ${dayNumber}`;
}

/**
 * Получить сессию пользователя
 */
async function getUserDuSession(chatId) {
    if (!chatId) return null;
    const strId = String(chatId).trim();

    if (scheduleUserSessionsMemory.has(strId)) {
        return scheduleUserSessionsMemory.get(strId);
    }

    try {
        if (typeof statsEngine.kvCommand === 'function') {
            const raw = await statsEngine.kvCommand(['GET', `gm:user:${strId}:du_session`]);
            if (raw) {
                const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
                scheduleUserSessionsMemory.set(strId, parsed);
                return parsed;
            }
        }
    } catch (err) {
        console.warn(`getUserDuSession Redis error for ${strId}:`, err.message);
    }

    // Проверяем сохраненную группу
    try {
        if (typeof statsEngine.kvCommand === 'function') {
            const grp = await statsEngine.kvCommand(['GET', `gm:user:${strId}:schedule_group`]);
            if (grp) {
                const sessionObj = { groupName: String(grp).trim() };
                scheduleUserSessionsMemory.set(strId, sessionObj);
                return sessionObj;
            }
        }
    } catch { /* Ignore */ }

    return null;
}

/**
 * Сохранить сессию My DU для пользователя
 */
async function saveUserDuSession(chatId, sessionData) {
    if (!chatId || !sessionData) return false;
    const strId = String(chatId).trim();

    const existing = scheduleUserSessionsMemory.get(strId) || {};
    const updated = { ...existing, ...sessionData, updatedAt: Date.now() };

    scheduleUserSessionsMemory.set(strId, updated);
    scheduleSubscribersMemory.add(strId);

    try {
        if (typeof statsEngine.kvCommand === 'function') {
            await statsEngine.kvCommand(['SET', `gm:user:${strId}:du_session`, JSON.stringify(updated), 'EX', 7776000]);
            if (updated.groupName) {
                await statsEngine.kvCommand(['SET', `gm:user:${strId}:schedule_group`, updated.groupName, 'EX', 7776000]);
            }
            await statsEngine.kvCommand(['SADD', 'gm:schedule_subscribers', strId]);
        }
    } catch (err) {
        console.warn(`saveUserDuSession Redis error for ${strId}:`, err.message);
    }

    return true;
}

/**
 * Сохранить только академическую группу студента
 */
async function saveUserGroup(chatId, groupName) {
    const cleanGroup = normalizeGroupName(groupName);
    if (!cleanGroup) return false;
    return saveUserDuSession(chatId, { groupName: cleanGroup });
}

/**
 * Удалить данные расписания пользователя
 */
async function deleteUserDuSession(chatId) {
    if (!chatId) return false;
    const strId = String(chatId).trim();

    scheduleUserSessionsMemory.delete(strId);
    scheduleSubscribersMemory.delete(strId);

    try {
        if (typeof statsEngine.kvCommand === 'function') {
            await statsEngine.kvCommand(['DEL', `gm:user:${strId}:du_session`]);
            await statsEngine.kvCommand(['DEL', `gm:user:${strId}:schedule_group`]);
            await statsEngine.kvCommand(['SREM', 'gm:schedule_subscribers', strId]);
        }
    } catch (err) {
        console.warn(`deleteUserDuSession Redis error for ${strId}:`, err.message);
    }

    return true;
}

/**
 * Получить список всех подписчиков на расписание
 */
async function getAllScheduleSubscribers() {
    const subscribers = new Set(scheduleSubscribersMemory);
    try {
        if (typeof statsEngine.kvCommand === 'function') {
            const members = await statsEngine.kvCommand(['SMEMBERS', 'gm:schedule_subscribers']);
            if (Array.isArray(members)) {
                for (const m of members) if (m) subscribers.add(String(m).trim());
            }
        }
    } catch (err) {
        console.warn('getAllScheduleSubscribers error:', err.message);
    }
    return Array.from(subscribers);
}

let systemDuSessionMemory = null;

async function getSystemDuSession() {
    if (systemDuSessionMemory) return systemDuSessionMemory;
    try {
        if (typeof statsEngine.kvCommand === 'function') {
            const raw = await statsEngine.kvCommand(['GET', 'gm:system:du_session']);
            if (raw) {
                const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
                systemDuSessionMemory = parsed;
                return parsed;
            }
        }
    } catch {}
    return null;
}

async function saveSystemDuSession(sessionData) {
    if (!sessionData) return false;
    const existing = systemDuSessionMemory || {};
    const updated = { ...existing, ...sessionData, updatedAt: Date.now() };
    systemDuSessionMemory = updated;
    try {
        if (typeof statsEngine.kvCommand === 'function') {
            await statsEngine.kvCommand(['SET', 'gm:system:du_session', JSON.stringify(updated), 'EX', 7776000]);
        }
    } catch {}
    return true;
}

/**
 * Обмен одноразового OAuth-кода Microsoft на токены авторизации
 */
async function loginWithOAuthCode(chatId, code) {
    if (!code || typeof code !== 'string') {
        return { ok: false, error: 'Код авторизации не передан' };
    }

    try {
        const payload = {
            provider: 'microsoft',
            token: code.trim(),
            email: null,
            device_info: {
                platform: 'android',
                device_id: 'a1b2c3d4-e5f6-7890-abcd-' + String(chatId || '0').slice(-12).padStart(12, '0')
            },
            avatar_url: null,
            first_name: null,
            last_name: null
        };

        const res = await fetch(`${MY_DU_BASE_URL}/api/auth/external-login`, {
            method: 'POST',
            headers: {
                'Accept': 'application/json, text/plain, */*',
                'Content-Type': 'application/json',
                'User-Agent': 'okhttp/4.9.2 (Linux; Android 14; MyDU/1.0)'
            },
            body: JSON.stringify(payload)
        });

        if (!res.ok) {
            const errText = await res.text();
            return { ok: false, error: `Ошибка авторизации (${res.status}): ${errText.slice(0, 100)}` };
        }

        // Извлекаем токены из cookies или тела ответа
        let accessToken = null;
        let refreshToken = null;

        const setCookie = res.headers.get('set-cookie');
        if (setCookie) {
            const accMatch = setCookie.match(/access_token=([^;]+)/);
            if (accMatch) accessToken = accMatch[1];
            const refMatch = setCookie.match(/refresh_token=([^;]+)/);
            if (refMatch) refreshToken = refMatch[1];
        }

        const data = await res.json().catch(() => ({}));
        if (data.access_token) accessToken = data.access_token;
        if (data.refresh_token) refreshToken = data.refresh_token;

        if (!accessToken && !refreshToken) {
            return { ok: false, error: 'Сервер не вернул токен сессии' };
        }

        const expiresAt = Date.now() + 15 * 60 * 1000; // 15 мин
        await saveUserDuSession(chatId, {
            accessToken,
            refreshToken,
            tokenExpiresAt: expiresAt
        });

        // Также сохраняем в общий пул системы для обслуживания запросов /set_group других студентов
        await saveSystemDuSession({
            accessToken,
            refreshToken,
            tokenExpiresAt: expiresAt
        });

        return { ok: true, data };
    } catch (err) {
        return { ok: false, error: err.message };
    }
}

/**
 * Прямая авторизация через JWT токен (access_token или refresh_token из Cookies F12)
 */
async function loginWithToken(chatId, tokenStr) {
    if (!tokenStr || typeof tokenStr !== 'string') {
        return { ok: false, error: 'Токен не передан' };
    }
    const cleanToken = tokenStr.trim().replace(/^(?:access_token|refresh_token)=/, '').replace(/;.*$/, '');

    // Пробуем использовать как refresh_token
    const fresh = await refreshAccessToken(cleanToken);
    let accessToken = fresh;
    let refreshToken = cleanToken;

    if (!fresh) {
        // Значит это уже действующий access_token
        accessToken = cleanToken;
        refreshToken = null;
    }

    const expiresAt = Date.now() + 15 * 60 * 1000;
    await saveUserDuSession(chatId, {
        accessToken,
        refreshToken: refreshToken || undefined,
        tokenExpiresAt: expiresAt
    });

    if (refreshToken) {
        await saveSystemDuSession({
            accessToken,
            refreshToken,
            tokenExpiresAt: expiresAt
        });
    }

    return { ok: true, accessToken, refreshToken };
}

/**
 * Обновление access_token через /api/auth/refresh
 */
async function refreshAccessToken(refreshToken) {
    if (!refreshToken) return null;
    try {
        const res = await fetch(`${MY_DU_BASE_URL}/api/auth/refresh`, {
            method: 'POST',
            headers: {
                'Cookie': `refresh_token=${refreshToken}`,
                'User-Agent': 'GradeMasterBot/2.0'
            }
        });
        if (!res.ok) return null;
        const setCookie = res.headers.get('set-cookie');
        let newAccess = null;
        if (setCookie) {
            const m = setCookie.match(/access_token=([^;]+)/);
            if (m) newAccess = m[1];
        }
        const body = await res.json().catch(() => ({}));
        return newAccess || body.access_token || null;
    } catch {
        return null;
    }
}

/**
 * Получить действующий токен авторизации для пользователя или системный токен
 */
async function getValidTokenForUser(chatId) {
    let session = await getUserDuSession(chatId);
    let refreshToken = session?.refreshToken || process.env.MY_DU_REFRESH_TOKEN;
    let accessToken = session?.accessToken || process.env.MY_DU_ACCESS_TOKEN;

    if (!refreshToken && !accessToken) {
        const sys = await getSystemDuSession();
        if (sys?.refreshToken) refreshToken = sys.refreshToken;
        if (sys?.accessToken) accessToken = sys.accessToken;
    }

    if (accessToken && session?.tokenExpiresAt && Date.now() < session.tokenExpiresAt) {
        return accessToken;
    }

    if (refreshToken) {
        const fresh = await refreshAccessToken(refreshToken);
        if (fresh) {
            if (chatId) {
                await saveUserDuSession(chatId, {
                    accessToken: fresh,
                    tokenExpiresAt: Date.now() + 15 * 60 * 1000
                });
            }
            await saveSystemDuSession({
                accessToken: fresh,
                refreshToken,
                tokenExpiresAt: Date.now() + 15 * 60 * 1000
            });
            return fresh;
        }
    }

    return accessToken || null;
}

let cachedAcademicPeriod = null;
let cachedAcademicPeriodTime = 0;

/**
 * Получить текущий академический год, семестр и неделю
 */
async function getAcademicPeriod(token) {
    if (cachedAcademicPeriod && (Date.now() - cachedAcademicPeriodTime < 3600000)) {
        return cachedAcademicPeriod;
    }
    let studyYear = 2026;
    let term = 1;
    let weekNumber = 4;
    try {
        if (token) {
            const headers = {
                'Authorization': `Bearer ${token}`,
                'User-Agent': 'okhttp/4.9.2 (Linux; Android 14; MyDU/1.0)'
            };
            const ytRes = await fetch(`${MY_DU_BASE_URL}/api/edu-process/currentYearTerm`, { headers });
            if (ytRes.ok) {
                const yt = await ytRes.json();
                if (yt.currentStudyYear) studyYear = yt.currentStudyYear;
                if (yt.currentStudyTerm) term = yt.currentStudyTerm;
            }
            const cwRes = await fetch(`${MY_DU_BASE_URL}/api/edu-process/classSchedule/studentCurrentWeek?studyYear=${studyYear}&term=${term}`, { headers });
            if (cwRes.ok) {
                const cw = await cwRes.json();
                if (cw.CurrentWeek) weekNumber = cw.CurrentWeek;
            }
            cachedAcademicPeriod = { studyYear, term, weekNumber };
            cachedAcademicPeriodTime = Date.now();
        }
    } catch {}
    return cachedAcademicPeriod || { studyYear, term, weekNumber };
}

/**
 * Парсер слотов расписания из API ответа My DU
 */
function parseScheduleData(data) {
    if (!data || typeof data !== 'object') {
        return { ok: false, error: 'Пустой ответ от сервера расписания' };
    }

    const times = (data.times || []).map(t => {
        const title = t.title || (t.startTime && t.endTime ? `${t.startTime} - ${t.endTime}` : '');
        let startTime = t.startTime || '';
        let endTime = t.endTime || '';
        if (!startTime && (title.includes('-') || title.includes('–'))) {
            const parts = title.split(/[-–]/).map(s => s.trim());
            startTime = parts[0] || '';
            endTime = parts[1] || '';
        }
        return {
            id: t.id,
            shiftNumber: t.shiftNumber,
            orderNumber: t.orderNumber,
            title,
            startTime,
            endTime
        };
    });

    const timesMap = new Map(times.map(t => [String(t.id), t]));
    const weekDays = (data.weekDays || []).map(w => ({
        id: w.id,
        title: w.title || w.name || ''
    }));
    const daysMap = new Map(weekDays.map(w => [String(w.id), w]));

    const days = [1, 2, 3, 4, 5, 6].map(d => ({
        dayOfWeek: d,
        dayTitle: getDayTitle(d),
        lessons: []
    }));
    const dayBuckets = new Map(days.map(d => [d.dayOfWeek, d]));

    const slots = data.slots || [];
    for (const slot of slots) {
        const slotDayNum = Number(slot.weekDay?.id || slot.weekDayId);
        const items = slot.items || [];

        for (const item of items) {
            // Пропускаем пустые "окна"
            const subject = (item.subjectName || item.name || '').trim();
            if (!subject) continue;

            const dayNum = Number(item.weekDayId || item.weekDay?.id || slotDayNum);
            const bucket = dayBuckets.get(dayNum);
            if (!bucket) continue;

            // Время пары из объекта classTime или timesMap
            const ct = item.classTime || timesMap.get(String(item.classTimeId || slot.classTimeId)) || {};
            const title = ct.title || (ct.startTime && ct.endTime ? `${ct.startTime} - ${ct.endTime}` : '09:00 - 09:50');
            let startTime = ct.startTime || '';
            let endTime = ct.endTime || '';
            if (!startTime && (title.includes('-') || title.includes('–'))) {
                const parts = title.split(/[-–]/).map(s => s.trim());
                startTime = parts[0] || '';
                endTime = parts[1] || '';
            }

            const building = item.building || '';
            const classroom = item.classroom || '';
            const roomFormatted = [building, classroom].filter(Boolean).join('.');

            const lesson = {
                id: item.uid || item.id || slot.id,
                time: title,
                startTime: startTime || '09:00',
                endTime: endTime || '09:50',
                orderNumber: ct.orderNumber || 1,
                subjectName: subject,
                lessonTypeName: item.lessonTypeName || item.lessonType || '',
                classroom: roomFormatted || 'Аудитория уточняется',
                building,
                room: classroom,
                teacherName: item.teacherName || item.replacementTeacherName || '',
                academicGroupName: item.academicGroupName || item.group || '',
                online: Boolean(item.online)
            };

            bucket.lessons.push(lesson);
        }
    }

    // Сортировка занятий внутри каждого дня по времени
    for (const d of days) {
        d.lessons.sort((a, b) => (a.orderNumber || 0) - (b.orderNumber || 0) || a.startTime.localeCompare(b.startTime));
    }

    return {
        ok: true,
        weekNumber: data.weekNumber || 1,
        studyYear: data.studyYear || '',
        term: data.term || 1,
        days
    };
}

/**
 * Загрузить расписание для пользователя (персональное или группы)
 */
async function getScheduleForUser(chatId, options = {}) {
    const strId = String(chatId).trim();
    const session = await getUserDuSession(strId);

    const groupName = options.groupName || session?.groupName;
    const token = await getValidTokenForUser(strId);

    const cacheKey = `sched:${strId}:${groupName || 'me'}:${options.weekNumber || 'curr'}`;
    const cached = scheduleCacheMemory.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp < SCHEDULE_CACHE_TTL_MS)) {
        return cached.data;
    }

    // Если нет ни группы, ни персональной сессии
    if (!groupName && !session?.refreshToken && !token) {
        return {
            ok: false,
            notConfigured: true,
            error: 'Группа не выбрана. Используйте /set_group ВАША_ГРУППА (например: /set_group SE-2301)'
        };
    }

    // Если токена нет вовсе (пользователь еще не передал и нет глобального)
    if (!token) {
        return {
            ok: false,
            requiresAuth: true,
            groupName: groupName || null,
            error: 'Для загрузки расписания требуется авторизация через My DU'
        };
    }

    try {
        const period = await getAcademicPeriod(token);
        const targetWeek = Number(options.weekNumber || period.weekNumber || 4);

        // Для авторизованных студентов используем персональный эндпоинт student/me/search
        let res = null;
        let usedPersonalEndpoint = true;

        if (groupName && !token) {
            usedPersonalEndpoint = false;
        }

        if (usedPersonalEndpoint) {
            res = await fetch(`${MY_DU_BASE_URL}/api/edu-process/classSchedule/student/me/search`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`,
                    'Cookie': `access_token=${token}`,
                    'User-Agent': 'okhttp/4.9.2 (Linux; Android 14; MyDU/1.0)'
                },
                body: JSON.stringify({
                    filters: [
                        { id: 'studyYear', value: period.studyYear },
                        { id: 'term', value: period.term },
                        { id: 'weekNumber', value: targetWeek }
                    ]
                })
            });
        }

        // Если личный запрос не прошел или требовался глобальный поиск группы
        if (!res || !res.ok) {
            if (res && res.status === 401) {
                return { ok: false, sessionExpired: true, error: 'Сессия My DU истекла' };
            }

            const searchFilters = [];
            if (groupName) searchFilters.push({ id: 'groupId', value: groupName });
            if (targetWeek) searchFilters.push({ id: 'weekNumber', value: targetWeek });

            res = await fetch(`${MY_DU_BASE_URL}/api/edu-process/classSchedule/search`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`,
                    'Cookie': `access_token=${token}`,
                    'User-Agent': 'okhttp/4.9.2 (Linux; Android 14; MyDU/1.0)'
                },
                body: JSON.stringify({
                    filters: searchFilters,
                    sorting: [],
                    start: 0,
                    size: 100
                })
            });
        }

        if (!res.ok) {
            if (res.status === 401) {
                return { ok: false, sessionExpired: true, error: 'Сессия My DU истекла' };
            }
            if (res.status === 403) {
                return {
                    ok: false,
                    error: 'Доступ ограничен: университетский портал My DU разрешает студентам просмотр расписания только своих зарегистрированных дисциплин.'
                };
            }
            throw new Error(`HTTP ${res.status}: ${res.statusText}`);
        }

        const rawData = await res.json();
        const parsed = parseScheduleData(rawData);
        if (parsed.ok) {
            let effectiveGroup = groupName;
            if (!effectiveGroup && Array.isArray(parsed.days)) {
                for (const d of parsed.days) {
                    for (const l of d.lessons) {
                        if (l.academicGroupName) {
                            effectiveGroup = l.academicGroupName;
                            break;
                        }
                    }
                    if (effectiveGroup) break;
                }
            }
            if (effectiveGroup && !groupName) {
                await saveUserDuSession(strId, { groupName: effectiveGroup });
            }
            parsed.groupName = effectiveGroup || groupName;
            scheduleCacheMemory.set(cacheKey, { timestamp: Date.now(), data: parsed });
            scheduleLastSuccessfulSnapshot.set(cacheKey, { timestamp: Date.now(), data: parsed });
        }
        return parsed;

    } catch (err) {
        const snapshot = scheduleLastSuccessfulSnapshot.get(cacheKey);
        if (snapshot) {
            return { ...snapshot.data, fromCache: true, cacheWarning: true };
        }
        return { ok: false, error: err.message };
    }
}

/**
 * Определение эмодзи и типа занятия
 */
function getLessonBadge(lessonType) {
    if (!lessonType) return '🔹';
    const lower = String(lessonType).toLowerCase();
    if (lower.includes('lec') || lower.includes('лекц')) return '📖 Лекция';
    if (lower.includes('prac') || lower.includes('практ')) return '✍️ Практика';
    if (lower.includes('lab') || lower.includes('лаб')) return '🔬 Лабораторная';
    return `🔹 ${lessonType}`;
}

/**
 * Форматирование сообщения с расписанием (на сегодня, завтра или всю неделю)
 */
function formatScheduleMessage(scheduleResult, mode = 'today', options = {}) {
    const isGauharUser = Boolean(options.isGauhar);
    const astana = getAstanaDateInfo();

    if (!scheduleResult || !scheduleResult.ok) {
        if (scheduleResult?.notConfigured) {
            return isGauharUser
                ? `📅 <b>Гаухар, расписание пока не подключено!</b> 🧠\n\n` +
                  `Напиши свою учебную группу, чтобы бот знал твои пары:\n` +
                  `👉 <code>/set_group ТВОЯ_ГРУППА</code> <i>(например: <code>/set_group SE-2301</code>)</i>`
                : `📅 <b>Расписание занятий My DU</b>\n\n` +
                  `Укажите вашу академическую группу:\n` +
                  `👉 <code>/set_group НАЗВАНИЕ_ГРУППЫ</code> <i>(например: <code>/set_group SE-2301</code>)</i>\n\n` +
                  `<i>💡 После этого бот будет присылать расписание на каждый день и напоминать о парах каждое утро!</i>`;
        }
        if (scheduleResult?.requiresAuth) {
            return `🔐 <b>Требуется подключение My DU</b>\n\n` +
                   `Для отображения расписания перейдите на портал <a href="https://my-du.astanait.edu.kz/">my-du.astanait.edu.kz</a>,\n` +
                   `войдите через аккаунт Microsoft и отправьте боту ссылку авторизации:\n\n` +
                   `<code>/set_schedule ССЫЛКА_ИЛИ_ТОКЕН</code>`;
        }
        return `⚠️ <b>Не удалось загрузить расписание:</b> ${esc(scheduleResult?.error || 'Неизвестная ошибка')}`;
    }

    const { days = [], groupName, weekNumber } = scheduleResult;
    const headerPrefix = groupName ? `👥 Группа: <b>${esc(groupName)}</b>` : '🎓 <b>Моё расписание</b>';

    // РЕЖИМ 1: НА СЕГОДНЯ
    if (mode === 'today') {
        const targetDay = astana.dayOfWeek;
        if (targetDay === 7) {
            return `🎉 <b>Воскресенье — выходной!</b> 🏖\n\n` +
                   `${headerPrefix}\n` +
                   `Сегодня занятий нет. Отдыхайте и набирайтесь сил перед новой учебной неделей! ✨\n\n` +
                   `<i>Посмотреть пары на завтра: <code>/tomorrow</code></i>`;
        }

        const dayData = days.find(d => d.dayOfWeek === targetDay);
        const lessons = dayData?.lessons || [];

        let msg = `📅 <b>Расписание на СЕГОДНЯ (${getDayTitle(targetDay)}):</b>\n` +
                  `${headerPrefix} | 🗓 Неделя: <b>${weekNumber}</b>\n` +
                  `━━━━━━━━━━━━━━━━━━━━\n\n`;

        if (lessons.length === 0) {
            msg += `🎉 <b>Сегодня пар нет!</b> Свободный день для отдыха или проектов 🚀\n`;
            return msg;
        }

        for (let i = 0; i < lessons.length; i++) {
            const l = lessons[i];
            const badge = getLessonBadge(l.lessonTypeName);
            const numEmoji = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣'][i] || `[${i + 1}]`;

            // Статус пары относительно текущего времени
            let statusBadge = '';
            if (l.startTime && l.endTime) {
                const nowTime = astana.timeStr;
                if (nowTime > l.endTime) {
                    statusBadge = ' <i>(завершена ✅)</i>';
                } else if (nowTime >= l.startTime && nowTime <= l.endTime) {
                    statusBadge = ' <b>(ИДЁТ СЕЙЧАС ⏳)</b>';
                }
            }

            msg += `${numEmoji} <b>${esc(l.time)}</b>${statusBadge}\n` +
                   `📚 <b>${esc(l.subjectName)}</b>\n` +
                   `🏷 ${badge} | 📍 <b>${esc(l.classroom)}</b>\n`;
            if (l.teacherName) {
                msg += `👤 Преподаватель: <i>${esc(l.teacherName)}</i>\n`;
            }
            msg += `\n`;
        }

        msg += isGauharUser
            ? `Гаухар, не опаздывай на пары! 🏃‍♀️☕️`
            : `💡 <i>Успешных занятий и продуктивного учебного дня!</i> 🎓`;
        return msg;
    }

    // РЕЖИМ 2: НА ЗАВТРА
    if (mode === 'tomorrow') {
        const tomorrowDay = astana.dayOfWeek === 7 ? 1 : astana.dayOfWeek + 1;
        if (tomorrowDay === 7) {
            return `🎉 <b>Завтра Воскресенье — пар нет!</b> 🏖\n\n` +
                   `${headerPrefix}\n` +
                   `Можно выспаться и провести день в свое удовольствие ✨`;
        }

        const dayData = days.find(d => d.dayOfWeek === tomorrowDay);
        const lessons = dayData?.lessons || [];

        let msg = `🌅 <b>Расписание на ЗАВТРА (${getDayTitle(tomorrowDay)}):</b>\n` +
                  `${headerPrefix} | 🗓 Неделя: <b>${weekNumber}</b>\n` +
                  `━━━━━━━━━━━━━━━━━━━━\n\n`;

        if (lessons.length === 0) {
            msg += `🎉 <b>Завтра пар нет!</b> Отличный повод отдохнуть или подтянуть дедлайны 🚀\n`;
            return msg;
        }

        for (let i = 0; i < lessons.length; i++) {
            const l = lessons[i];
            const badge = getLessonBadge(l.lessonTypeName);
            const numEmoji = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣'][i] || `[${i + 1}]`;

            msg += `${numEmoji} <b>${esc(l.time)}</b>\n` +
                   `📚 <b>${esc(l.subjectName)}</b>\n` +
                   `🏷 ${badge} | 📍 <b>${esc(l.classroom)}</b>\n`;
            if (l.teacherName) {
                msg += `👤 Преподаватель: <i>${esc(l.teacherName)}</i>\n`;
            }
            msg += `\n`;
        }

        msg += isGauharUser
            ? `Гаухар, поставь будильник заранее и собери рюкзак с вечера! ⏰🎒`
            : `💡 <i>Поставьте будильник заранее, чтобы начать утро без спешки!</i> ⏰`;
        return msg;
    }

    // РЕЖИМ 3: НА ВСЮ НЕДЕЛЮ
    let msg = `📅 <b>Расписание на неделю:</b>\n` +
              `${headerPrefix} | 🗓 Неделя: <b>${weekNumber}</b>\n` +
              `━━━━━━━━━━━━━━━━━━━━\n\n`;

    for (let dayNum = 1; dayNum <= 6; dayNum++) {
        const dayData = days.find(d => d.dayOfWeek === dayNum);
        const lessons = dayData?.lessons || [];

        msg += `🗓 <b>${getDayTitle(dayNum)}</b>\n`;
        if (lessons.length === 0) {
            msg += `  <i>Пар нет (выходной)</i>\n\n`;
            continue;
        }

        for (const l of lessons) {
            const badge = l.lessonTypeName ? `[${l.lessonTypeName}]` : '';
            msg += `  • <code>${esc(l.time)}</code> — <b>${esc(l.subjectName)}</b> ${badge} (ауд. <b>${esc(l.classroom)}</b>)\n`;
        }
        msg += `\n`;
    }

    return msg;
}

function escapeIcsValue(str) {
    if (!str) return '';
    return String(str)
        .replace(/\\/g, '\\\\')
        .replace(/;/g, '\\;')
        .replace(/,/g, '\\,')
        .replace(/\r?\n/g, '\\n');
}

/**
 * Генерация iCal (.ics) календаря для экспорта в Google / Apple Calendar
 */
function generateScheduleIcs(scheduleResult) {
    if (!scheduleResult || !scheduleResult.ok || !Array.isArray(scheduleResult.days)) {
        return '';
    }

    let ics = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//GradeMaster//Astana IT University Schedule//RU',
        'CALSCALE:GREGORIAN',
        'METHOD:PUBLISH',
        `X-WR-CALNAME:Расписание ${escapeIcsValue(scheduleResult.groupName || 'AITU')}`,
        'X-WR-TIMEZONE:Asia/Almaty'
    ];

    const nowIso = new Date().toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';

    for (const day of scheduleResult.days) {
        for (const lesson of day.lessons) {
            const safeSubj = (lesson.subjectName || '').slice(0, 10).replace(/[^a-zA-Z0-9]/g, '');
            const uid = `gm-sched-${day.dayOfWeek}-${lesson.orderNumber}-${safeSubj || 'class'}@grademaster.aitu`;
            const summary = escapeIcsValue(`${lesson.subjectName || 'Занятие'} (${lesson.lessonTypeName || 'Пара'})`);
            const location = escapeIcsValue(lesson.classroom || '');
            const desc = escapeIcsValue(`Преподаватель: ${lesson.teacherName || 'Не указан'}\nГруппа: ${lesson.academicGroupName || scheduleResult.groupName || ''}`);

            ics.push('BEGIN:VEVENT');
            ics.push(`UID:${uid}`);
            ics.push(`DTSTAMP:${nowIso}`);
            ics.push(`SUMMARY:${summary}`);
            ics.push(`LOCATION:${location}`);
            ics.push(`DESCRIPTION:${desc}`);
            ics.push('STATUS:CONFIRMED');
            ics.push('END:VEVENT');
        }
    }

    ics.push('END:VCALENDAR');
    return ics.join('\r\n');
}

module.exports = {
    normalizeGroupName,
    getDayTitle,
    getAstanaDateInfo,
    getUserDuSession,
    saveUserDuSession,
    saveUserGroup,
    deleteUserDuSession,
    getAllScheduleSubscribers,
    loginWithOAuthCode,
    loginWithToken,
    refreshAccessToken,
    getValidTokenForUser,
    parseScheduleData,
    getScheduleForUser,
    formatScheduleMessage,
    generateScheduleIcs,
    getSystemDuSession,
    saveSystemDuSession,
    _scheduleUserSessionsMemory: scheduleUserSessionsMemory,
    _scheduleSubscribersMemory: scheduleSubscribersMemory,
    _scheduleCacheMemory: scheduleCacheMemory
};
