const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const util = require('../api/_lib/util.js');
const telegram = require('../api/_lib/telegram.js');

async function withEnv(vars, fn) {
    const saved = {};
    for (const [name, value] of Object.entries(vars)) {
        saved[name] = process.env[name];
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
    }
    try {
        return await fn();
    } finally {
        for (const [name, value] of Object.entries(saved)) {
            if (value === undefined) delete process.env[name];
            else process.env[name] = value;
        }
    }
}

async function withFetch(mock, fn) {
    const originalFetch = global.fetch;
    global.fetch = mock;
    try {
        return await fn();
    } finally {
        global.fetch = originalFetch;
    }
}

const jsonReply = (data) => ({ ok: true, status: 200, json: async () => data });

function mockRes() {
    const res = {
        statusCode: null,
        body: null,
        setHeader() { },
        status(code) { res.statusCode = code; return res; },
        json(data) { res.body = data; return res; },
        end() { return res; }
    };
    return res;
}

test('sealSecret/openSecret: AES-GCM round-trip, tamper detection, legacy plaintext and key validation', async () => {
    const key32 = crypto.randomBytes(32).toString('base64');
    await withEnv({ SESSION_ENC_KEY: key32 }, () => {
        const sealed = util.sealSecret('sessionid_abc123');
        assert.match(sealed, /^enc:v1:/);
        assert.notEqual(sealed, util.sealSecret('sessionid_abc123'), 'a fresh IV must make every seal unique');
        assert.equal(util.openSecret(sealed), 'sessionid_abc123');

        const parts = sealed.split(':');
        const ciphertext = Buffer.from(parts[4], 'base64url');
        ciphertext[0] ^= 1;
        parts[4] = ciphertext.toString('base64url');
        assert.equal(util.openSecret(parts.join(':')), null, 'tampered ciphertext must not decrypt');

        assert.equal(util.openSecret('legacy_plain_session'), 'legacy_plain_session');
    });

    await withEnv({ SESSION_ENC_KEY: crypto.randomBytes(32).toString('base64') }, () => {
        const sealedElsewhere = util.sealSecret('x');
        process.env.SESSION_ENC_KEY = key32;
        assert.equal(util.openSecret(sealedElsewhere), null, 'a different key must not decrypt');
    });

    await withEnv({ SESSION_ENC_KEY: undefined }, () => {
        assert.equal(util.sealSecret('plain'), 'plain');
        assert.equal(util.openSecret(`enc:v1:${'A'.repeat(16)}:${'A'.repeat(22)}:AAAA`), null, 'sealed data without a key is unreadable');
    });

    await withEnv({ SESSION_ENC_KEY: crypto.randomBytes(16).toString('base64') }, () => {
        assert.throws(() => util.sealSecret('plain'), /SESSION_ENC_KEY must be 32 bytes base64/);
    });
});

test('splitMessage: chunks stay within the limit and lose no content', () => {
    const lines = Array.from({ length: 700 }, (_, i) => `строка ${i} ${'x'.repeat(i % 40)}`).join('\n');
    const chunks = telegram.splitMessage(lines);
    assert.ok(chunks.length > 1);
    for (const chunk of chunks) assert.ok(chunk.length <= 4096);
    assert.equal(chunks.join('\n'), lines, 'cuts happen at line breaks, which are dropped from the next chunk');

    const longLine = 'y'.repeat(9000);
    const hardCut = telegram.splitMessage(longLine);
    assert.deepEqual(hardCut.map(c => c.length), [4096, 4096, 808]);
    assert.equal(hardCut.join(''), longLine);

    assert.deepEqual(telegram.splitMessage('short'), ['short']);
    assert.deepEqual(telegram.splitMessage(`${'z'.repeat(4096)}\n`), ['z'.repeat(4096)], 'no empty trailing chunk');
});

test('callTelegram: retries 429 after retry_after and throws TelegramError on other failures', async () => {
    await withEnv({ TELEGRAM_BOT_TOKEN: '1:test' }, async () => {
        let calls = 0;
        await withFetch(async () => {
            calls++;
            return calls === 1
                ? jsonReply({ ok: false, error_code: 429, description: 'Too Many Requests', parameters: { retry_after: 0 } })
                : jsonReply({ ok: true, result: { message_id: 7 } });
        }, async () => {
            const result = await telegram.callTelegram('sendMessage', { chat_id: 1, text: 'hi' });
            assert.deepEqual(result, { message_id: 7 });
            assert.equal(calls, 2);
        });

        calls = 0;
        await withFetch(async () => {
            calls++;
            return jsonReply({ ok: false, error_code: 400, description: 'Bad Request: chat not found' });
        }, async () => {
            await assert.rejects(telegram.callTelegram('sendMessage', { chat_id: 1, text: 'hi' }), (err) => {
                assert.ok(err instanceof telegram.TelegramError);
                assert.equal(err.code, 400);
                assert.equal(err.method, 'sendMessage');
                return true;
            });
            assert.equal(calls, 1, 'client errors are not retried');
        });
    });
});

test('webhook: refused in long-polling mode and fails closed in production without a secret', async () => {
    const bot = require('../api/bot/index.js');
    const update = { message: { message_id: 1, chat: { id: 4242, type: 'private' }, from: { id: 4242 }, text: '/start' } };
    let calls = 0;
    await withFetch(async () => { calls++; return jsonReply({ ok: true, result: {} }); }, async () => {
        await withEnv({ BOT_POLLING: 'true', TELEGRAM_BOT_TOKEN: '1:test', TELEGRAM_SECRET_TOKEN: undefined }, async () => {
            const res = mockRes();
            await bot({ method: 'POST', headers: {}, body: update }, res);
            assert.equal(res.statusCode, 403);
        });
        await withEnv({ BOT_POLLING: undefined, NODE_ENV: 'production', TELEGRAM_BOT_TOKEN: '1:test', TELEGRAM_SECRET_TOKEN: undefined }, async () => {
            const res = mockRes();
            await bot({ method: 'POST', headers: {}, body: update }, res);
            assert.equal(res.statusCode, 503);
        });
    });
    assert.equal(calls, 0, 'a refused update must not reach the handlers');
});

test('cron: a failed send is retried next run; a chat that blocked the bot is unsubscribed', async () => {
    const cron = require('../api/cron.js');
    const aitu = require('../api/bot/aitu.js');
    const chatId = '70001';
    const alertKey = `1h:${chatId}:course-v1:AITU+CLOUD:block_1`;
    const context = { isMorningWindow: false, isEveningWindow: false, forceSend: false, todayStr: '2026-01-01', adminChatIds: [] };
    const originalGetQuizzes = aitu.getUpcomingQuizzes;

    aitu.getUpcomingQuizzes = async () => ({
        ok: true,
        quizzes: [{
            courseId: 'course-v1:AITU+CLOUD',
            courseName: 'Cloud Technologies',
            title: 'Quiz 1',
            blockId: 'block_1',
            link: 'https://learn.astanait.edu.kz/courses/x/jump_to/block_1',
            dueDate: new Date(Date.now() + 50 * 60 * 1000).toISOString(),
            diffMinutes: 50,
            diffHours: 0.8,
            diffDays: 0,
            isPast: false,
            isCriticalHour: true
        }]
    });

    try {
        await withEnv({ TELEGRAM_BOT_TOKEN: '1:test', ADMIN_CHAT_ID: '1' }, async () => {
            cron.clearSentAlertsMemory();
            await aitu.saveUserSession(chatId, 'sessionid_70001_abcdefgh');

            let sends = 0;
            await withFetch(async () => {
                sends++;
                return jsonReply({ ok: false, error_code: 500, description: 'Internal Server Error' });
            }, async () => {
                const result = await cron.processUserQuizzes(chatId, context);
                assert.equal(result.criticalSent, 0);
                assert.equal(sends, 3, 'a 5xx is retried before giving up');
                assert.equal(await cron.hasAlertBeenSent(alertKey), false, 'an undelivered alert must not be marked as sent');
            });

            await withFetch(async () => jsonReply({ ok: false, error_code: 403, description: 'Forbidden: bot was blocked by the user' }), async () => {
                const result = await cron.processUserQuizzes(chatId, context);
                assert.equal(result.gone, true);
                assert.equal(await cron.hasAlertBeenSent(alertKey), false);
                assert.ok(!(await aitu.getAllQuizUsers()).includes(chatId), 'blocked chat must be unsubscribed');
            });
        });
    } finally {
        aitu.getUpcomingQuizzes = originalGetQuizzes;
        cron.clearSentAlertsMemory();
        await aitu.deleteUserSession(chatId);
    }
});

test('server.js: serves only the public site and rejects oversized bodies', async () => {
    const server = require('../server.js');
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    try {
        for (const path of ['/backup_kv.json', '/package.json', '/server.js', '/.env', '/.git/config', '/%2e%2e/server.js']) {
            assert.equal((await fetch(base + path)).status, 404, path);
        }

        const apiSource = await fetch(`${base}/api/bot/aitu.js`);
        assert.equal(apiSource.status, 404);
        assert.equal((await apiSource.json()).ok, false);

        const page = await fetch(`${base}/index.html`);
        assert.equal(page.status, 200);
        assert.match(page.headers.get('content-security-policy') || '', /default-src 'self'/);

        const tooLarge = await fetch(`${base}/api/stats`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: 'x'.repeat(1.5 * 1024 * 1024)
        });
        assert.equal(tooLarge.status, 413);
    } finally {
        await new Promise(resolve => server.close(resolve));
    }
});
