// api/stats.js
// Vercel Serverless Endpoint: POST /api/stats
// Receives anonymous telemetry (visits & calculation events) from GradeMaster web clients.

const statsEngine = require('./stats/engine.js');

module.exports = async function handler(req, res) {
    // CORS Headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS,GET');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    // Admin GET endpoint to inspect stats JSON
    if (req.method === 'GET') {
        const authHeader = req.headers['authorization'];
        const secret = process.env.CRON_SECRET || process.env.TELEGRAM_SECRET_TOKEN;
        if (secret && authHeader !== `Bearer ${secret}`) {
            return res.status(401).json({ ok: false, error: 'Unauthorized' });
        }
        const summary = await statsEngine.getStatsSummary();
        return res.status(200).json(summary);
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ ok: false, error: 'Method not allowed' });
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

