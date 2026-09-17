// api/bot/aitu.js
// Модуль интеграции с платформой learn.astanait.edu.kz (Open edX)

const os = require('os');
const path = require('path');
const fs = require('fs');

const DEFAULT_COURSES = [
    { id: 'course-v1:AITU+PHIL01+26-27_C1_Y3', name: 'Philosophy' },
    { id: 'course-v1:AITU+Cloud101+26-27_C1_Y3', name: 'Cloud Technologies' },
    { id: 'course-v1:AITU+PM_NI_01+26-27_C1_Y3', name: 'Project Management' }
];

const STORAGE_PREFIX = 'GM_AITU_SESSION:';
let memorySessionCache = null;

function getCacheFilePath() {
    try {
        return path.join(os.tmpdir(), 'gm_aitu_session.json');
    } catch {
        return null;
    }
}

function readLocalCache() {
    if (memorySessionCache && memorySessionCache.session) {
        return memorySessionCache.session;
    }
    const cacheFile = getCacheFilePath();
    if (cacheFile) {
        try {
            if (fs.existsSync(cacheFile)) {
                const raw = fs.readFileSync(cacheFile, 'utf8');
                const data = JSON.parse(raw);
                if (data && data.session) {
                    memorySessionCache = data;
                    return data.session;
                }
            }
        } catch {
            // Ignore cache errors
        }
    }
    return null;
}

function writeLocalCache(session) {
    if (!session) return;
    memorySessionCache = { session: String(session).trim(), updatedAt: Date.now() };
    process.env.AITU_SESSION_ID = memorySessionCache.session;
    const cacheFile = getCacheFilePath();
    if (cacheFile) {
        try {
            fs.writeFileSync(cacheFile, JSON.stringify(memorySessionCache), 'utf8');
        } catch {
            // Ignore cache write errors
        }
    }
}

function clearLocalCache() {
    memorySessionCache = null;
    delete process.env.AITU_SESSION_ID;
    const cacheFile = getCacheFilePath();
    if (cacheFile) {
        try {
            if (fs.existsSync(cacheFile)) {
                fs.unlinkSync(cacheFile);
            }
        } catch {
            // Ignore unlink errors
        }
    }
}

/**
 * Получить сохраненную сессию:
 * 1. Из локального кэша процесса / tmp
 * 2. Из закрепленного сообщения в чате администратора Telegram (getChat)
 * 3. Из process.env.AITU_SESSION_ID
 */
async function getStoredSession(targetChatId) {
    const local = readLocalCache();
    if (local) {
        return local;
    }

    const token = (process.env.TELEGRAM_BOT_TOKEN || '').trim();
    const chatId = targetChatId || (process.env.ADMIN_CHAT_ID || process.env.TELEGRAM_CHAT_ID || '').trim();

    if (token && chatId) {
        try {
            const res = await fetch(`https://api.telegram.org/bot${token}/getChat`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ chat_id: chatId }),
                signal: AbortSignal.timeout(5000)
            });
            const data = await res.json();
            const pinned = data?.result?.pinned_message;

            if (pinned && pinned.text && pinned.text.includes(STORAGE_PREFIX)) {
                const regex = new RegExp(`${STORAGE_PREFIX}([A-Za-z0-9+/=]+)`);
                const match = pinned.text.match(regex);
                if (match && match[1]) {
                    try {
                        const decoded = Buffer.from(match[1], 'base64').toString('utf8').trim();
                        if (decoded) {
                            writeLocalCache(decoded);
                            return decoded;
                        }
                    } catch (decErr) {
                        console.error('Failed to decode stored base64 session:', decErr.message);
                    }
                }
            }
        } catch (err) {
            console.warn('getStoredSession: Telegram getChat error:', err.message);
        }
    }

    const envSid = (process.env.AITU_SESSION_ID || '').trim();
    if (envSid) {
        writeLocalCache(envSid);
        return envSid;
    }

    return null;
}

/**
 * Сохранить сессию персистентно в Telegram (pinned message) и в локальный кэш
 */
async function saveStoredSession(sessionId, targetChatId) {
    if (!sessionId) return false;
    const cleanSid = String(sessionId).trim();
    writeLocalCache(cleanSid);

    const token = (process.env.TELEGRAM_BOT_TOKEN || '').trim();
    const chatId = targetChatId || (process.env.ADMIN_CHAT_ID || process.env.TELEGRAM_CHAT_ID || '').trim();

    if (!token || !chatId) {
        console.warn('saveStoredSession: TELEGRAM_BOT_TOKEN or CHAT_ID missing, saved to local cache only');
        return false;
    }

    const b64 = Buffer.from(cleanSid, 'utf8').toString('base64');
    const nowStr = new Intl.DateTimeFormat('ru-RU', {
        timeZone: 'Asia/Almaty',
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    }).format(new Date());

    const messageText = `🔐 <b>GradeMaster • Хранилище сессии AITU</b>\n` +
        `<i>Служебное закрепленное сообщение. Бот использует его для автоматической утренней проверки квизов learn.astanait.edu.kz.</i>\n\n` +
        `<code>${STORAGE_PREFIX}${b64}</code>\n\n` +
        `🕒 <b>Обновлено:</b> ${nowStr} (Алматы)`;

    try {
        // 1. Проверяем текущее закрепленное сообщение
        const chatRes = await fetch(`https://api.telegram.org/bot${token}/getChat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: chatId }),
            signal: AbortSignal.timeout(5000)
        });
        const chatData = await chatRes.json();
        const pinnedMsg = chatData?.result?.pinned_message;

        if (pinnedMsg && pinnedMsg.text && pinnedMsg.text.includes(STORAGE_PREFIX)) {
            // Редактируем существующее закрепленное сообщение без спама новыми сообщениями
            try {
                const editRes = await fetch(`https://api.telegram.org/bot${token}/editMessageText`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        chat_id: chatId,
                        message_id: pinnedMsg.message_id,
                        text: messageText,
                        parse_mode: 'HTML'
                    }),
                    signal: AbortSignal.timeout(5000)
                });
                const editData = await editRes.json();
                if (editData.ok) {
                    return true;
                }
            } catch {
                // Если не получилось отредактировать, отправим новое
            }
        }

        // 2. Отправляем тихое сервисное сообщение
        const sendRes = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: chatId,
                text: messageText,
                parse_mode: 'HTML',
                disable_notification: true
            }),
            signal: AbortSignal.timeout(5000)
        });
        const sendData = await sendRes.json();
        if (!sendData.ok || !sendData.result) {
            console.error('saveStoredSession: sendMessage failed:', sendData);
            return false;
        }

        const newMsgId = sendData.result.message_id;

        // 3. Закрепляем его
        await fetch(`https://api.telegram.org/bot${token}/pinChatMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: chatId,
                message_id: newMsgId,
                disable_notification: true
            }),
            signal: AbortSignal.timeout(5000)
        }).catch(() => {});

        return true;
    } catch (err) {
        console.error('saveStoredSession error:', err.message);
        return false;
    }
}

/**
 * Получить список предстоящих квизов из курсов learn.astanait.edu.kz
 * @param {string} [sessionId] - Cookie sessionid пользователя (если не указан, извлекается из персистентного хранилища)
 * @returns {Promise<{ ok: boolean, error?: string, sessionExpired?: boolean, quizzes: Array }>}
 */
async function getUpcomingQuizzes(sessionId) {
    let sid = (sessionId || '').trim();
    if (!sid) {
        sid = (await getStoredSession()) || '';
    }

    if (!sid) {
        return {
            ok: false,
            error: 'Сессия learn.astanait.edu.kz не настроена. Отправьте боту команду /set_cookie ВАШ_SESSION_ID.',
            sessionExpired: true,
            quizzes: []
        };
    }

    const headers = {
        'Cookie': `sessionid=${sid}; openedx-language-preference=ru`,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
    };

    let coursesToScan = [...DEFAULT_COURSES];

    // 1. Пытаемся получить список активных курсов с дашборда
    try {
        const dashRes = await fetch('https://learn.astanait.edu.kz/dashboard', {
            headers,
            redirect: 'manual',
            signal: AbortSignal.timeout(6000)
        });

        if (dashRes.status === 302 || dashRes.status === 401 || dashRes.status === 403) {
            const loc = dashRes.headers.get('location') || '';
            if (loc.includes('login') || dashRes.status === 401 || dashRes.status === 403) {
                return {
                    ok: false,
                    error: 'Сессия learn.astanait.edu.kz устарела (требуется повторный вход через Microsoft SSO).',
                    sessionExpired: true,
                    quizzes: []
                };
            }
        }

        if (dashRes.ok) {
            const dashHtml = await dashRes.text();
            const courseMatches = [...dashHtml.matchAll(/href="[^"]*\/courses\/([^"\/]+)\/course\/"/g)];
            const activeCourseIds = new Set();
            for (const m of courseMatches) {
                const cId = m[1];
                // Фильтруем курсы: берем только текущий учебный год 26-27 (чтобы не парсить архивные прошлые курсы)
                if (cId && cId.includes('26-27')) {
                    activeCourseIds.add(cId);
                }
            }

            if (activeCourseIds.size > 0) {
                coursesToScan = Array.from(activeCourseIds).map(cId => {
                    const existing = DEFAULT_COURSES.find(c => c.id === cId);
                    const cleanName = cId.replace(/^course-v1:AITU\+/, '').replace(/\+.*$/, '').replace(/_.*$/, '');
                    return {
                        id: cId,
                        name: existing ? existing.name : cleanName
                    };
                });
            }
        }
    } catch (err) {
        console.warn('Dashboard fetch error, using default courses:', err.message);
    }

    const allQuizzes = [];
    const now = new Date();

    // 2. Сканируем курсы параллельно
    const fetchPromises = coursesToScan.map(async (course) => {
        try {
            const courseUrl = `https://learn.astanait.edu.kz/courses/${course.id}/course/`;
            const res = await fetch(courseUrl, {
                headers,
                redirect: 'manual',
                signal: AbortSignal.timeout(7000)
            });

            if (!res.ok) return;

            const html = await res.text();
            const blockRegex = /<a[^>]*outline-button[^>]*id="([^"]+)"[\s\S]*?<h4[^>]*class="subsection-title">([\s\S]*?)<\/h4>([\s\S]*?)<\/a>/gi;
            let match;

            while ((match = blockRegex.exec(html)) !== null) {
                const blockId = match[1];
                const rawTitle = match[2].replace(/\s+/g, ' ').trim();
                const detailsHtml = match[3];

                const dateMatch = detailsHtml.match(/data-datetime="([^"]+)"/);
                const descMatch = detailsHtml.match(/data-string="([^"]+)"/);

                const isQuiz = /quiz|квиз|тест|test|assignment|final|midterm/i.test(rawTitle) ||
                               (descMatch && /quiz|квиз|до/i.test(descMatch[1]));

                if (dateMatch) {
                    const dueUtc = new Date(dateMatch[1]);
                    const diffMs = dueUtc.getTime() - now.getTime();
                    const diffHours = Math.round(diffMs / (1000 * 60 * 60));
                    const diffDays = Math.floor(diffHours / 24);

                    allQuizzes.push({
                        courseId: course.id,
                        courseName: course.name,
                        title: rawTitle,
                        blockId,
                        link: `https://learn.astanait.edu.kz/courses/${course.id}/jump_to/${blockId}`,
                        dueDate: dueUtc.toISOString(),
                        dueString: descMatch ? descMatch[1] : null,
                        diffHours,
                        diffDays,
                        isPast: diffMs < 0,
                        isQuiz
                    });
                }
            }
        } catch (err) {
            console.error(`Ошибка проверки курса ${course.id}:`, err.message);
        }
    });

    await Promise.all(fetchPromises);

    // Сортируем: сначала ближайшие предстоящие, затем прошедшие
    allQuizzes.sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate));

    return {
        ok: true,
        sessionExpired: false,
        quizzes: allQuizzes
    };
}

/**
 * Красиво отформатировать список квизов для Telegram (HTML)
 */
function formatQuizzesMessage(result) {
    if (!result.ok) {
        if (result.sessionExpired) {
            return `⚠️ <b>Сессия learn.astanait.edu.kz истекла!</b>\n\n` +
                   `Пожалуйста, войдите в <a href="https://learn.astanait.edu.kz">learn.astanait.edu.kz</a> через Microsoft SSO, скопируйте cookie <code>sessionid</code> и отправьте боту команду:\n<code>/set_cookie ВАШ_SESSION_ID</code>\n\n` +
                   `💡 <i>Сессия будет автоматически сохранена в Telegram storage, и утренние напоминания продолжат работать без сбоев.</i>`;
        }
        return `❌ <b>Ошибка при проверке квизов:</b>\n${result.error || 'Неизвестная ошибка'}`;
    }

    const upcoming = result.quizzes.filter(q => !q.isPast);
    const past = result.quizzes.filter(q => q.isPast);

    if (upcoming.length === 0 && past.length === 0) {
        return `ℹ️ <b>Квизы и дедлайны не найдены</b>\n\nВозможно, преподаватели еще не опубликовали даты тестов в курсах текущего семестра.`;
    }

    let msg = `📋 <b>Квизы и дедлайны learn.astanait.edu.kz</b>\n\n`;

    if (upcoming.length > 0) {
        msg += `🟢 <b>Предстоящие дедлайны:</b>\n`;
        for (const item of upcoming) {
            const dateObj = new Date(item.dueDate);
            const astanaTime = new Intl.DateTimeFormat('ru-RU', {
                timeZone: 'Asia/Almaty',
                day: 'numeric',
                month: 'short',
                hour: '2-digit',
                minute: '2-digit'
            }).format(dateObj);

            let remainingText = '';
            if (item.diffDays > 1) {
                remainingText = `⏳ осталось ${item.diffDays} дн.`;
            } else if (item.diffHours > 0) {
                remainingText = `🔥 <b>осталось ${item.diffHours} ч.!</b>`;
            } else {
                remainingText = `🚨 <b>дедлайн сегодня!</b>`;
            }

            msg += `\n📚 <b>${item.courseName}</b>\n` +
                   `📝 <a href="${item.link}">${item.title}</a>\n` +
                   `⏰ Дедлайн: <b>${astanaTime}</b> (${remainingText})\n`;
        }
    } else {
        msg += `🎉 <i>Активных предстоящих квизов нет! Все сдано или еще не началось.</i>\n`;
    }

    if (past.length > 0) {
        msg += `\n──────────────\n` +
               `⚪️ <b>Прошедшие дедлайны:</b>\n`;
        for (const item of past.slice(-3)) {
            msg += `▫️ ${item.courseName} — ${item.title}\n`;
        }
    }

    msg += `\n💡 <i>Бот автоматически проверяет дедлайны каждое утро.</i>`;
    return msg;
}

module.exports = {
    getUpcomingQuizzes,
    formatQuizzesMessage,
    getStoredSession,
    saveStoredSession,
    readLocalCache,
    writeLocalCache,
    clearLocalCache,
    STORAGE_PREFIX,
    DEFAULT_COURSES
};
