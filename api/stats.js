const crypto = require('crypto');
const statsEngine = require('./stats/engine.js');

function safeCompare(a, b) {
    if (typeof a !== 'string' || typeof b !== 'string') return false;
    const bufA = Buffer.from(a);
    const bufB = Buffer.from(b);
    if (bufA.length !== bufB.length) return false;
    return crypto.timingSafeEqual(bufA, bufB);
}

const statsIpRateLimit = new Map();
const STATS_RATE_LIMIT_WINDOW_MS = 60 * 1000;
const STATS_RATE_LIMIT_MAX_COUNT = 60;

function isRateLimited(ip) {
    if (!ip || ip === 'unknown') return false;
    const now = Date.now();
    const timestamps = (statsIpRateLimit.get(ip) || []).filter(ts => now - ts < STATS_RATE_LIMIT_WINDOW_MS);
    if (timestamps.length >= STATS_RATE_LIMIT_MAX_COUNT) {
        return true;
    }
    timestamps.push(now);
    statsIpRateLimit.set(ip, timestamps);
    return false;
}

module.exports = async function handler(req, res) {
    // CORS Headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS,GET');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    // Admin GET endpoint to inspect stats JSON (timing-safe authentication)
    if (req.method === 'GET') {
        const authHeader = req.headers ? req.headers['authorization'] : null;
        const secret = process.env.CRON_SECRET || process.env.TELEGRAM_SECRET_TOKEN;
        if (secret) {
            if (!authHeader || !safeCompare(authHeader, `Bearer ${secret}`)) {
                return res.status(401).json({ ok: false, error: 'Unauthorized' });
            }
        }
        const summary = await statsEngine.getStatsSummary();
        return res.status(200).json(summary);
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ ok: false, error: 'Method not allowed' });
    }

    // Rate limit per client IP
    const reqHeaders = req.headers || {};
    const forwardedFor = reqHeaders['x-forwarded-for'];
    const clientIp = typeof forwardedFor === 'string'
        ? forwardedFor.split(',')[0].trim()
        : (typeof reqHeaders['x-real-ip'] === 'string' ? reqHeaders['x-real-ip'].trim() : null);

    if (clientIp && isRateLimited(clientIp)) {
        return res.status(429).json({ ok: false, error: 'Rate limit exceeded' });
    }

    try {
        let body = req.body || {};
        if (typeof body === 'string') {
            try { body = JSON.parse(body); } catch { /* Ignore malformed string */ }
        }

        const anonId = typeof body.anonId === 'string' ? body.anonId.trim().slice(0, 32) : null;
        const type = body.type || 'visit';
        const calcType = typeof body.calcType === 'string' ? body.calcType.trim().toLowerCase() : null;

        if (anonId && /^[a-zA-Z0-9_-]{3,32}$/.test(anonId)) {
            await statsEngine.recordVisit({ anonId, platform: 'web' });
        }

        if (type === 'calc' && calcType) {
            await statsEngine.recordCalculation({ calcType, platform: 'web' });
        }

        return res.status(200).json({ ok: true });
    } catch (err) {
        console.warn('API /api/stats warning:', err.message);
        return res.status(200).json({ ok: true, fallback: true });
    }
};

