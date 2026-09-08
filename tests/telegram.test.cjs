const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../api/telegram.js'), 'utf8')
    .replace('export default async function handler', 'async function handler');

function loadApi({ env = {}, reply = { ok: true, result: { message_id: 123 } }, status = 200, error } = {}) {
    const calls = [];
    const logs = [];
    const context = vm.createContext({
        process: { env: { TELEGRAM_BOT_TOKEN: '123:test-token', TELEGRAM_CHAT_ID: '456', ...env } },
        AbortSignal,
        console: { error: (...args) => logs.push(args) },
        fetch: async (url, options) => {
            calls.push({ url, options });
            if (error) throw error;
            return { ok: status >= 200 && status < 300, status,
                text: async () => typeof reply === 'string' ? reply : JSON.stringify(reply) };
        }
    });
    vm.runInContext(source, context);
    const handler = vm.runInContext('handler', context);
    async function request(body = { message: 'Local test only' }, method = 'POST') {
        const res = { statusCode: 200, headers: {},
            setHeader(key, value) { this.headers[key] = value; },
            status(code) { this.statusCode = code; return this; },
            json(data) { this.body = data; return this; },
            end() { return this; }
        };
        await handler({ method, body }, res);
        return res;
    }
    return { request, calls, logs };
}

test('API handles preflight and rejects unsupported methods without sending', async () => {
    const api = loadApi();
    assert.equal((await api.request({}, 'OPTIONS')).statusCode, 200);
    assert.equal((await api.request({}, 'GET')).statusCode, 405);
    assert.equal(api.calls.length, 0);
});

test('API rejects missing configuration without disclosing secrets', async () => {
    for (const env of [{ TELEGRAM_BOT_TOKEN: '' }, { TELEGRAM_CHAT_ID: '  ' }, { TELEGRAM_BOT_TOKEN: 'bad' }]) {
        const api = loadApi({ env });
        const res = await api.request();
        assert.equal(res.statusCode, 503);
        assert.equal(res.body.code, 'FEEDBACK_UNAVAILABLE');
        assert.equal(res.body.success, false);
        assert.equal(api.calls.length, 0);
        assert.doesNotMatch(JSON.stringify(res.body), /details|stack|test-token|456/);
    }
});

test('API rejects invalid JSON, non-string messages and whitespace before sending', async () => {
    for (const body of ['{', 'null', '42', [], {}, { message: {} }, { message: 123 }, { message: '  \n ' }]) {
        const api = loadApi();
        const res = await api.request(body);
        assert.equal(res.statusCode, 400, JSON.stringify(body));
        assert.equal(res.body.code, 'INVALID_MESSAGE');
        assert.equal(api.calls.length, 0);
    }
});

test('API validates Telegram text length after the form HTML is decoded', async () => {
    const api = loadApi();
    const valid = `<b>Feedback</b>\n${'&amp;'.repeat(3000)} &lt; &gt; &quot; &#39;`;
    assert.equal((await api.request({ message: valid })).statusCode, 200);
    assert.equal(JSON.parse(api.calls[0].options.body).text, valid);
    assert.equal((await api.request({ message: 'x'.repeat(4096) })).statusCode, 200);
    assert.equal((await api.request({ message: 'x'.repeat(4097) })).body.code, 'MESSAGE_TOO_LONG');
    assert.equal((await api.request({ message: '<b></b>'.repeat(4000) })).body.code, 'MESSAGE_TOO_LONG');
    assert.equal(api.calls.length, 2);
});

test('API sends escaped feedback with trimmed credentials and confirms delivery', async () => {
    const api = loadApi({ env: { TELEGRAM_BOT_TOKEN: ' 123:test-token\n', TELEGRAM_CHAT_ID: ' 456 ' } });
    const message = '<b>Feedback</b>\nA &lt; B &amp; C';
    const res = await api.request(JSON.stringify({ message }));
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.message_id, 123);
    assert.equal(api.calls[0].url, 'https://api.telegram.org/bot123:test-token/sendMessage');
    assert.deepEqual(JSON.parse(api.calls[0].options.body), { chat_id: '456', text: message, parse_mode: 'HTML' });
    assert.ok(api.calls[0].options.signal instanceof AbortSignal);
});

test('API translates Telegram rejection reasons into stable safe error codes', async () => {
    for (const [upstreamStatus, description, status, code] of [
        [401, 'Unauthorized', 503, 'FEEDBACK_UNAVAILABLE'],
        [403, 'Forbidden: bot was blocked by the user', 503, 'FEEDBACK_UNAVAILABLE'],
        [400, 'Bad Request: chat not found', 503, 'FEEDBACK_UNAVAILABLE'],
        [400, "Bad Request: can't parse entities", 400, 'INVALID_MESSAGE'],
        [400, 'Bad Request: message is too long', 400, 'MESSAGE_TOO_LONG'],
        [429, 'Too Many Requests', 429, 'RATE_LIMITED'],
        [500, 'Internal Server Error', 502, 'UPSTREAM_ERROR']
    ]) {
        const api = loadApi({ status: upstreamStatus, reply: { ok: false, error_code: upstreamStatus, description } });
        const res = await api.request();
        assert.equal(res.statusCode, status, description);
        assert.equal(res.body.code, code);
        assert.equal(res.body.success, false);
        assert.equal(api.calls.length, 1);
        assert.equal(res.body.description, undefined);
    }
});

test('API does not claim delivery for invalid or incomplete Telegram responses', async () => {
    for (const reply of ['<html>Bad Gateway</html>', null, {}, { ok: true }, { ok: true, result: {} }]) {
        const api = loadApi({ reply });
        const res = await api.request();
        assert.equal(res.statusCode, 502);
        assert.equal(res.body.code, 'UPSTREAM_ERROR');
        assert.equal(res.body.success, false);
        assert.equal(res.body.response, undefined);
    }
});

test('API sanitizes network errors and reports uncertain delivery on timeouts', async () => {
    for (const name of ['Error', 'TimeoutError', 'AbortError']) {
        const api = loadApi({ error: Object.assign(new Error('https://api.telegram.org/bot123:test-token/sendMessage'), { name }) });
        const res = await api.request();
        assert.equal(res.statusCode, name === 'Error' ? 502 : 504);
        assert.equal(res.body.code, name === 'Error' ? 'UPSTREAM_ERROR' : 'UPSTREAM_TIMEOUT');
        assert.doesNotMatch(JSON.stringify({ body: res.body, logs: api.logs }), /test-token|stack|api\.telegram/);
    }
});

test('existing weblog requests remain disabled unless explicitly configured', async () => {
    const api = loadApi();
    const res = await api.request({ weblog: { events: [] } });
    assert.equal(res.body.skipped, true);
    assert.equal(api.calls.length, 0);
    const enabled = loadApi({ env: { WEBLOG_ENABLED: '1' } });
    assert.equal((await enabled.request({ weblog: { uid: '<test>', events: [] } })).body.success, true);
    assert.match(JSON.parse(enabled.calls[0].options.body).text, /&lt;test&gt;/);
});
