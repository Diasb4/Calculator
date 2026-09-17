// tests/stats.test.cjs
// Tests for GradeMaster privacy-preserving anonymous analytics

const test = require('node:test');
const assert = require('node:assert/strict');
const statsEngine = require('../api/stats/engine.js');
const statsEndpoint = require('../api/stats.js');

test('anonymizeUserId: creates stable, irreversible pseudonyms without leaking IDs', () => {
    const id1 = 123456789;
    const id2 = 987654321;

    const hash1a = statsEngine.anonymizeUserId(id1);
    const hash1b = statsEngine.anonymizeUserId(id1);
    const hash2 = statsEngine.anonymizeUserId(id2);

    // Deterministic for same user
    assert.equal(hash1a, hash1b);
    assert.notEqual(hash1a, hash2);

    // Format: 12 hex characters
    assert.match(hash1a, /^[0-9a-f]{12}$/);
    assert.match(hash2, /^[0-9a-f]{12}$/);

    // Does not contain raw chat ID
    assert.equal(hash1a.includes(String(id1)), false);
    assert.equal(hash2.includes(String(id2)), false);

    // Handles null / empty safely
    assert.equal(statsEngine.anonymizeUserId(null), 'anon_unknown');
});

test('statsEngine: records visits and deduplicates daily active users (DAU)', async () => {
    // Using in-memory fallback
    const userA = 'w_test_user_a';
    const userB = 'w_test_user_b';

    // Same user visits 5 times
    for (let i = 0; i < 5; i++) {
        await statsEngine.recordVisit({ anonId: userA, platform: 'web' });
    }

    const summary1 = await statsEngine.getStatsSummary();
    assert.ok(summary1.dau >= 1);
    assert.ok(summary1.dauWeb >= 1);

    // Another user visits from bot
    await statsEngine.recordVisit({ anonId: userB, platform: 'bot' });
    const summary2 = await statsEngine.getStatsSummary();
    assert.ok(summary2.dau >= summary1.dau + 1);
    assert.ok(summary2.dauBot >= 1);
});

test('statsEngine: records calculations by category', async () => {
    const before = await statsEngine.getStatsSummary();
    const initialTotal = before.totalCalcs;

    await statsEngine.recordCalculation({ calcType: 'total', platform: 'bot' });
    await statsEngine.recordCalculation({ calcType: 'gpa', platform: 'web' });
    await statsEngine.recordCalculation({ calcType: 'attendance', platform: 'bot' });
    await statsEngine.recordCalculation({ calcType: 'cumulative', platform: 'web' });

    const after = await statsEngine.getStatsSummary();
    assert.equal(after.totalCalcs, initialTotal + 4);
    assert.ok(after.calcsByType.total >= 1);
    assert.ok(after.calcsByType.gpa >= 1);
    assert.ok(after.calcsByType.attendance >= 1);
    assert.ok(after.calcsByType.cumulative >= 1);
});

test('statsEngine: formatStatsTelegram outputs rich anonymous dashboard', async () => {
    const formatted = await statsEngine.formatStatsTelegram();

    assert.match(formatted, /СТАТИСТИКА ИСПОЛЬЗОВАНИЯ GRADEMASTER/);
    assert.match(formatted, /Уникальные пользователи/);
    assert.match(formatted, /Сегодня \(DAU\):/);
    assert.match(formatted, /За 7 дней \(WAU\):/);
    assert.match(formatted, /За 30 дней \(MAU\):/);
    assert.match(formatted, /Выполненные расчёты/);
    assert.match(formatted, /Популярность калькуляторов/);
    assert.match(formatted, /100% Анонимно/);
    assert.match(formatted, /Персональные данные отсутствуют/);
});

test('API /api/stats: handles OPTIONS, GET with authorization, and POST telemetry', async () => {
    function createMockRes() {
        return {
            statusCode: 200,
            headers: {},
            setHeader(k, v) { this.headers[k] = v; },
            status(code) { this.statusCode = code; return this; },
            json(data) { this.body = data; return this; },
            end() { this.ended = true; return this; }
        };
    }

    // 1. OPTIONS preflight
    const resOpt = createMockRes();
    await statsEndpoint({ method: 'OPTIONS', headers: {} }, resOpt);
    assert.equal(resOpt.statusCode, 200);
    assert.equal(resOpt.ended, true);

    // 2. Reject unsupported methods (e.g. PUT, DELETE)
    const resDel = createMockRes();
    await statsEndpoint({ method: 'DELETE', headers: {} }, resDel);
    assert.equal(resDel.statusCode, 405);
    assert.equal(resDel.body.ok, false);

    // 3. GET unauthorized when secret is present
    const origSecret = process.env.CRON_SECRET;
    try {
        process.env.CRON_SECRET = 'test_cron_secret_xyz';
        const resGetUnauth = createMockRes();
        await statsEndpoint({ method: 'GET', headers: {} }, resGetUnauth);
        assert.equal(resGetUnauth.statusCode, 401);

        // GET authorized
        const resGetAuth = createMockRes();
        await statsEndpoint({ method: 'GET', headers: { authorization: 'Bearer test_cron_secret_xyz' } }, resGetAuth);
        assert.equal(resGetAuth.statusCode, 200);
        assert.ok(resGetAuth.body.dau !== undefined);
    } finally {
        if (origSecret !== undefined) process.env.CRON_SECRET = origSecret;
        else delete process.env.CRON_SECRET;
    }

    // 4. POST anonymous visit
    const resPostVisit = createMockRes();
    await statsEndpoint({
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: { anonId: 'w_test_beacon', type: 'visit' }
    }, resPostVisit);
    assert.equal(resPostVisit.statusCode, 200);
    assert.equal(resPostVisit.body.ok, true);

    // 5. POST anonymous calculation
    const resPostCalc = createMockRes();
    await statsEndpoint({
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: { anonId: 'w_test_beacon', type: 'calc', calcType: 'total' }
    }, resPostCalc);
    assert.equal(resPostCalc.statusCode, 200);
    assert.equal(resPostCalc.body.ok, true);
});

test('statsEngine: interacts with mock Vercel KV REST API', async () => {
    const originalFetch = global.fetch;
    const kvCalls = [];

    try {
        process.env.KV_REST_API_URL = 'https://mock-kv.upstash.io';
        process.env.KV_REST_API_TOKEN = 'mock_token_abc';

        global.fetch = async (url, options) => {
            kvCalls.push({ url, options });
            const body = JSON.parse(options.body || '[]');
            // Return mock pipeline response
            if (Array.isArray(body)) {
                return {
                    ok: true,
                    json: async () => body.map((cmd) => {
                        const name = cmd[0];
                        if (name === 'SCARD') return { result: 42 };
                        if (name === 'GET') return { result: '150' };
                        if (name === 'SUNION') return { result: ['id1', 'id2', 'id3'] };
                        return { result: 1 };
                    })
                };
            }
            return {
                ok: true,
                json: async () => ({ result: 1 })
            };
        };

        const success = await statsEngine.recordVisit({ anonId: 'test_kv_user', platform: 'bot' });
        assert.equal(success, true);
        assert.ok(kvCalls.length > 0);
        assert.equal(kvCalls[0].options.headers.Authorization, 'Bearer mock_token_abc');

        const summary = await statsEngine.getStatsSummary();
        assert.equal(summary.storage, 'kv');
        assert.equal(summary.dau, 42);
        assert.equal(summary.totalCalcs, 150);
    } finally {
        global.fetch = originalFetch;
        delete process.env.KV_REST_API_URL;
        delete process.env.KV_REST_API_TOKEN;
    }
});

