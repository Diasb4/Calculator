// api/stats/engine.js
// Privacy-preserving anonymous analytics engine for GradeMaster
// Powered by Vercel KV / Upstash Redis REST API with graceful offline/memory fallback.

const crypto = require('node:crypto');

// In-memory fallback for local development / testing when KV is not configured
const memoryStore = {
    dau: new Map(), // dateStr -> Set of anonIds
    dauBot: new Map(),
    dauWeb: new Map(),
    usersAll: new Set(),
    calcsTotal: 0,
    calcsToday: new Map(), // dateStr -> count
    calcsByType: {
        total: 0,
        gpa: 0,
        cumulative: 0,
        attendance: 0,
        target: 0
    }
};

/**
 * Get current date string in Astana timezone (UTC+5 / Asia/Almaty) -> YYYY-MM-DD
 */
function getTodayDateStr(offsetDays = 0) {
    const d = new Date();
    if (offsetDays !== 0) {
        d.setDate(d.getDate() + offsetDays);
    }
    // Format in Asia/Almaty
    const formatter = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Almaty',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    });
    return formatter.format(d); // Returns YYYY-MM-DD
}

/**
 * Anonymize Telegram Chat ID into a permanent, one-way 12-char pseudonym.
 * It is impossible to recover the student's identity, chat_id, or username from this hash.
 */
function anonymizeUserId(rawId) {
    if (!rawId) return 'anon_unknown';
    const salt = (process.env.TELEGRAM_BOT_TOKEN || 'gm_secure_salt_grade_master_2026').trim();
    return crypto.createHmac('sha256', salt).update(String(rawId)).digest('hex').slice(0, 12);
}

/**
 * Execute Redis REST command via Upstash / Vercel KV REST API
 */
async function kvCommand(commandArray) {
    const url = (process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || '').trim();
    const token = (process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || '').trim();

    if (!url || !token) {
        return null; // Signals fallback to memoryStore
    }

    try {
        const res = await fetch(url, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(commandArray),
            signal: AbortSignal.timeout(4000)
        });

        if (!res.ok) {
            console.warn('KV command HTTP error:', res.status, await res.text().catch(() => ''));
            return null;
        }

        const data = await res.json();
        return data?.result !== undefined ? data.result : null;
    } catch (err) {
        console.warn('KV command network warning:', err.message);
        return null;
    }
}

/**
 * Execute a pipeline of Redis REST commands in a single HTTP request
 */
async function kvPipeline(commands) {
    const url = (process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || '').trim();
    const token = (process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || '').trim();

    if (!url || !token || !Array.isArray(commands) || commands.length === 0) {
        return null;
    }

    const pipelineUrl = url.endsWith('/pipeline') ? url : `${url}/pipeline`;

    try {
        const res = await fetch(pipelineUrl, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(commands),
            signal: AbortSignal.timeout(5000)
        });

        if (!res.ok) {
            console.warn('KV pipeline HTTP error:', res.status);
            return null;
        }

        const data = await res.json();
        return Array.isArray(data) ? data.map(item => item?.result) : null;
    } catch (err) {
        console.warn('KV pipeline network warning:', err.message);
        return null;
    }
}

/**
 * Record an anonymous visit (DAU / MAU)
 * @param {Object} opts
 * @param {string} opts.anonId - 12-char pseudonym (bot) or w_xxxxxx (web)
 * @param {'bot'|'web'} opts.platform
 */
async function recordVisit({ anonId, platform = 'bot' }) {
    if (!anonId) return false;
    const cleanId = String(anonId).slice(0, 32);
    const today = getTodayDateStr();

    // 1. Update memory fallback
    if (!memoryStore.dau.has(today)) memoryStore.dau.set(today, new Set());
    memoryStore.dau.get(today).add(cleanId);

    if (platform === 'bot') {
        if (!memoryStore.dauBot.has(today)) memoryStore.dauBot.set(today, new Set());
        memoryStore.dauBot.get(today).add(cleanId);
    } else {
        if (!memoryStore.dauWeb.has(today)) memoryStore.dauWeb.set(today, new Set());
        memoryStore.dauWeb.get(today).add(cleanId);
    }
    memoryStore.usersAll.add(cleanId);

    // 2. Persist to Vercel KV / Upstash Redis
    const commands = [
        ['SADD', `gm:dau:${today}`, cleanId],
        ['EXPIRE', `gm:dau:${today}`, 7776000], // 90 days retention
        ['SADD', `gm:dau:${platform}:${today}`, cleanId],
        ['EXPIRE', `gm:dau:${platform}:${today}`, 7776000],
        ['SADD', 'gm:users:all', cleanId]
    ];

    const pipelineRes = await kvPipeline(commands);
    return pipelineRes !== null;
}

/**
 * Record a calculation event
 * @param {Object} opts
 * @param {'total'|'gpa'|'cumulative'|'attendance'|'target'} opts.calcType
 * @param {'bot'|'web'} opts.platform
 */
async function recordCalculation({ calcType = 'total', platform = 'bot' }) {
    const today = getTodayDateStr();
    const type = ['total', 'gpa', 'cumulative', 'attendance', 'target'].includes(calcType) ? calcType : 'other';

    // 1. Memory fallback
    memoryStore.calcsTotal++;
    memoryStore.calcsToday.set(today, (memoryStore.calcsToday.get(today) || 0) + 1);
    if (memoryStore.calcsByType[type] !== undefined) {
        memoryStore.calcsByType[type]++;
    }

    // 2. Persist to Vercel KV / Upstash Redis
    const commands = [
        ['INCR', 'gm:calcs:total'],
        ['INCR', `gm:calcs:${today}`],
        ['EXPIRE', `gm:calcs:${today}`, 7776000],
        ['INCR', `gm:calcs:type:${type}`],
        ['INCR', `gm:calcs:platform:${platform}`]
    ];

    const pipelineRes = await kvPipeline(commands);
    return pipelineRes !== null;
}

/**
 * Get aggregated analytics metrics
 */
async function getStatsSummary() {
    const today = getTodayDateStr();
    const yesterday = getTodayDateStr(-1);

    // Check if KV is active
    const url = (process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || '').trim();
    const token = (process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || '').trim();

    if (url && token) {
        // Collect last 7 days dates for WAU
        const past7DaysKeys = [];
        for (let i = 0; i < 7; i++) {
            past7DaysKeys.push(`gm:dau:${getTodayDateStr(-i)}`);
        }

        // Collect last 30 days dates for MAU
        const past30DaysKeys = [];
        for (let i = 0; i < 30; i++) {
            past30DaysKeys.push(`gm:dau:${getTodayDateStr(-i)}`);
        }

        const commands = [
            ['SCARD', `gm:dau:${today}`],              // 0: DAU today
            ['SCARD', `gm:dau:bot:${today}`],          // 1: Bot today
            ['SCARD', `gm:dau:web:${today}`],          // 2: Web today
            ['SCARD', `gm:dau:${yesterday}`],          // 3: DAU yesterday
            ['SCARD', 'gm:users:all'],                 // 4: Total users all time
            ['GET', 'gm:calcs:total'],                 // 5: Total calcs all time
            ['GET', `gm:calcs:${today}`],              // 6: Calcs today
            ['GET', `gm:calcs:${yesterday}`],          // 7: Calcs yesterday
            ['GET', 'gm:calcs:type:total'],            // 8
            ['GET', 'gm:calcs:type:gpa'],              // 9
            ['GET', 'gm:calcs:type:cumulative'],       // 10
            ['GET', 'gm:calcs:type:attendance'],       // 11
            ['GET', 'gm:calcs:type:target'],           // 12
            ['SUNION', ...past7DaysKeys],              // 13: WAU unique union
            ['SUNION', ...past30DaysKeys]              // 14: MAU unique union
        ];

        const results = await kvPipeline(commands);

        if (results && results.length >= 13) {
            const dauToday = parseInt(results[0], 10) || 0;
            const dauBot = parseInt(results[1], 10) || 0;
            const dauWeb = parseInt(results[2], 10) || 0;
            const dauYesterday = parseInt(results[3], 10) || 0;
            const totalUsers = parseInt(results[4], 10) || dauToday;
            const totalCalcs = parseInt(results[5], 10) || 0;
            const calcsToday = parseInt(results[6], 10) || 0;
            const calcsYesterday = parseInt(results[7], 10) || 0;

            const calcTotal = parseInt(results[8], 10) || 0;
            const calcGPA = parseInt(results[9], 10) || 0;
            const calcCum = parseInt(results[10], 10) || 0;
            const calcAtt = parseInt(results[11], 10) || 0;
            const calcTarget = parseInt(results[12], 10) || 0;

            const wau = Array.isArray(results[13]) ? results[13].length : dauToday;
            const mau = Array.isArray(results[14]) ? results[14].length : Math.max(wau, totalUsers);

            return {
                storage: 'kv',
                today,
                dau: dauToday,
                dauBot,
                dauWeb,
                dauYesterday,
                wau,
                mau,
                totalUsers,
                totalCalcs,
                calcsToday,
                calcsYesterday,
                calcsByType: {
                    total: calcTotal,
                    gpa: calcGPA,
                    cumulative: calcCum,
                    attendance: calcAtt,
                    target: calcTarget
                }
            };
        }
    }

    // Memory store fallback
    const dauToday = memoryStore.dau.get(today)?.size || 0;
    const dauBot = memoryStore.dauBot.get(today)?.size || 0;
    const dauWeb = memoryStore.dauWeb.get(today)?.size || 0;
    const dauYesterday = memoryStore.dau.get(yesterday)?.size || 0;

    return {
        storage: 'memory',
        today,
        dau: dauToday,
        dauBot,
        dauWeb,
        dauYesterday,
        wau: dauToday,
        mau: memoryStore.usersAll.size || dauToday,
        totalUsers: memoryStore.usersAll.size || dauToday,
        totalCalcs: memoryStore.calcsTotal,
        calcsToday: memoryStore.calcsToday.get(today) || 0,
        calcsYesterday: memoryStore.calcsToday.get(yesterday) || 0,
        calcsByType: { ...memoryStore.calcsByType }
    };
}

/**
 * Formats statistics for Telegram admin display
 */
async function formatStatsTelegram() {
    const stats = await getStatsSummary();

    const totalCalculations = stats.totalCalcs;
    const t = stats.calcsByType;
    const sumKnown = (t.total + t.gpa + t.cumulative + t.attendance + t.target) || 1;

    const pTotal = Math.round((t.total / sumKnown) * 100);
    const pGPA = Math.round((t.gpa / sumKnown) * 100);
    const pCum = Math.round((t.cumulative / sumKnown) * 100);
    const pAtt = Math.round((t.attendance / sumKnown) * 100);
    const pTarget = Math.round((t.target / sumKnown) * 100);

    const storageBadge = stats.storage === 'kv' ? '🟢 Vercel KV / Upstash Active' : '🟡 In-Memory (KV connecting...)';

    return `📊 <b>СТАТИСТИКА ИСПОЛЬЗОВАНИЯ GRADEMASTER:</b>\n\n` +
        `👥 <b>Уникальные пользователи:</b>\n` +
        `• <b>Сегодня (DAU):</b> <code>${stats.dau}</code> (🤖 Бот: <b>${stats.dauBot}</b> | 🌐 Сайт: <b>${stats.dauWeb}</b>)\n` +
        `• <b>Вчера:</b> <code>${stats.dauYesterday}</code>\n` +
        `• <b>За 7 дней (WAU):</b> <code>${stats.wau}</code>\n` +
        `• <b>За 30 дней (MAU):</b> <code>${stats.mau}</code>\n` +
        `• <b>Всего за всё время:</b> <code>${stats.totalUsers}</code>\n\n` +
        `🧮 <b>Выполненные расчёты:</b>\n` +
        `• <b>Сегодня:</b> <code>${stats.calcsToday}</code>\n` +
        `• <b>Всего:</b> <code>${totalCalculations}</code>\n\n` +
        `📈 <b>Популярность калькуляторов:</b>\n` +
        `• 📝 Итоговая оценка: <b>${pTotal}%</b> (<code>${t.total}</code>)\n` +
        `• 🎓 GPA триместра: <b>${pGPA}%</b> (<code>${t.gpa}</code>)\n` +
        `• 📚 Кумулятивный GPA: <b>${pCum}%</b> (<code>${t.cumulative}</code>)\n` +
        `• 🚪 Посещаемость: <b>${pAtt}%</b> (<code>${t.attendance}</code>)\n` +
        `• 🎯 Целевой GPA: <b>${pTarget}%</b> (<code>${t.target}</code>)\n\n` +
        `🔒 <i>100% Анонимно: Персональные данные отсутствуют. Идентификаторы зашифрованы HMAC-SHA256.</i>\n` +
        `⚙️ <i>Хранилище: ${storageBadge}</i>`;
}

module.exports = {
    anonymizeUserId,
    getTodayDateStr,
    recordVisit,
    recordCalculation,
    getStatsSummary,
    formatStatsTelegram,
    _memoryStore: memoryStore
};

