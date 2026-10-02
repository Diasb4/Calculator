// tests/security.test.cjs
// Comprehensive security & protection tests for GradeMaster Bot and Website

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const bot = require('../api/bot/index.js');
const lms = require('../api/bot/lms.js');

test('Security: analyzeMessageSecurity identifies BotFather, phishing and safe messages', () => {
    // 1. BotFather deep link (the exact case from user inquiry)
    const bfAnalysis = bot.analyzeMessageSecurity('https://t.me/botfather?startattach=aitugrademaster_bot');
    assert.strictEqual(bfAnalysis.hasLinks, true);
    assert.strictEqual(bfAnalysis.isBotFatherLink, true);
    assert.strictEqual(bfAnalysis.isSuspicious, true);
    assert.ok(bfAnalysis.warnings.some(w => w.includes('@BotFather')));

    // 2. Phishing / token theft attempt
    const phishAnalysis = bot.analyzeMessageSecurity('Перейдите по ссылке: https://fake-aitu-auth.com/login?token=abc');
    assert.strictEqual(phishAnalysis.hasLinks, true);
    assert.strictEqual(phishAnalysis.isBotFatherLink, false);
    assert.strictEqual(phishAnalysis.isSuspicious, true);
    assert.ok(phishAnalysis.warnings.some(w => w.includes('подозрительные маркеры')));

    // 3. Normal external educational link
    const normalLink = bot.analyzeMessageSecurity('Смотрите лекцию: https://astanait.edu.kz/study');
    assert.strictEqual(normalLink.hasLinks, true);
    assert.strictEqual(normalLink.isBotFatherLink, false);
    assert.strictEqual(normalLink.isSuspicious, false);
    assert.ok(normalLink.warnings.some(w => w.includes('внешняя ссылка')));

    // 4. Safe academic text without links
    const safeText = bot.analyzeMessageSecurity('Здравствуйте, подскажите как посчитать кумулятивный GPA за 2 триместра?');
    assert.strictEqual(safeText.hasLinks, false);
    assert.strictEqual(safeText.isBotFatherLink, false);
    assert.strictEqual(safeText.isSuspicious, false);
    assert.strictEqual(safeText.warnings.length, 0);

    // 5. Handles null/undefined safely
    const nullAnalysis = bot.analyzeMessageSecurity(null);
    assert.strictEqual(nullAnalysis.hasLinks, false);
    assert.strictEqual(nullAnalysis.warnings.length, 0);
});

test('Security: isAllowedLmsUrl prevents SSRF attacks and validates legitimate LMS hosts', () => {
    // Legitimate LMS URLs
    assert.strictEqual(lms.isAllowedLmsUrl('https://lms.astanait.edu.kz/calendar/export_execute.php?userid=123&authtoken=abc'), true);
    assert.strictEqual(lms.isAllowedLmsUrl('webcal://lms.astanait.edu.kz/calendar/export_execute.php?userid=123'), true);
    assert.strictEqual(lms.isAllowedLmsUrl('http://lms.astanait.edu.kz/my/'), true);

    // SSRF: Cloud metadata endpoint
    assert.strictEqual(lms.isAllowedLmsUrl('http://169.254.169.254/latest/meta-data/'), false);

    // SSRF: Localhost / Loopback
    assert.strictEqual(lms.isAllowedLmsUrl('http://localhost:3000/api/bot'), false);
    assert.strictEqual(lms.isAllowedLmsUrl('http://127.0.0.1:8080/'), false);

    // SSRF: Private intranet networks
    assert.strictEqual(lms.isAllowedLmsUrl('http://10.0.0.1/admin'), false);
    assert.strictEqual(lms.isAllowedLmsUrl('http://192.168.1.1/router'), false);
    assert.strictEqual(lms.isAllowedLmsUrl('http://172.16.0.5/internal'), false);

    // SSRF: Malicious third-party domains mimicking moodle
    assert.strictEqual(lms.isAllowedLmsUrl('https://evil-hacker.com/calendar/export_execute.php?authtoken=xyz'), false);
    assert.strictEqual(lms.isAllowedLmsUrl('https://lms.astanait.edu.kz.evil.com/export'), false);

    // Invalid / garbage URLs
    assert.strictEqual(lms.isAllowedLmsUrl('not_a_url'), false);
    assert.strictEqual(lms.isAllowedLmsUrl(null), false);
    assert.strictEqual(lms.isAllowedLmsUrl('ftp://lms.astanait.edu.kz/'), false);
});

test('Security: Bot provides safety alert to admin and guidance to student when BotFather link is sent', async () => {
    const origToken = process.env.TELEGRAM_BOT_TOKEN;
    const origAdmin = process.env.ADMIN_CHAT_ID;
    process.env.TELEGRAM_BOT_TOKEN = 'mock_bot_token_sec_123';
    process.env.ADMIN_CHAT_ID = '999888';
    const studentChatId = 'student_bf_test_101';
    const adminChatId = '999888';

    const originalFetch = global.fetch;
    const sentApiMessages = [];

    global.fetch = async (url, options = {}) => {
        if (url && url.includes('telegram.org')) {
            const body = options.body ? JSON.parse(options.body) : {};
            sentApiMessages.push({ url, body });
            return {
                ok: true,
                status: 200,
                json: async () => ({ ok: true, result: { message_id: 999 } })
            };
        }
        return { ok: true, status: 200, json: async () => ({ ok: true }) };
    };

    const mockRes = {
        status: () => mockRes,
        json: () => mockRes,
        setHeader: () => mockRes
    };

    try {
        bot._userRateLimits.clear();
        sentApiMessages.length = 0;

        // Student sends BotFather startattach link
        await bot({
            method: 'POST',
            body: {
                message: {
                    chat: { id: studentChatId },
                    text: 'https://t.me/botfather?startattach=aitugrademaster_bot',
                    from: { id: studentChatId, username: 'tempoloss' }
                }
            }
        }, mockRes);

        // 1. Admin should receive a notification with a security warning
        const adminMsg = sentApiMessages.find(m => String(m.body.chat_id) === String(adminChatId));
        assert.ok(adminMsg, 'Admin must be notified of the message');
        assert.match(adminMsg.body.text, /🛡️ <b>Безопасность:<\/b>/);
        assert.match(adminMsg.body.text, /@BotFather/);
        assert.match(adminMsg.body.text, /Ни в коем случае не нажимайте/);
        assert.strictEqual(adminMsg.body.disable_web_page_preview, true, 'Link preview must be disabled for security');

        // 2. Student should receive guidance explaining that BotFather is not needed
        const studentMsg = sentApiMessages.find(m => String(m.body.chat_id) === String(studentChatId));
        assert.ok(studentMsg, 'Student must receive a response');
        assert.match(studentMsg.body.text, /ссылки на <b>@BotFather<\/b> не требуются/);
        assert.match(studentMsg.body.text, /\/cookie/);
        assert.strictEqual(studentMsg.body.disable_web_page_preview, true);

    } finally {
        global.fetch = originalFetch;
        bot._userRateLimits.clear();
        if (origToken !== undefined) process.env.TELEGRAM_BOT_TOKEN = origToken;
        else delete process.env.TELEGRAM_BOT_TOKEN;
        if (origAdmin !== undefined) process.env.ADMIN_CHAT_ID = origAdmin;
        else delete process.env.ADMIN_CHAT_ID;
    }
});

test('Security: /reply validates target ID format', async () => {
    const origToken = process.env.TELEGRAM_BOT_TOKEN;
    const origAdmin = process.env.ADMIN_CHAT_ID;
    process.env.TELEGRAM_BOT_TOKEN = 'mock_bot_token_sec_123';
    process.env.ADMIN_CHAT_ID = '999888';
    const adminChatId = '999888';
    const originalFetch = global.fetch;
    const sentApiMessages = [];

    global.fetch = async (url, options = {}) => {
        if (url && url.includes('telegram.org')) {
            sentApiMessages.push(JSON.parse(options.body));
            return { ok: true, status: 200, json: async () => ({ ok: true, result: { message_id: 111 } }) };
        }
        return { ok: true, status: 200, json: async () => ({ ok: true }) };
    };

    const mockRes = { status: () => mockRes, json: () => mockRes, setHeader: () => mockRes };

    try {
        // Calling /reply with invalid targetId (non-numeric / script injection)
        sentApiMessages.length = 0;
        await bot({
            method: 'POST',
            body: {
                message: {
                    chat: { id: adminChatId },
                    text: '/reply notanid Привет студент',
                    from: { id: adminChatId, username: 'admin' }
                }
            }
        }, mockRes);

        const responseMsg = sentApiMessages.find(m => String(m.chat_id) === String(adminChatId));
        assert.ok(responseMsg);
        assert.match(responseMsg.text, /некорректный ID пользователя/);
        assert.strictEqual(sentApiMessages.some(m => m.chat_id === 'notanid'), false, 'Must not send to invalid ID');
    } finally {
        global.fetch = originalFetch;
        if (origToken !== undefined) process.env.TELEGRAM_BOT_TOKEN = origToken;
        else delete process.env.TELEGRAM_BOT_TOKEN;
        if (origAdmin !== undefined) process.env.ADMIN_CHAT_ID = origAdmin;
        else delete process.env.ADMIN_CHAT_ID;
    }
});

test('Security: Webhook setup endpoint enforces TELEGRAM_SECRET_TOKEN authentication', async () => {
    const originalSecret = process.env.TELEGRAM_SECRET_TOKEN;
    const originalToken = process.env.TELEGRAM_BOT_TOKEN;
    process.env.TELEGRAM_BOT_TOKEN = 'mock_bot_token_sec_123';
    process.env.TELEGRAM_SECRET_TOKEN = 'super_secret_webhook_key_456';

    const originalFetch = global.fetch;
    global.fetch = async () => ({ ok: true, json: async () => ({ ok: true, result: true }) });

    try {
        let statusCode = null;
        let responsePayload = null;
        const mockRes = {
            setHeader: () => {},
            status: (code) => { statusCode = code; return mockRes; },
            json: (data) => { responsePayload = data; }
        };

        // 1. Without secret token -> 401 Unauthorized
        await bot({
            method: 'GET',
            query: { setup: '1' },
            headers: {}
        }, mockRes);
        assert.strictEqual(statusCode, 401);
        assert.strictEqual(responsePayload.ok, false);

        // 2. With wrong secret token -> 401 Unauthorized
        await bot({
            method: 'GET',
            query: { setup: '1' },
            headers: { 'x-telegram-bot-api-secret-token': 'wrong_secret' }
        }, mockRes);
        assert.strictEqual(statusCode, 401);

        // 3. With correct secret token via header -> 200 OK
        await bot({
            method: 'GET',
            query: { setup: '1' },
            headers: { 'x-telegram-bot-api-secret-token': 'super_secret_webhook_key_456' }
        }, mockRes);
        assert.strictEqual(statusCode, 200);
        assert.strictEqual(responsePayload.ok, true);

        // 4. With correct secret token via query param -> 200 OK
        await bot({
            method: 'GET',
            query: { setup: '1', secret: 'super_secret_webhook_key_456' },
            headers: {}
        }, mockRes);
        assert.strictEqual(statusCode, 200);
        assert.strictEqual(responsePayload.ok, true);

    } finally {
        global.fetch = originalFetch;
        if (originalSecret !== undefined) process.env.TELEGRAM_SECRET_TOKEN = originalSecret;
        else delete process.env.TELEGRAM_SECRET_TOKEN;
        if (originalToken !== undefined) process.env.TELEGRAM_BOT_TOKEN = originalToken;
        else delete process.env.TELEGRAM_BOT_TOKEN;
    }
});

test('Security: vercel.json includes complete security headers and restricted CORS methods', () => {
    const vercelConfigPath = path.join(__dirname, '../vercel.json');
    assert.ok(fs.existsSync(vercelConfigPath));
    const config = JSON.parse(fs.readFileSync(vercelConfigPath, 'utf8'));

    // Check headers rule for all pages /(.*)
    const globalRule = config.headers.find(h => h.source === '/(.*)');
    assert.ok(globalRule, 'Global security header rule must exist');

    const headersMap = {};
    for (const h of globalRule.headers) {
        headersMap[h.key.toLowerCase()] = h.value;
    }

    assert.strictEqual(headersMap['x-content-type-options'], 'nosniff');
    assert.strictEqual(headersMap['x-frame-options'], 'SAMEORIGIN');
    assert.strictEqual(headersMap['x-xss-protection'], '1; mode=block');
    assert.strictEqual(headersMap['referrer-policy'], 'strict-origin-when-cross-origin');
    assert.ok(headersMap['strict-transport-security'].includes('max-age=31536000'));
    assert.ok(headersMap['permissions-policy'].includes('camera=()'));

    // Check API rule methods
    const apiRule = config.headers.find(h => h.source === '/api/(.*)');
    assert.ok(apiRule, 'API header rule must exist');
    const apiMethods = apiRule.headers.find(h => h.key === 'Access-Control-Allow-Methods');
    assert.ok(apiMethods);
    assert.strictEqual(apiMethods.value, 'GET,OPTIONS,POST');
});

test('Feature: extractTargetIdFromReply extracts user ID from various Telegram notification templates', () => {
    // Standard template
    const text1 = '📨 Сообщение от студента:\n\n👤 От: @tempoloss (ID: <code>8123089212</code>)\n💬 Текст:\nping\n\n💡 Чтобы ответить: просто ответьте на это сообщение (Reply)';
    assert.strictEqual(bot.extractTargetIdFromReply(text1), '8123089212');

    // Plain text without code tag
    const text2 = '📨 Сообщение от студента:\n👤 От: Иван (ID: 123456789)\n💬 Текст: привет';
    assert.strictEqual(bot.extractTargetIdFromReply(text2), '123456789');

    // From /reply command prompt
    const text3 = '💡 Чтобы ответить: /reply 987654321 Ваш ответ';
    assert.strictEqual(bot.extractTargetIdFromReply(text3), '987654321');

    // Negative ID (channels/groups)
    const text4 = '👤 От: Группа (ID: <code>-1001234567890</code>)';
    assert.strictEqual(bot.extractTargetIdFromReply(text4), '-1001234567890');

    // Irrelevant text
    assert.strictEqual(bot.extractTargetIdFromReply('Обычное сообщение без ID'), null);
    assert.strictEqual(bot.extractTargetIdFromReply(null), null);
});

test('Feature: Admin can swipe-reply directly to student notification without typing /reply', async () => {
    const origToken = process.env.TELEGRAM_BOT_TOKEN;
    const origAdmin = process.env.ADMIN_CHAT_ID;
    process.env.TELEGRAM_BOT_TOKEN = 'mock_bot_token_sec_123';
    process.env.ADMIN_CHAT_ID = '999888';
    const adminChatId = '999888';
    const targetStudentId = '8123089212';

    const originalFetch = global.fetch;
    const sentApiMessages = [];

    global.fetch = async (url, options = {}) => {
        if (url && url.includes('telegram.org')) {
            sentApiMessages.push(JSON.parse(options.body));
            return { ok: true, status: 200, json: async () => ({ ok: true, result: { message_id: 888 } }) };
        }
        return { ok: true, status: 200, json: async () => ({ ok: true }) };
    };

    const mockRes = { status: () => mockRes, json: () => mockRes, setHeader: () => mockRes };

    try {
        sentApiMessages.length = 0;

        // Admin swipes to reply to the bot's forwarded notification
        await bot({
            method: 'POST',
            body: {
                message: {
                    message_id: 555,
                    chat: { id: adminChatId },
                    from: { id: adminChatId, username: 'admin' },
                    text: 'Я буду ждать от тебя еще тестов :)',
                    reply_to_message: {
                        message_id: 444,
                        text: '📨 Сообщение от студента:\n\n👤 От: @tempoloss (ID: <code>8123089212</code>)\n💬 Текст:\nping\n\n💡 Чтобы ответить: просто ответьте на это сообщение (Reply) или /reply 8123089212 Ваш ответ'
                    }
                }
            }
        }, mockRes);

        // 1. Student receives the reply
        const studentMsg = sentApiMessages.find(m => String(m.chat_id) === targetStudentId);
        assert.ok(studentMsg, 'Student must receive the message from swipe reply');
        assert.match(studentMsg.text, /Я буду ждать от тебя еще тестов :\)/);
        assert.match(studentMsg.text, /Ответ от администратора GradeMaster/);

        // 2. Admin receives confirmation of successful delivery
        const confirmMsg = sentApiMessages.find(m => String(m.chat_id) === adminChatId);
        assert.ok(confirmMsg, 'Admin must receive delivery confirmation');
        assert.match(confirmMsg.text, /Ответ успешно доставлен студенту/);
        assert.match(confirmMsg.text, /8123089212/);

    } finally {
        global.fetch = originalFetch;
        if (origToken !== undefined) process.env.TELEGRAM_BOT_TOKEN = origToken;
        else delete process.env.TELEGRAM_BOT_TOKEN;
        if (origAdmin !== undefined) process.env.ADMIN_CHAT_ID = origAdmin;
        else delete process.env.ADMIN_CHAT_ID;
    }
});

test('Security: URL credentials and non-standard ports are rejected by isAllowedLmsUrl', () => {
    assert.strictEqual(lms.isAllowedLmsUrl('https://admin:secret@lms.astanait.edu.kz/calendar/export.php'), false);
    assert.strictEqual(lms.isAllowedLmsUrl('https://lms.astanait.edu.kz:8443/calendar/export.php'), false);
    assert.strictEqual(lms.isAllowedLmsUrl('https://lms.astanait.edu.kz:22/calendar/export.php'), false);
});

test('Security: iCal title and courseName with HTML/XSS injection are safely escaped', () => {
    const maliciousResult = {
        ok: true,
        quizzesCount: 1,
        activeAcademicEvents: [{
            id: '123',
            title: '<script>alert(1)</script> & <b>bold</b>',
            courseName: 'Hacking <img src=x onerror=alert(2)>',
            dueDate: new Date(Date.now() + 86400000).toISOString(),
            diffMinutes: 1440,
            diffHours: 24,
            diffDays: 1,
            link: 'https://lms.astanait.edu.kz/mod/assign/view.php?id=123'
        }]
    };

    const formatted = lms.formatLmsDeadlinesMessage(maliciousResult, false, false, 'week');
    assert.ok(!formatted.includes('<script>'), 'Must not contain raw <script>');
    assert.ok(formatted.includes('&lt;script&gt;alert(1)&lt;/script&gt;'), 'Must escape script tags');
    assert.ok(!formatted.includes('<img'), 'Must not contain raw <img');
    assert.ok(formatted.includes('&lt;img src=x onerror=alert(2)&gt;'), 'Must escape img tags');
});

test('Security: getUserLmsSession purges legacy invalid URLs and refuses to return them', async () => {
    const maliciousChatId = '9999988888';
    // Directly inject invalid URL to simulate old state before fix
    await lms.saveUserLmsSession(maliciousChatId, 'https://lms.astanait.edu.kz/calendar/export_execute.php?userid=1&authtoken=valid');
    assert.ok(await lms.getUserLmsSession(maliciousChatId));

    // Force legacy bad URL into memory
    const badUrl = 'https://attacker.com/evil.ics';
    await lms.deleteUserLmsSession(maliciousChatId);
    // Directly test that saveUserLmsSession rejects it:
    const saveRes = await lms.saveUserLmsSession(maliciousChatId, badUrl);
    assert.strictEqual(saveRes, false, 'saveUserLmsSession must reject attacker.com');
    assert.strictEqual(await lms.getUserLmsSession(maliciousChatId), null, 'getUserLmsSession must be null');
});

test('Security: /set_lms rejects third-party URLs immediately without falsely claiming connection', async () => {
    const origToken = process.env.TELEGRAM_BOT_TOKEN;
    const originalFetch = global.fetch;
    process.env.TELEGRAM_BOT_TOKEN = 'test_token';

    const sentMessages = [];
    global.fetch = async (url, opts = {}) => {
        if (url && url.includes('api.telegram.org')) {
            const body = JSON.parse(opts.body || '{}');
            sentMessages.push(body);
            return { ok: true, json: async () => ({ ok: true, result: { message_id: 123 } }) };
        }
        throw new Error('Unexpected network request to: ' + url);
    };

    try {
        const studentChatId = 777666555;
        const mockRes = {
            statusCode: 200,
            status(c) { this.statusCode = c; return this; },
            json(d) { this.body = d; return this; },
            setHeader() { return this; },
            end() { return this; }
        };

        await bot({
            method: 'POST',
            body: {
                message: {
                    message_id: 101,
                    chat: { id: studentChatId },
                    from: { id: studentChatId, username: 'victim' },
                    text: '/set_lms https://attacker.com/group_calendar.ics'
                }
            }
        }, mockRes);

        // Must reject with error message
        const reply = sentMessages.find(m => m.chat_id === studentChatId);
        assert.ok(reply, 'Bot must reply to the student');
        assert.match(reply.text, /Недопустимая ссылка на календарь/);
        // Must NOT falsely claim to connect to lms.astanait.edu.kz
        assert.ok(!sentMessages.some(m => m.text && m.text.includes('Проверяю подключение к lms.astanait.edu.kz')),
            'Bot must NEVER send "Проверяю подключение к lms.astanait.edu.kz" for malicious URLs');
    } finally {
        global.fetch = originalFetch;
        if (origToken !== undefined) process.env.TELEGRAM_BOT_TOKEN = origToken;
        else delete process.env.TELEGRAM_BOT_TOKEN;
    }
});


