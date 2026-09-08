const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { parseHTML } = require('linkedom');

const root = path.resolve(__dirname, '..');
const pages = ['index.html', ...fs.readdirSync(path.join(root, 'main')).filter(f => f.endsWith('.html')).map(f => `main/${f}`)];

function loadPage(page, { language = 'ru', savedLanguage = language, storageBlocked = false, saved = {}, search = '' } = {}) {
    const { document, window: dom } = parseHTML(fs.readFileSync(path.join(root, page), 'utf8'));
    // Linkedom lacks the browser's writable HTMLSelectElement.value property.
    for (const select of document.querySelectorAll('select')) {
        Object.defineProperty(select, 'value', {
            get() { return Array.from(this.options).find(option => option.hasAttribute('selected'))?.value ?? this.options[0]?.value ?? ''; },
            set(value) { for (const option of this.options) option.toggleAttribute('selected', option.value === value); }
        });
    }
    const preferences = new Map(Object.entries({ language: savedLanguage, ...saved }));
    const localStorage = {
        getItem(key) { if (storageBlocked) throw new Error('Storage blocked'); return preferences.get(key) ?? null; },
        setItem(key, value) { if (storageBlocked) throw new Error('Storage blocked'); preferences.set(key, value); }
    };
    const window = { document, location: new URL(`https://example.test/${page}${search}`), addEventListener() {}, isSecureContext: true };
    const context = vm.createContext({
        window, document, localStorage, navigator: { language }, console,
        URL, URLSearchParams, TextEncoder, TextDecoder, atob, btoa, AbortController,
        setTimeout() { return 1; }, clearTimeout() {},
        fetch() { throw new Error('Unexpected external request'); }
    });
    // Only local scripts execute; analytics and all network access stay disabled.
    for (const script of document.querySelectorAll('script[src]')) {
        if (/^https?:/.test(script.src)) continue;
        const filename = path.resolve(root, path.dirname(page), script.src);
        vm.runInContext(fs.readFileSync(filename, 'utf8'), context, { filename });
    }
    document.dispatchEvent(new dom.Event('DOMContentLoaded'));
    return { document, preferences, context, run: code => vm.runInContext(code, context), event: type => new dom.Event(type) };
}

function setValues(app, values) {
    for (const [id, value] of Object.entries(values)) app.document.getElementById(id).value = String(value);
}

for (const page of pages) {
    for (const language of ['ru', 'kk', 'en']) {
        test(`${page}: ${language} initialization, language change and theme`, () => {
            const app = loadPage(page, { language });
            const { document, run } = app;
            assert.equal(document.documentElement.lang, language);
            const keys = run('Object.keys(translations.ru).sort().join(",")');
            for (const locale of ['kk', 'en']) assert.equal(run(`Object.keys(translations.${locale}).sort().join(",")`), keys);
            for (const node of document.querySelectorAll('[data-translate]')) {
                assert.equal(run(`Object.hasOwn(translations.${language}, ${JSON.stringify(node.dataset.translate)})`), true, node.dataset.translate);
            }
            const valuesBefore = Array.from(document.querySelectorAll('input[type=number]')).map(node => node.value);
            const languageSelect = document.getElementById('language-toggle');
            languageSelect.value = 'kk';
            languageSelect.dispatchEvent(app.event('change'));
            assert.equal(document.documentElement.lang, 'kk');
            assert.equal(app.preferences.get('language'), 'kk');
            assert.equal(document.getElementById('language-toggle').value, 'kk');
            assert.deepEqual(Array.from(document.querySelectorAll('input[type=number]')).map(node => node.value), valuesBefore);
            const theme = document.getElementById('theme-toggle');
            theme.click();
            assert.equal(document.body.classList.contains('dark-mode'), true);
            assert.match(theme.textContent, /☀️ Тақырып/);
            run('switchLanguage("en")');
            assert.match(theme.textContent, /☀️ Theme/);
            theme.click();
            assert.equal(document.body.classList.contains('dark-mode'), false);
        });
    }
}

test('locale fallback, persistence and denied storage do not break initialization', () => {
    assert.equal(loadPage('index.html', { language: 'en-US', savedLanguage: 'kk' }).document.documentElement.lang, 'kk');
    for (const page of pages) {
        const app = loadPage(page, { language: 'kk-KZ', savedLanguage: 'broken', saved: { gradeMaster_shareLinks: '{bad json' } });
        assert.equal(app.document.documentElement.lang, 'kk');
        app.run('switchLanguage("unknown")');
        assert.equal(app.document.documentElement.lang, 'kk');
        const blocked = loadPage(page, { language: 'en-US', storageBlocked: true });
        assert.equal(blocked.document.documentElement.lang, 'en');
        blocked.run('switchLanguage("kk")');
        assert.equal(blocked.document.documentElement.lang, 'kk');
    }
});

test('translation placeholders match across all languages', () => {
    const app = loadPage('index.html');
    const dictionaries = app.run('translations');
    const placeholders = value => [...value.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort();
    for (const key of Object.keys(dictionaries.ru)) {
        for (const language of ['kk', 'en']) assert.deepEqual(placeholders(dictionaries[language][key]), placeholders(dictionaries.ru[key]), `${language}.${key}`);
    }
});

test('final grade: zero is a real exam score, empty is a forecast, invalid scores rejected', () => {
    const app = loadPage('main/TotalCalculator.html', { language: 'kk' });
    setValues(app, { regmid: 80, regend: 80, regterm: '', final: 0 });
    app.run('calculate()');
    const result = app.document.getElementById('result');
    assert.match(result.className, /danger/);
    assert.match(result.textContent, /48\.00/);
    for (const value of [-1, 101]) {
        setValues(app, { final: value }); app.run('calculate()');
        assert.ok(result.querySelector('[data-translate="error_invalid"]'));
    }
    setValues(app, { final: '' }); app.run('calculate()');
    assert.ok(result.querySelector('[data-translate="for_pass"]'));
    setValues(app, { final: 80 }); app.run('calculate()');
    assert.match(result.textContent, /80\.00/);
    assert.ok(result.querySelector('[data-translate="scholarship_title"]'));
    // Language changes keep the displayed calculation even after editing inputs.
    setValues(app, { final: 10 }); app.run('switchLanguage("en")');
    assert.match(result.textContent, /80\.00/);
    assert.match(result.textContent, /Regular scholarship/);
});

test('GPA: weighted credits, escaped names, dynamic translation and fractional count rejection', () => {
    const app = loadPage('main/CalculatorGPA.html');
    setValues(app, { 'subjects-count': 2 }); app.document.getElementById('generate-subjects').click();
    const rows = app.document.querySelectorAll('.subject-input');
    rows[0].querySelector('.subject-name').value = '<img src=x onerror=alert(1)>';
    rows[0].querySelector('.subject-grade').value = '95'; rows[0].querySelector('.subject-credits').value = '3';
    rows[1].querySelector('.subject-grade').value = '80'; rows[1].querySelector('.subject-credits').value = '6';
    app.document.getElementById('calculate-gpa').click();
    const result = app.document.getElementById('result');
    assert.equal(result.querySelector('.gpa-value').textContent, '3.33');
    assert.equal(result.querySelector('img'), null);
    assert.match(result.textContent, /<img src=x onerror=alert\(1\)>/);
    app.run('switchLanguage("kk")');
    assert.match(result.textContent, /Пән/);
    assert.match(rows[0].querySelector('.subject-name').placeholder, /Пән атауы/);
    assert.equal(rows[0].querySelector('.subject-name').value, '<img src=x onerror=alert(1)>');
    setValues(app, { 'subjects-count': 1.5 }); app.document.getElementById('generate-subjects').click();
    assert.match(result.className, /error/);
    assert.equal(app.document.querySelectorAll('.subject-input').length, 2);
});

test('cumulative GPA is weighted and all result labels change language', () => {
    const app = loadPage('main/CumulativeGPA.html');
    setValues(app, { 'terms-count': 2 }); app.document.getElementById('generate-terms').click();
    const rows = app.document.querySelectorAll('.subject-input');
    rows[0].querySelector('.term-gpa').value = '4'; rows[0].querySelector('.term-credits').value = '10';
    rows[1].querySelector('.term-gpa').value = '2'; rows[1].querySelector('.term-credits').value = '30';
    app.document.getElementById('calculate-cumulative').click();
    const result = app.document.getElementById('result');
    assert.equal(result.querySelector('.gpa-value').textContent, '2.50');
    app.run('switchLanguage("kk")');
    assert.match(app.document.title, /Орташа GPA/);
    assert.match(result.textContent, /Кредиттер/);
    rows[0].querySelector('.term-gpa').value = '4.1';
    app.document.getElementById('calculate-cumulative').click();
    assert.match(result.className, /error/);
});

test('attendance uses 10 weeks and 30%, rejects fractions and values over 20', () => {
    const app = loadPage('main/AttendanceCalculator.html');
    const result = app.document.getElementById('result');
    setValues(app, { lessonsPerWeek: 3 }); app.run('calculateAttendance()');
    assert.match(result.textContent, /9/);
    app.run('switchLanguage("kk")');
    assert.match(result.textContent, /Босатуға болатын сабақ саны: 9/);
    for (const count of [0, 21, 50, 1.5]) {
        setValues(app, { lessonsPerWeek: count }); app.run('calculateAttendance()');
        assert.match(result.className, /danger/);
    }
});

test('template: names and values survive language changes; preset round trips Unicode without grades', () => {
    const app = loadPage('main/templated_calculator.html');
    const name = app.document.querySelector('.component-name');
    name.value = 'Қазақ тілі <бақылау>';
    app.run('switchLanguage("kk"); addComponent("assignmentsList")');
    assert.equal(name.value, 'Қазақ тілі <бақылау>');
    for (const input of app.document.querySelectorAll('.component-grade')) input.value = '80';
    app.document.getElementById('calculate-all-btn').click();
    assert.match(app.document.getElementById('result').textContent, /80\.00/);
    assert.equal(app.document.querySelectorAll('.component-item').length, 6);
    const encoded = app.run('encodePresetData(collectPresetData())');
    const restored = loadPage('main/templated_calculator.html', { language: 'kk', search: `?p=${encoded}` });
    assert.equal(restored.document.querySelector('.component-name').value, 'Қазақ тілі <бақылау>');
    assert.ok(Array.from(restored.document.querySelectorAll('.component-grade')).every(input => input.value === ''));
    assert.match(restored.document.getElementById('presetStatus').textContent, /жүктелді/);
});

test('feedback: formatting escapes HTML and statuses remain visible after repeated submissions', () => {
    const app = loadPage('main/Feedback.html');
    const output = app.run('formatMessage("<admin>", "bug", "<a href=x>test</a>", "a&b")');
    assert.match(output, /&lt;admin&gt;/);
    assert.match(output, /&lt;a href=x&gt;/);
    assert.match(output, /a&amp;b/);
    app.run('showStatus("feedback_success", "success")');
    const status = app.document.getElementById('statusMessage');
    status.style.display = 'none';
    app.run('switchLanguage("kk"); showStatus("feedback_error", "error")');
    assert.notEqual(status.style.display, 'none');
    assert.match(status.textContent, /Хабарламаны жіберу қатесі/);
});

test('feedback keeps sending and completion labels translated when language changes mid-request', async () => {
    const app = loadPage('main/Feedback.html');
    let finish;
    app.context.fetch = () => new Promise(resolve => { finish = resolve; });
    const form = app.document.getElementById('feedbackForm');
    form.reset = () => { app.document.getElementById('message').value = ''; };
    app.document.getElementById('message').value = 'Local test only';
    form.dispatchEvent(app.event('submit'));
    app.run('switchLanguage("kk")');
    const button = app.document.getElementById('submitBtn');
    assert.equal(button.disabled, true);
    assert.match(button.textContent, /Жіберілуде/);
    finish({ ok: true, json: async () => ({ success: true }) });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(button.disabled, false);
    assert.match(button.textContent, /Хабарлама жіберу/);
    assert.match(app.document.getElementById('statusMessage').textContent, /Пікіріңізге рақмет/);
});

test('feedback uses the current deployment and prevents duplicate submissions', async () => {
    const app = loadPage('main/Feedback.html');
    const requests = [];
    let finish;
    app.context.fetch = (url, options) => {
        requests.push({ url, options });
        return new Promise(resolve => { finish = resolve; });
    };
    const form = app.document.getElementById('feedbackForm');
    let resets = 0;
    form.reset = () => { resets++; };
    setValues(app, { userName: '<admin>', message: 'A < B & "C"', contact: 'a&b' });
    form.dispatchEvent(app.event('submit'));
    form.dispatchEvent(app.event('submit'));
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, '/api/telegram');
    assert.equal(requests[0].options.method, 'POST');
    assert.match(JSON.parse(requests[0].options.body).message, /A &lt; B &amp; &quot;C&quot;/);
    finish({ ok: true, json: async () => ({ success: true }) });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(resets, 1);
    assert.equal(app.document.getElementById('statusMessage').dataset.translate, 'feedback_success');
});

test('feedback rejects blank or oversized fields before contacting the server', () => {
    for (const values of [{ message: '   ' }, { message: 'x'.repeat(3001) },
        { message: 'test', userName: 'x'.repeat(101) }, { message: 'test', contact: 'x'.repeat(201) }]) {
        const app = loadPage('main/Feedback.html');
        setValues(app, values);
        app.document.getElementById('feedbackForm').dispatchEvent(app.event('submit'));
        assert.equal(app.document.getElementById('statusMessage').dataset.translate,
            values.message.trim() ? 'feedback_too_long' : 'feedback_required');
        assert.equal(app.document.getElementById('submitBtn').disabled, false);
    }
});

test('feedback errors retain the draft, restore the button and translate with the page', async () => {
    const cases = [
        [503, { code: 'FEEDBACK_UNAVAILABLE' }, 'feedback_unavailable'],
        [400, { code: 'MESSAGE_TOO_LONG' }, 'feedback_too_long'],
        [400, { code: 'INVALID_MESSAGE' }, 'feedback_invalid'],
        [429, { code: 'RATE_LIMITED' }, 'feedback_rate_limited'],
        [504, { code: 'UPSTREAM_TIMEOUT' }, 'feedback_timeout'],
        [500, { error: 'Legacy server error' }, 'feedback_unavailable'],
        [404, null, 'feedback_unavailable'],
        [405, null, 'feedback_unavailable'],
        [502, null, 'feedback_unavailable'],
        [200, { success: false }, 'feedback_error'],
        [200, { success: 'true' }, 'feedback_error'],
        [200, null, 'feedback_error'],
        [0, null, 'feedback_network_error']
    ];
    for (const [statusCode, data, expectedKey] of cases) {
        const app = loadPage('main/Feedback.html');
        app.context.fetch = async () => {
            if (!statusCode) throw new TypeError('Failed to fetch');
            return { status: statusCode, ok: statusCode === 200, json: async () => {
                if (!data) throw new SyntaxError('HTML instead of JSON');
                return data;
            } };
        };
        const values = { message: 'Keep this draft', userName: 'Name', contact: 'Contact', feedbackType: 'bug' };
        setValues(app, values);
        app.run('showStatus("feedback_success", "success")');
        app.document.getElementById('feedbackForm').dispatchEvent(app.event('submit'));
        assert.equal(app.document.getElementById('statusMessage').style.display, 'none');
        await new Promise(resolve => setImmediate(resolve));
        const status = app.document.getElementById('statusMessage');
        assert.equal(status.dataset.translate, expectedKey, `${statusCode}: ${JSON.stringify(data)}`);
        assert.notEqual(status.style.display, 'none');
        assert.equal(app.document.getElementById('submitBtn').disabled, false);
        for (const [key, value] of Object.entries(values)) assert.equal(app.document.getElementById(key).value, value);
        app.run('switchLanguage("en")');
        assert.equal(status.textContent, app.run(`getTranslation("${expectedKey}")`));
    }
});

test('feedback timeout aborts the request, keeps the draft and permits a later retry', async () => {
    const app = loadPage('main/Feedback.html');
    let expire;
    let signal;
    app.context.setTimeout = callback => { expire = callback; return 42; };
    const cleared = [];
    app.context.clearTimeout = id => cleared.push(id);
    app.context.fetch = (url, options) => new Promise((resolve, reject) => {
        signal = options.signal;
        signal.addEventListener('abort', () => reject(Object.assign(new Error('Aborted'), { name: 'AbortError' })));
    });
    setValues(app, { message: 'Keep this draft' });
    const form = app.document.getElementById('feedbackForm');
    form.dispatchEvent(app.event('submit'));
    expire();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(signal.aborted, true);
    assert.ok(cleared.includes(42));
    assert.equal(app.document.getElementById('statusMessage').dataset.translate, 'feedback_timeout');
    assert.equal(app.document.getElementById('message').value, 'Keep this draft');
    assert.equal(app.document.getElementById('submitBtn').disabled, false);
    app.context.fetch = async () => ({ ok: true, json: async () => ({ success: true }) });
    form.reset = () => { app.document.getElementById('message').value = ''; };
    form.dispatchEvent(app.event('submit'));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(app.document.getElementById('statusMessage').dataset.translate, 'feedback_success');
    assert.equal(app.document.getElementById('message').value, '');
});

test('every local script and stylesheet referenced by a page exists', () => {
    for (const page of pages) {
        const { document } = parseHTML(fs.readFileSync(path.join(root, page), 'utf8'));
        for (const node of document.querySelectorAll('script[src], link[rel=stylesheet]')) {
            const source = node.getAttribute('src') || node.getAttribute('href');
            if (/^https?:/.test(source)) continue;
            assert.ok(fs.existsSync(path.resolve(root, path.dirname(page), source)), `${page}: ${source}`);
        }
    }
});
