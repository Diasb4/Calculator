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

test('PWA assets exist and manifest is valid JSON', () => {
    const manifestPath = path.join(root, 'manifest.json');
    const swPath = path.join(root, 'sw.js');
    const icon192 = path.join(root, 'icons/icon-192.svg');
    const icon512 = path.join(root, 'icons/icon-512.svg');

    assert.ok(fs.existsSync(manifestPath), 'manifest.json must exist');
    assert.ok(fs.existsSync(swPath), 'sw.js must exist');
    assert.ok(fs.existsSync(icon192), 'icon-192.svg must exist');
    assert.ok(fs.existsSync(icon512), 'icon-512.svg must exist');

    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    assert.equal(manifest.name, 'GradeMaster');
    assert.equal(manifest.display, 'standalone');
    assert.ok(Array.isArray(manifest.icons) && manifest.icons.length >= 2);
});

test('TotalCalculator stateless share encoding, decoding and keyboard navigation', () => {
    const app = loadPage('main/TotalCalculator.html');
    const testData = { rm: 85, re: 90, f: 95, m: 'both' };
    const encoded = app.run(`encodeShareData(${JSON.stringify(testData)})`);
    assert.ok(typeof encoded === 'string' && encoded.length > 0);

    const decoded = app.run(`decodeShareData("${encoded}")`);
    assert.deepEqual({ ...decoded }, testData);

    // Test restoring from URL
    const restored = loadPage('main/TotalCalculator.html', { search: `?d=${encoded}` });
    assert.equal(restored.document.getElementById('regmid').value, '85');
    assert.equal(restored.document.getElementById('regend').value, '90');
    assert.equal(restored.document.getElementById('final').value, '95');

    // Test keyboard accessibility on mode options
    const modeOption = app.document.querySelector('.mode-option[data-mode="standard"]');
    assert.equal(modeOption.getAttribute('tabindex'), '0');
    assert.equal(modeOption.getAttribute('role'), 'button');
});

test('attendance visual meter renders safe, warning, and danger states correctly', () => {
    const app = loadPage('main/AttendanceCalculator.html');
    const result = app.document.getElementById('result');

    // Safe zone
    setValues(app, { lessonsPerWeek: 3, alreadyMissed: 2 });
    app.run('calculateAttendance()');
    assert.match(result.className, /success/);
    assert.ok(result.querySelector('.att-meter-container'));
    assert.ok(result.querySelector('.att-status-badge.success'));

    // Warning zone
    setValues(app, { lessonsPerWeek: 3, alreadyMissed: 8 });
    app.run('calculateAttendance()');
    assert.match(result.className, /warning/);
    assert.ok(result.querySelector('.att-status-badge.warning'));

    // Danger zone
    setValues(app, { lessonsPerWeek: 3, alreadyMissed: 10 });
    app.run('calculateAttendance()');
    assert.match(result.className, /danger/);
    assert.ok(result.querySelector('.att-status-badge.danger'));
});

test('Telegram bot serverless webhook verifies secret token header', async () => {
    const botPath = path.join(root, 'api/bot/index.js');
    assert.ok(fs.existsSync(botPath));
    const botSource = fs.readFileSync(botPath, 'utf8');

    // Verify secret token check logic is present in the source
    assert.match(botSource, /x-telegram-bot-api-secret-token/);
    assert.match(botSource, /TELEGRAM_SECRET_TOKEN/);
});

test('Telegram bot: percentageToGradeInfo scale covers all grades', () => {
    const bot = require('../api/bot/index.js');
    assert.equal(bot.percentageToGradeInfo(95).letter, 'A');
    assert.equal(bot.percentageToGradeInfo(95).gpa, 4.0);
    assert.equal(bot.percentageToGradeInfo(90).letter, 'A-');
    assert.equal(bot.percentageToGradeInfo(90).gpa, 3.67);
    assert.equal(bot.percentageToGradeInfo(85).letter, 'B+');
    assert.equal(bot.percentageToGradeInfo(80).letter, 'B');
    assert.equal(bot.percentageToGradeInfo(75).letter, 'B-');
    assert.equal(bot.percentageToGradeInfo(70).letter, 'C+');
    assert.equal(bot.percentageToGradeInfo(65).letter, 'C');
    assert.equal(bot.percentageToGradeInfo(60).letter, 'C-');
    assert.equal(bot.percentageToGradeInfo(55).letter, 'D+');
    assert.equal(bot.percentageToGradeInfo(50).letter, 'D');
    assert.equal(bot.percentageToGradeInfo(49).letter, 'F');
    assert.equal(bot.percentageToGradeInfo(49).gpa, 0.0);
});

test('Telegram bot: calculateGradeReport with and without final exam', () => {
    const bot = require('../api/bot/index.js');

    // With final exam = 80
    const reportWithFinal = bot.calculateGradeReport(80, 80, 80);
    assert.match(reportWithFinal, /80\.00/);
    assert.match(reportWithFinal, /Обычная стипендия/);

    // With failed final exam (<25)
    const reportFailFinal = bot.calculateGradeReport(80, 80, 20);
    assert.match(reportFailFinal, /ниже порога 25 баллов/);

    // With failed term score (<25)
    const reportFailTerm = bot.calculateGradeReport(20, 20, 80);
    assert.match(reportFailTerm, /Допуск к экзамену заблокирован/);

    // Without final exam (forecast)
    const reportForecast = bot.calculateGradeReport(80, 80, null);
    assert.match(reportForecast, /Прогноз/i);
    assert.match(reportForecast, /Для сдачи/);
    assert.match(reportForecast, /Обычная стипендия/);
});

test('Telegram bot: calculateGPAReport processes lines with percentages and letters', () => {
    const bot = require('../api/bot/index.js');
    const input = `Математика 95 3
Физика 80 4
История 70 3`;
    const report = bot.calculateGPAReport(input);
    assert.match(report, /Расчёт GPA за триместр/i);
    assert.match(report, /Итоговый GPA/);
    assert.match(report, /Всего кредитов:.*10/);

    // Letter grade input
    const letterInput = `A 3\nB 4`;
    const letterReport = bot.calculateGPAReport(letterInput);
    assert.match(letterReport, /Итоговый GPA/);
});

test('Telegram bot: calculateCumulativeGPAReport computes credit-weighted cumulative GPA', () => {
    const bot = require('../api/bot/index.js');
    const input = `1 семестр: 4.0 30
2 семестр: 3.0 30`;
    const report = bot.calculateCumulativeGPAReport(input);
    assert.match(report, /Cumulative GPA.*3\.50/);
    assert.match(report, /Сумма кредитов.*60/);
});

test('tracker.js: evaluates admission, scholarship odds and bottleneck accurately', () => {
    const tracker = require('../js/tracker.js');

    // Safe high-performing courses
    const goodCourses = [
        { name: 'Course A', regmid: 85, regend: 85 },
        { name: 'Course B', regmid: 90, regend: 90 },
        { name: 'Course C', regmid: 80, regend: 80 }
    ];
    const goodOdds = tracker.calculateOverallScholarshipOdds(goodCourses);
    assert.ok(goodOdds.prob70Percent >= 80, `Expected high odds, got ${goodOdds.prob70Percent}%`);
    assert.equal(goodOdds.verdictKey, 'tracker_verdict_high');

    // Blocked course (< 25)
    const blockedCourses = [
        { name: 'Math', regmid: 80, regend: 80 },
        { name: 'Physics', regmid: 20, regend: 80 }
    ];
    const blockedOdds = tracker.calculateOverallScholarshipOdds(blockedCourses);
    assert.equal(blockedOdds.prob70Percent, 0);
    assert.equal(blockedOdds.verdictKey, 'tracker_verdict_lost');
    assert.equal(blockedOdds.bottleneck.name, 'Physics');
    assert.equal(blockedOdds.bottleneck.isAdmitted, false);

    // Impossible target (> 100 on final)
    const impossibleCourses = [
        { name: 'Course A', regmid: 80, regend: 80 },
        { name: 'Hard Course', regmid: 40, regend: 40 } // RegScore = 24. For 70: need (70 - 24)/0.4 = 115
    ];
    const impossibleOdds = tracker.calculateOverallScholarshipOdds(impossibleCourses);
    assert.equal(impossibleOdds.prob70Percent, 0);
    assert.equal(impossibleOdds.bottleneck.name, 'Hard Course');
    assert.ok(impossibleOdds.bottleneck.need70 > 100);

    // Courses with actual final grades
    const completedCourses = [
        { name: 'Course A', regmid: 80, regend: 80, final: 85 }, // Total = 48 + 34 = 82 >= 70
        { name: 'Course B', regmid: 75, regend: 75, final: 70 }  // Total = 45 + 28 = 73 >= 70
    ];
    const completedOdds = tracker.calculateOverallScholarshipOdds(completedCourses);
    assert.equal(completedOdds.prob70Percent, 100);
});

test('Telegram bot: calculateTrackerReport processes multi-course inputs and reports chances', () => {
    const bot = require('../api/bot/index.js');
    const input = `Матанализ 80 85\nАлгоритмы 75 80\nФизика 70 65`;
    const report = bot.calculateTrackerReport(input);
    assert.match(report, /Мультипредметный трекер стипендии/i);
    assert.match(report, /Шанс на обычную стипендию/);
    assert.match(report, /Критический экзамен/);
    assert.match(report, /Матанализ/);

    // Failed threshold course
    const failInput = `Матанализ 80 85\nФизика 20 70`;
    const failReport = bot.calculateTrackerReport(failInput);
    assert.match(failReport, /Шанс на обычную стипендию.*0%/);
    assert.match(failReport, /Недопуск/);

    // LMS screenshot format (Probability Theory, Register Midterm, Register Endterm)
    const lmsSample = `Probability Theory
Teacher: Karatay Assiya

Register Midterm -> 75.00
Register Endterm -> 80.00
Register Term -> 77.50
Register Final -> 0.00`;
    const lmsReport = bot.calculateTrackerReport(lmsSample);
    assert.match(lmsReport, /Probability Theory/);
    assert.match(lmsReport, /Karatay Assiya/);
    assert.match(lmsReport, /Шанс на обычную стипендию/);
});

test('tracker.js: parseLmsGradeText parses course, teacher and scores from LMS screenshot text', () => {
    const tracker = require('../js/tracker.js');
    const sample = `/start 8:27 PM

Probability Theory
Teacher: Karatay Assiya

Register Midterm -> 85.00
Register Endterm -> 90.00
Register Term -> 87.50
Register Final -> 0.00

Attendance activity Attendance -> 100.00
Assignment activity Midterm -> 0.00
Assignment activity Endterm -> 0.00`;

    const parsed = tracker.parseLmsGradeText(sample);
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0].name, 'Probability Theory');
    assert.equal(parsed[0].teacher, 'Karatay Assiya');
    assert.equal(parsed[0].regmid, 85);
    assert.equal(parsed[0].regend, 90);
    assert.equal(parsed[0].final, '');
});

test('Telegram bot: calculateAttendanceReport calculates 10-week limit and visual meter', () => {
    const bot = require('../api/bot/index.js');
    const reportSafe = bot.calculateAttendanceReport(3, 2);
    assert.match(reportSafe, /Всего занятий за семестр: <b>30<\/b>/);
    assert.match(reportSafe, /Порог недопуска \(30%\): <b>9 пар максимум<\/b>/);
    assert.match(reportSafe, /Безопасная зона посещаемости/);

    const reportDanger = bot.calculateAttendanceReport(3, 10);
    assert.match(reportDanger, /Критический лимит превышен/i);
});

test('Telegram bot: convertGradeReport outputs complete conversion table', () => {
    const bot = require('../api/bot/index.js');
    const report = bot.convertGradeReport(92);
    assert.match(report, /Буквенная оценка:.*A-/);
    assert.match(report, /GPA:.*3\.67/);
    assert.match(report, /ECTS: <b>B<\/b>/);
});

test('Telegram bot: admin security and main keyboard isolation', () => {
    const bot = require('../api/bot/index.js');
    // Normal student keyboard
    const studentKeyboard = bot.getMainKeyboard('123456789_student');
    const hasAdminButton = studentKeyboard.keyboard.some(row => row.some(btn => btn.text.includes('Панель Администратора')));
    assert.equal(hasAdminButton, false, 'Admin button must NEVER be visible to normal students');

    const hasQuizzesButton = studentKeyboard.keyboard.some(row => row.some(btn => btn.text.includes('Квизы')));
    assert.equal(hasQuizzesButton, false, 'Quizzes button must NEVER be visible to normal students');

    // Help text check
    const help = bot.getFoolproofHelpText();
    assert.match(help, /Инструкция по использованию бота/i);
    assert.match(help, /Калькулятор итоговой оценки/);
    assert.match(help, /Калькулятор GPA/);
});

test('Telegram bot: admin panel and setup handler execute without ReferenceError', async () => {
    const bot = require('../api/bot/index.js');
    const originalFetch = global.fetch;
    const originalToken = process.env.TELEGRAM_BOT_TOKEN;
    const originalAdmin = process.env.ADMIN_CHAT_ID;

    const sentMessages = [];
    try {
        global.fetch = async (url, opts) => {
            if (url && url.includes('/sendMessage')) {
                sentMessages.push(JSON.parse(opts.body));
                return { ok: true, json: async () => ({ ok: true, result: { message_id: 123 } }) };
            }
            if (url && url.includes('/setWebhook')) {
                return { ok: true, json: async () => ({ ok: true, result: true }) };
            }
            if (url && url.includes('/getMe')) {
                return { ok: true, json: async () => ({ ok: true, result: { username: 'test_bot' } }) };
            }
            return { ok: true, json: async () => ({ ok: true }) };
        };

        process.env.TELEGRAM_BOT_TOKEN = 'test_token_admin_999';
        process.env.ADMIN_CHAT_ID = '777888';

        // 1. Calling /admin as admin must NOT throw ReferenceError: BOT_TOKEN is not defined
        const adminReq = {
            method: 'POST',
            headers: {},
            body: {
                message: {
                    message_id: 1,
                    chat: { id: '777888' },
                    from: { id: '777888', username: 'admin_user' },
                    text: '/admin'
                }
            }
        };

        let responsePayload = null;
        let responseCode = null;
        const mockRes = {
            setHeader: () => {},
            status: (code) => { responseCode = code; return mockRes; },
            json: (data) => { responsePayload = data; }
        };

        await bot(adminReq, mockRes);
        assert.equal(responseCode, 200);
        assert.equal(responsePayload?.ok, true);

        const lastMsg = sentMessages[sentMessages.length - 1];
        assert.ok(lastMsg);
        assert.match(lastMsg.text, /Панель администратора GradeMaster/i);
        assert.match(lastMsg.text, /TELEGRAM_BOT_TOKEN.*Настроен/);

        // 2. Calling GET /api/bot?setup=1
        let setupPayload = null;
        const mockSetupRes = {
            setHeader: () => {},
            status: (code) => { responseCode = code; return mockSetupRes; },
            json: (data) => { setupPayload = data; }
        };
        await bot({ method: 'GET', query: { setup: '1' } }, mockSetupRes);
        assert.equal(responseCode, 200);
        assert.equal(setupPayload?.ok, true);
        assert.match(setupPayload?.message, /Webhook успешно привязан/);

        // 3. Calling GET /api/bot?setup=1 without BOT_TOKEN
        delete process.env.TELEGRAM_BOT_TOKEN;
        let noTokenPayload = null;
        const mockNoTokenRes = {
            setHeader: () => {},
            status: (code) => { responseCode = code; return mockNoTokenRes; },
            json: (data) => { noTokenPayload = data; }
        };
        await bot({ method: 'GET', query: { setup: '1' } }, mockNoTokenRes);
        assert.equal(responseCode, 500);
        assert.match(noTokenPayload?.error, /TELEGRAM_BOT_TOKEN не задан/);

    } finally {
        global.fetch = originalFetch;
        process.env.TELEGRAM_BOT_TOKEN = originalToken;
        process.env.ADMIN_CHAT_ID = originalAdmin;
    }
});

test('AITU: local cache stores and retrieves session', () => {
    const aitu = require('../api/bot/aitu.js');
    const testSession = 'test_sess_abc123';
    aitu.writeLocalCache(testSession);
    assert.equal(aitu.readLocalCache(), testSession);
    assert.equal(process.env.AITU_SESSION_ID, testSession);
});

test('AITU: formatQuizzesMessage instructs user to use /set_cookie on session expiration', () => {
    const aitu = require('../api/bot/aitu.js');
    const expiredRes = { ok: false, sessionExpired: true, quizzes: [] };
    const msg = aitu.formatQuizzesMessage(expiredRes);
    assert.match(msg, /Сессия learn\.astanait\.edu\.kz истекла/);
    assert.match(msg, /\/set_cookie ВАШ_SESSION_ID/);
});

test('AITU: getStoredSession extracts session from Telegram pinned message storage format', async () => {
    const os = require('node:os');
    const aitu = require('../api/bot/aitu.js');
    const secretSession = '1|mock_user_session_token_xyz:12345';
    const b64 = Buffer.from(secretSession, 'utf8').toString('base64');
    const pinnedText = `🔐 GradeMaster • Хранилище сессии AITU\nGM_AITU_SESSION:${b64}\n🕒 17.09.2026`;

    const originalFetch = global.fetch;
    try {
        global.fetch = async (url, opts) => {
            if (url && url.includes('/getChat')) {
                return {
                    ok: true,
                    json: async () => ({
                        ok: true,
                        result: {
                            id: 123456,
                            pinned_message: {
                                message_id: 999,
                                text: pinnedText
                            }
                        }
                    })
                };
            }
            return originalFetch ? originalFetch(url, opts) : Promise.reject(new Error('unhandled'));
        };

        aitu.clearLocalCache();
        process.env.TELEGRAM_BOT_TOKEN = 'mock_bot_token';
        process.env.TELEGRAM_CHAT_ID = '123456';

        const retrieved = await aitu.getStoredSession('123456');
        assert.equal(retrieved, secretSession);
        assert.equal(aitu.readLocalCache(), secretSession);
    } finally {
        global.fetch = originalFetch;
    }
});

test('AITU: formatCriticalHourAlert produces loud siren warning and direct inline action button', () => {
    const aitu = require('../api/bot/aitu.js');
    const mockQuiz = {
        courseId: 'course-v1:AITU+PHIL01+26-27_C1_Y3',
        courseName: 'Philosophy',
        title: 'Quiz 2. Epistemology',
        link: 'https://learn.astanait.edu.kz/courses/course-v1:AITU+PHIL01+26-27_C1_Y3/jump_to/block_abc',
        dueDate: new Date(Date.now() + 45 * 60 * 1000).toISOString(),
        diffMinutes: 45,
        diffHours: 0.8,
        diffDays: 0,
        isCriticalHour: true
    };

    const alert = aitu.formatCriticalHourAlert(mockQuiz);
    assert.match(alert.text, /Горящий дедлайн: остался 1 час/i);
    assert.match(alert.text, /45 мин\./);
    assert.match(alert.text, /Philosophy/);
    assert.match(alert.text, /Quiz 2\. Epistemology/);
    assert.ok(alert.replyMarkup?.inline_keyboard?.[0]?.[0]?.url.includes('jump_to/block_abc'));
    assert.equal(alert.replyMarkup?.inline_keyboard?.[0]?.[0]?.text, '🚀 Сдать квиз прямо сейчас');
});

test('Cron: sends critical 1-hour alert with sound and deduplicates repeated invocations', async () => {
    const cron = require('../api/cron.js');
    const aitu = require('../api/bot/aitu.js');
    cron.clearSentAlertsMemory();

    const originalGetQuizzes = aitu.getUpcomingQuizzes;
    const originalFetch = global.fetch;

    const sentTelegrams = [];

    try {
        aitu.getUpcomingQuizzes = async () => ({
            ok: true,
            quizzes: [
                {
                    courseId: 'course-v1:AITU+Cloud101+26-27_C1_Y3',
                    courseName: 'Cloud Technologies',
                    title: 'Midterm Quiz 1',
                    blockId: 'block_xyz789',
                    link: 'https://learn.astanait.edu.kz/courses/test/jump_to/block_xyz789',
                    dueDate: new Date(Date.now() + 50 * 60 * 1000).toISOString(),
                    diffMinutes: 50,
                    diffHours: 0.8,
                    diffDays: 0,
                    isPast: false,
                    isCriticalHour: true
                }
            ]
        });

        global.fetch = async (url, opts) => {
            if (url && url.includes('/sendMessage')) {
                const body = JSON.parse(opts.body);
                sentTelegrams.push(body);
                return {
                    ok: true,
                    json: async () => ({ ok: true, result: { message_id: 111 } })
                };
            }
            return { ok: true, json: async () => ({}) };
        };

        process.env.TELEGRAM_BOT_TOKEN = 'test_token_123';
        process.env.ADMIN_CHAT_ID = '999888';

        // Isolate 1-hour critical test from daily digest / evening checklist windows
        const statsEngine = require('../api/stats/engine.js');
        const todayStr = statsEngine.getTodayDateStr ? statsEngine.getTodayDateStr() : new Date().toISOString().slice(0, 10);
        await cron.markAlertAsSent(`daily:aitu:999888:${todayStr}`);
        await cron.markAlertAsSent(`daily:lms:999888:${todayStr}`);
        await cron.markAlertAsSent(`evening:999888:${todayStr}`);

        // 1. First invocation: should send critical alert with disable_notification: false
        let mockResJson = null;
        let mockResStatus = 200;
        const mockRes = {
            status: (s) => { mockResStatus = s; return mockRes; },
            json: (data) => { mockResJson = data; return mockRes; }
        };

        await cron({ headers: {} }, mockRes);

        assert.equal(mockResStatus, 200);
        assert.equal(mockResJson.ok, true);
        assert.equal(mockResJson.type, 'critical_1h');
        assert.equal(mockResJson.criticalSent, 1);
        assert.equal(sentTelegrams.length, 1);
        assert.equal(sentTelegrams[0].chat_id, '999888');
        assert.equal(sentTelegrams[0].disable_notification, false, 'Notification sound/vibrate must be active');
        assert.match(sentTelegrams[0].text, /Горящий дедлайн: остался 1 час/i);
        assert.ok(sentTelegrams[0].reply_markup?.inline_keyboard?.[0]?.[0]?.text.includes('Сдать квиз'));

        // 2. Second invocation: must NOT re-send duplicate alert
        mockResJson = null;
        await cron({ headers: {} }, mockRes);

        assert.equal(mockResStatus, 200);
        assert.equal(mockResJson.criticalQuizzes, 1);
        assert.equal(sentTelegrams.length, 1, 'Duplicate 1h alert must NOT be sent');
    } finally {
        aitu.getUpcomingQuizzes = originalGetQuizzes;
        global.fetch = originalFetch;
        cron.clearSentAlertsMemory();
    }
});

test('AITU Multi-User: isolated user sessions and subscriber registry', async () => {
    const aitu = require('../api/bot/aitu.js');

    // Save sessions for 2 distinct users
    await aitu.saveUserSession('user_111', 'token_user_111');
    await aitu.saveUserSession('user_222', 'token_user_222');

    // Verify isolation
    assert.equal(await aitu.getUserSession('user_111'), 'token_user_111');
    assert.equal(await aitu.getUserSession('user_222'), 'token_user_222');
    assert.equal(await aitu.getUserSession('user_333_unknown'), null);

    // Verify both are in subscribers list
    const subscribers = await aitu.getAllQuizUsers();
    assert.ok(subscribers.includes('user_111'));
    assert.ok(subscribers.includes('user_222'));

    // Delete one session and verify
    await aitu.deleteUserSession('user_111');
    assert.equal(await aitu.getUserSession('user_111'), null);
    assert.equal(await aitu.getUserSession('user_222'), 'token_user_222');

    // Clean up
    await aitu.deleteUserSession('user_222');
});

test('Cron Multi-User: sends personalized alerts to multiple users concurrently', async () => {
    const cron = require('../api/cron.js');
    const aitu = require('../api/bot/aitu.js');
    cron.clearSentAlertsMemory();

    // Register 2 users
    await aitu.saveUserSession('student_alice', 'alice_token');
    await aitu.saveUserSession('student_bob', 'bob_token');

    const originalGetQuizzes = aitu.getUpcomingQuizzes;
    const originalFetch = global.fetch;
    const sentMessages = [];

    try {
        // Mock getUpcomingQuizzes to return different quizzes based on session
        aitu.getUpcomingQuizzes = async (sid) => {
            if (sid === 'alice_token') {
                return {
                    ok: true,
                    quizzes: [{
                        courseId: 'AITU+MATH',
                        courseName: 'Mathematics',
                        title: 'Math Quiz 1',
                        blockId: 'math_q1',
                        link: 'https://learn.astanait.edu.kz/math',
                        dueDate: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
                        diffMinutes: 30,
                        diffHours: 0.5,
                        diffDays: 0,
                        isPast: false,
                        isCriticalHour: true
                    }]
                };
            }
            if (sid === 'bob_token') {
                return {
                    ok: true,
                    quizzes: [{
                        courseId: 'AITU+PHYS',
                        courseName: 'Physics',
                        title: 'Physics Quiz 3',
                        blockId: 'phys_q3',
                        link: 'https://learn.astanait.edu.kz/phys',
                        dueDate: new Date(Date.now() + 45 * 60 * 1000).toISOString(),
                        diffMinutes: 45,
                        diffHours: 0.8,
                        diffDays: 0,
                        isPast: false,
                        isCriticalHour: true
                    }]
                };
            }
            return { ok: false, error: 'unknown token' };
        };

        global.fetch = async (url, opts) => {
            if (url && url.includes('/sendMessage')) {
                sentMessages.push(JSON.parse(opts.body));
                return { ok: true, json: async () => ({ ok: true, result: {} }) };
            }
            return { ok: true, json: async () => ({}) };
        };

        process.env.TELEGRAM_BOT_TOKEN = 'test_token';
        process.env.ADMIN_CHAT_ID = ''; // Clear admin so only subscribers are processed

        let resultJson = null;
        const mockRes = {
            status: () => mockRes,
            json: (data) => { resultJson = data; }
        };

        await cron({ headers: {} }, mockRes);

        assert.equal(resultJson.ok, true);
        assert.equal(resultJson.criticalSent, 2);

        // Verify Alice received Math and Bob received Physics
        const aliceMsg = sentMessages.find(m => m.chat_id === 'student_alice');
        const bobMsg = sentMessages.find(m => m.chat_id === 'student_bob');

        assert.ok(aliceMsg, 'Alice should receive message');
        assert.ok(bobMsg, 'Bob should receive message');
        assert.match(aliceMsg.text, /Mathematics/);
        assert.match(bobMsg.text, /Physics/);

        // Verify deduplication on 2nd run
        sentMessages.length = 0;
        await cron({ headers: {} }, mockRes);
        assert.equal(sentMessages.length, 0, 'No duplicate messages sent on next check');

    } finally {
        aitu.getUpcomingQuizzes = originalGetQuizzes;
        global.fetch = originalFetch;
        await aitu.deleteUserSession('student_alice');
        await aitu.deleteUserSession('student_bob');
        cron.clearSentAlertsMemory();
    }
});

test('AITU: Gaukhar personalization and forgetfulness easter eggs', () => {
    const aitu = require('../api/bot/aitu.js');

    assert.equal(aitu.GAUHAR_CHAT_ID, '1365231049');
    assert.equal(aitu.isGauhar('1365231049'), true);
    assert.equal(aitu.isGauhar(1365231049), true);
    assert.equal(aitu.isGauhar(' 1365231049 '), true);
    assert.equal(aitu.isGauhar('999999'), false);

    const mockQuiz = {
        courseId: 'course-v1:AITU+PHIL01+26-27_C1_Y3',
        courseName: 'Philosophy',
        title: 'Quiz 2. Epistemology',
        link: 'https://learn.astanait.edu.kz/jump_to/block_abc',
        dueDate: new Date(Date.now() + 35 * 60 * 1000).toISOString(),
        diffMinutes: 35,
        diffHours: 0.6,
        diffDays: 0,
        isCriticalHour: true
    };

    // Standard vs Gaukhar critical hour alert
    const standardAlert = aitu.formatCriticalHourAlert(mockQuiz, false);
    assert.doesNotMatch(standardAlert.text, /Гаухар/);
    assert.equal(standardAlert.replyMarkup?.inline_keyboard?.[0]?.[0]?.text, '🚀 Сдать квиз прямо сейчас');

    const gauharAlert = aitu.formatCriticalHourAlert(mockQuiz, true);
    assert.match(gauharAlert.text, /Гаухар, мы знаем, что ты забыла!/);
    assert.match(gauharAlert.text, /память тебя опять подводит/);
    assert.match(gauharAlert.text, /35 мин\./);
    assert.equal(gauharAlert.replyMarkup?.inline_keyboard?.[0]?.[0]?.text, '🚀 Спасти оценку прямо сейчас');

    // Standard vs Gaukhar quizzes message
    const mockResult = {
        ok: true,
        quizzes: [mockQuiz]
    };
    const standardQuizzes = aitu.formatQuizzesMessage(mockResult, false);
    assert.doesNotMatch(standardQuizzes, /Гаухар/);

    const gauharQuizzes = aitu.formatQuizzesMessage(mockResult, true);
    assert.match(gauharQuizzes, /Квизы и дедлайны для Гаухар/);
    assert.match(gauharQuizzes, /Совет дня для Гаухар: поставь ещё три будильника/);

    // Expired session for Gaukhar
    const expiredRes = { ok: false, sessionExpired: true };
    const gauharExpired = aitu.formatQuizzesMessage(expiredRes, true);
    assert.match(gauharExpired, /Гаухар, твоя сессия learn\.astanait\.edu\.kz истекла!/);
});

test('Cron & Bot: Gaukhar receives tailored alerts and greetings', async () => {
    const cron = require('../api/cron.js');
    const aitu = require('../api/bot/aitu.js');
    const bot = require('../api/bot/index.js');
    cron.clearSentAlertsMemory();

    const GAUHAR_ID = aitu.GAUHAR_CHAT_ID;
    await aitu.saveUserSession(GAUHAR_ID, 'gaukhar_token');

    const originalGetQuizzes = aitu.getUpcomingQuizzes;
    const originalFetch = global.fetch;
    const sentMessages = [];

    try {
        aitu.getUpcomingQuizzes = async (sid) => {
            if (sid === 'gaukhar_token') {
                return {
                    ok: true,
                    quizzes: [{
                        courseId: 'course-v1:AITU+Cloud+26-27',
                        courseName: 'Cloud Computing',
                        title: 'Lab Test 1',
                        blockId: 'block_cloud',
                        link: 'https://learn.astanait.edu.kz/cloud',
                        dueDate: new Date(Date.now() + 40 * 60 * 1000).toISOString(),
                        diffMinutes: 40,
                        diffHours: 0.7,
                        diffDays: 0,
                        isPast: false,
                        isCriticalHour: true
                    }]
                };
            }
            return { ok: false, error: 'unknown' };
        };

        global.fetch = async (url, opts) => {
            if (url && url.includes('/sendMessage')) {
                sentMessages.push(JSON.parse(opts.body));
                return { ok: true, json: async () => ({ ok: true, result: {} }) };
            }
            return { ok: true, json: async () => ({}) };
        };

        process.env.TELEGRAM_BOT_TOKEN = 'test_token';
        process.env.ADMIN_CHAT_ID = '';

        let resultJson = null;
        const mockRes = {
            status: () => mockRes,
            json: (data) => { resultJson = data; }
        };

        await cron({ headers: {} }, mockRes);

        assert.equal(resultJson.ok, true);
        assert.equal(resultJson.criticalSent, 1);

        const gauharAlert = sentMessages.find(m => m.chat_id === GAUHAR_ID);
        assert.ok(gauharAlert, 'Gaukhar must receive 1h critical alert');
        assert.match(gauharAlert.text, /Гаухар, мы знаем, что ты забыла!/);
        assert.equal(gauharAlert.reply_markup?.inline_keyboard?.[0]?.[0]?.text, '🚀 Спасти оценку прямо сейчас');

        // Test /start personalized greeting for Gaukhar
        sentMessages.length = 0;
        const req = {
            method: 'POST',
            headers: {},
            body: {
                message: {
                    message_id: 1,
                    chat: { id: GAUHAR_ID },
                    from: { id: GAUHAR_ID, username: 'goshoch' },
                    text: '/start'
                }
            }
        };
        const res = {
            setHeader: () => {},
            status: () => res,
            json: () => {}
        };
        await bot(req, res);

        assert.ok(sentMessages.length > 0);
        const welcomeMsg = sentMessages[0];
        assert.match(welcomeMsg.text, /О, Гаухар \(@goshoch\), привет!/);
        assert.match(welcomeMsg.text, /Не дать Гаухар всё забыть/);

    } finally {
        aitu.getUpcomingQuizzes = originalGetQuizzes;
        global.fetch = originalFetch;
        await aitu.deleteUserSession(GAUHAR_ID);
        cron.clearSentAlertsMemory();
    }
});

test('Telegram Bot: Trolling pack 2.0 for Gaukhar (attendance, grade, GPA, help, memory, support)', async () => {
    const bot = require('../api/bot/index.js');
    const aitu = require('../api/bot/aitu.js');
    const GAUHAR_ID = aitu.GAUHAR_CHAT_ID;

    // 1. Attendance calculation trolling
    const standardAtt = bot.calculateAttendanceReport(3, 1, false);
    assert.doesNotMatch(standardAtt, /Гаухар/);

    const gauharAtt = bot.calculateAttendanceReport(3, 1, true);
    assert.match(gauharAtt, /Гаухар, зная твою забывчивость/);
    assert.match(gauharAtt, /вторник/);

    // 2. Grade forecast trolling (scholarship vs pass)
    const gauharScholarship = bot.calculateGradeReport(85, 85, null, true);
    assert.match(gauharScholarship, /стипендия на горизонте! Главное теперь — не забудь карту/);

    const gauharPass = bot.calculateGradeReport(55, 55, null, true);
    assert.match(gauharPass, /главное на экзамен не забудь прийти! Паспорт, ручку и голову/);

    // 3. GPA & CGPA screenshot trolling
    const gauharGPA = bot.calculateGPAReport('90 3, 85 4', true);
    assert.match(gauharGPA, /Гаухар, сделай скриншот и запиши куда-нибудь/);

    const gauharCGPA = bot.calculateCumulativeGPAReport('3.5 15, 3.8 20', true);
    assert.match(gauharCGPA, /Гаухар, сделай скриншот и запиши куда-нибудь/);

    // 4. Foolproof Help special edition for Gaukhar
    const standardHelp = bot.getFoolproofHelpText(false);
    assert.doesNotMatch(standardHelp, /Специальная версия инструкции для Гаухар/);

    const gauharHelp = bot.getFoolproofHelpText(true);
    assert.match(gauharHelp, /Специальная версия инструкции для Гаухар/);
    assert.match(gauharHelp, /перед сном перечитывать три раза/);

    // 5. Secret /memory express test
    const originalFetch = global.fetch;
    const sentMessages = [];
    try {
        global.fetch = async (url, opts) => {
            if (url && url.includes('/sendMessage')) {
                sentMessages.push(JSON.parse(opts.body));
                return { ok: true, json: async () => ({ ok: true, result: {} }) };
            }
            return { ok: true, json: async () => ({}) };
        };

        process.env.TELEGRAM_BOT_TOKEN = 'test_token';

        const createReq = (text, chatId = GAUHAR_ID) => ({
            method: 'POST',
            headers: {},
            body: {
                message: {
                    message_id: 2,
                    chat: { id: chatId },
                    from: { id: chatId, username: 'goshoch' },
                    text
                }
            }
        });
        const mockRes = {
            setHeader: () => {},
            status: () => mockRes,
            json: () => {}
        };

        // Gaukhar sends /memory
        await bot(createReq('/memory'), mockRes);
        assert.ok(sentMessages.length > 0);
        const memMsg = sentMessages[sentMessages.length - 1];
        assert.match(memMsg.text, /Экспресс-тест памяти для Гаухар/);
        assert.match(memMsg.text, /выключила утюг/);
        assert.match(memMsg.text, /закрыла входную дверь/);

        // Gaukhar clicks "Отзыв / Поддержка"
        await bot(createReq('Отзыв / Поддержка'), mockRes);
        const feedMsg = sentMessages[sentMessages.length - 1];
        assert.match(feedMsg.text, /Гаухар, ты точно хотела написать разработчику или случайно забыла/);

        // Another user clicking "Отзыв / Поддержка" gets standard message
        await bot(createReq('Отзыв / Поддержка', '999999'), mockRes);
        const regularFeedMsg = sentMessages[sentMessages.length - 1];
        assert.doesNotMatch(regularFeedMsg.text, /Гаухар/);

    } finally {
        global.fetch = originalFetch;
    }
});

test('LMS: iCal parser correctly extracts academic deadlines, attendance, and urgency', () => {
    const lms = require('../api/bot/lms.js');
    const mockIcal = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Moodle//NONSGML v1.0//EN
BEGIN:VEVENT
UID:assign12345@lms.astanait.edu.kz
SUMMARY:Laboratory Work 2 is due
DESCRIPTION:Please submit before deadline: https://lms.astanait.edu.kz/mod/assign/view.php?id=8888
CATEGORIES:Object-Oriented Programming (Java)
DTSTART:20261001T180000Z
DTEND:20261001T180000Z
END:VEVENT
BEGIN:VEVENT
UID:quiz54321@lms.astanait.edu.kz
SUMMARY:Quiz 3: Polymorphism
DESCRIPTION:Online quiz
CATEGORIES:Object-Oriented Programming (Java)
DTSTART:20261005T120000Z
DTEND:20261005T120000Z
END:VEVENT
BEGIN:VEVENT
UID:att99999@lms.astanait.edu.kz
SUMMARY:Attendance: Lecture 4
DESCRIPTION:Lecture attendance mark
CATEGORIES:Philosophy
DTSTART:20260930T040000Z
DTEND:20260930T053000Z
END:VEVENT
END:VCALENDAR`;

    const events = lms.parseIcalEvents(mockIcal);
    assert.equal(events.length, 3);

    const lab = events.find(e => e.id === 'assign12345');
    assert.ok(lab);
    assert.equal(lab.title, 'Laboratory Work 2');
    assert.equal(lab.courseName, 'Object-Oriented Programming (Java)');
    assert.equal(lab.isAssignment, true);
    assert.equal(lab.isAttendance, false);
    assert.equal(lab.link, 'https://lms.astanait.edu.kz/mod/assign/view.php?id=8888');

    const quiz = events.find(e => e.id === 'quiz54321');
    assert.ok(quiz);
    assert.equal(quiz.isQuiz, true);

    const att = events.find(e => e.id === 'att99999');
    assert.ok(att);
    assert.equal(att.isAttendance, true);
});

test('LMS & AITU: 55-user hard subscriber limit enforcement', async () => {
    const lms = require('../api/bot/lms.js');
    const aitu = require('../api/bot/aitu.js');

    try {
        // Clean up memory
        lms._lmsSubscribersMemory.clear();
        lms._lmsUserSessionsMemory.clear();

        const initialLimit = lms.MAX_SUBSCRIBERS_LIMIT;
        assert.ok(initialLimit >= 50);

        // Simulate subscribers up to limit
        for (let i = 1; i <= initialLimit; i++) {
            await lms.saveUserLmsSession(`student_${i}`, `https://lms.astanait.edu.kz/calendar/export_execute.php?userid=${i}&authtoken=token${i}`);
        }

        assert.equal(lms._lmsSubscribersMemory.size, initialLimit);

        // Next new student should be blocked
        const blockedCheck = await lms.canUserSubscribe(`student_${initialLimit + 1}`);
        assert.equal(blockedCheck.allowed, false);
        assert.match(blockedCheck.message, new RegExp(`Достигнут лимит активных пользователей \\(${initialLimit}\\/${initialLimit}\\)`));

        // Existing student updating session should be allowed
        const existingCheck = await lms.canUserSubscribe('student_10');
        assert.equal(existingCheck.allowed, true);
        assert.equal(existingCheck.isExisting, true);

        // Admin should always bypass limit even when full
        process.env.ADMIN_CHAT_ID = '999888777';
        const adminCheck = await lms.canUserSubscribe('999888777');
        assert.equal(adminCheck.allowed, true);

        // Same test for AITU Learn module
        aitu._quizSubscribersMemory.clear();
        const aituLimit = aitu.MAX_SUBSCRIBERS_LIMIT;
        for (let i = 1; i <= aituLimit; i++) {
            await aitu.saveUserSession(`student_aitu_${i}`, `session_${i}`);
        }
        const blockedAitu = await aitu.canUserSubscribe(`student_aitu_${aituLimit + 1}`);
        assert.equal(blockedAitu.allowed, false);
        assert.match(blockedAitu.message, new RegExp(`Достигнут лимит активных пользователей \\(${aituLimit}\\/${aituLimit}\\)`));
    } finally {
        // Cleanup
        lms._lmsSubscribersMemory.clear();
        lms._lmsUserSessionsMemory.clear();
        aitu._quizSubscribersMemory.clear();
        aitu._userSessionsMemory.clear();
    }
});

test('LMS & Cron: critical 1-hour alert and morning digest with authtoken support', async () => {
    const lms = require('../api/bot/lms.js');
    const cron = require('../api/cron.js');

    const originalFetch = global.fetch;
    const sentMessages = [];

    try {
        global.fetch = async (url, opts = {}) => {
            if (url && url.includes('/sendMessage')) {
                sentMessages.push(JSON.parse(opts.body));
                return { ok: true, json: async () => ({ ok: true, result: {} }) };
            }
            return { ok: true, json: async () => ({}) };
        };

        process.env.TELEGRAM_BOT_TOKEN = 'test_token';
        cron.clearSentAlertsMemory();

        const testChatId = '888123';
        const urgentDue = new Date(Date.now() + 45 * 60 * 1000).toISOString(); // 45 mins left

        // Mock getUpcomingDeadlinesForUser
        const originalGetDeadlines = lms.getUpcomingDeadlinesForUser;
        lms.getUpcomingDeadlinesForUser = async () => ({
            ok: true,
            academicEvents: [
                {
                    id: 'lab_final_1',
                    uid: 'lab_final_1@lms',
                    title: 'Final Project Submission',
                    courseName: 'Web Technologies',
                    dueDate: urgentDue,
                    diffMinutes: 45,
                    diffHours: 0.7,
                    diffDays: 0,
                    isCriticalHour: true,
                    isAssignment: true,
                    link: 'https://lms.astanait.edu.kz/mod/assign/view.php?id=9999'
                }
            ],
            attendanceEvents: []
        });

        // Process user LMS in cron
        const context = {
            isMorningWindow: true,
            forceSend: true,
            todayStr: '2026-09-26',
            adminChatIds: []
        };

        const res = await cron.processUserLms(testChatId, context);
        assert.equal(res.ok, true);
        assert.equal(res.criticalSent, 1);
        assert.equal(res.dailySent, 1);

        assert.equal(sentMessages.length, 2);
        const criticalMsg = sentMessages[0];
        assert.match(criticalMsg.text, /Горящий дедлайн в LMS: 1 час/i);
        assert.match(criticalMsg.text, /Final Project Submission/);
        assert.match(criticalMsg.text, /Web Technologies/);
        assert.ok(criticalMsg.reply_markup);
        assert.equal(criticalMsg.reply_markup.inline_keyboard[0][0].text, '🚀 Сдать задание в LMS');

        // Repeated run should deduplicate and send 0
        const res2 = await cron.processUserLms(testChatId, context);
        assert.equal(res2.criticalSent, 0);
        assert.equal(res2.dailySent, 0);

        lms.getUpcomingDeadlinesForUser = originalGetDeadlines;
    } finally {
        global.fetch = originalFetch;
        cron.clearSentAlertsMemory();
    }
});

test('Telegram Bot: LMS commands (/lms, /set_lms, /del_lms) and keyboard updates', async () => {
    const bot = require('../api/bot/index.js');
    const lms = require('../api/bot/lms.js');

    const originalFetch = global.fetch;
    const sentMessages = [];

    try {
        lms._lmsSubscribersMemory.clear();
        lms._lmsUserSessionsMemory.clear();

        global.fetch = async (url, opts = {}) => {
            if (url && url.includes('/sendMessage')) {
                sentMessages.push(JSON.parse(opts.body));
                return { ok: true, json: async () => ({ ok: true, result: {} }) };
            }
            return { ok: true, json: async () => ({}) };
        };

        process.env.TELEGRAM_BOT_TOKEN = 'test_token';
        const studentId = '777666555';

        const createReq = (text) => ({
            method: 'POST',
            headers: {},
            body: {
                message: {
                    message_id: 10,
                    chat: { id: studentId },
                    from: { id: studentId, username: 'student_test' },
                    text
                }
            }
        });
        const mockRes = {
            setHeader: () => {},
            status: () => mockRes,
            json: () => {}
        };

        // 1. Unsubscribed student calls /lms -> gets setup instructions
        await bot(createReq('/lms'), mockRes);
        const unsubscribedMsg = sentMessages[sentMessages.length - 1];
        assert.match(unsubscribedMsg.text, /Дедлайны Moodle LMS/);
        assert.match(unsubscribedMsg.text, /Как подключить за 1 минуту/);

        // 2. Keyboard for unsubscribed student has NO LMS button
        const kbBefore = bot.getMainKeyboard(studentId);
        const hasLmsBefore = kbBefore.keyboard.some(row => row.some(btn => btn.text.includes('LMS')));
        assert.equal(hasLmsBefore, false);

        // 3. Connect LMS via /set_lms
        const originalGetDeadlines = lms.getUpcomingDeadlines;
        lms.getUpcomingDeadlines = async () => ({
            ok: true,
            calendarUrl: 'https://lms.astanait.edu.kz/calendar/export_execute.php?userid=123&authtoken=abc',
            academicEvents: [
                {
                    id: '1',
                    title: 'Lab 1',
                    courseName: 'Java',
                    dueDate: new Date(Date.now() + 86400000).toISOString(),
                    diffMinutes: 1440,
                    diffDays: 1,
                    isPast: false,
                    link: 'https://lms.astanait.edu.kz/'
                }
            ],
            attendanceEvents: [],
            quizzesCount: 1
        });

        await bot(createReq('/set_lms valid_session_token'), mockRes);
        const connectMsg = sentMessages[sentMessages.length - 1];
        assert.match(connectMsg.text, /Moodle LMS успешно подключен!/);
        assert.match(connectMsg.text, /вечный токен календаря/);

        // 4. Keyboard for subscribed student now HAS LMS button
        const kbAfter = bot.getMainKeyboard(studentId);
        const hasLmsAfter = kbAfter.keyboard.some(row => row.some(btn => btn.text.includes('LMS')));
        assert.equal(hasLmsAfter, true);

        // 5. Disconnect via /del_lms
        await bot(createReq('/del_lms'), mockRes);
        const disconnectMsg = sentMessages[sentMessages.length - 1];
        assert.match(disconnectMsg.text, /Сессия Moodle LMS отключена/);

        // 6. Keyboard returns to clean state
        const kbFinal = bot.getMainKeyboard(studentId);
        const hasLmsFinal = kbFinal.keyboard.some(row => row.some(btn => btn.text.includes('LMS')));
        assert.equal(hasLmsFinal, false);

        lms.getUpcomingDeadlines = originalGetDeadlines;
    } finally {
        lms._lmsSubscribersMemory.clear();
        lms._lmsUserSessionsMemory.clear();
        global.fetch = originalFetch;
        await lms.deleteUserLmsSession('777666555');
    }
});

test('Telegram Bot: Cookie guide text and commands (/cookie, /cookies, /гайд, wiz_cookie_guide)', async () => {
    const bot = require('../api/bot/index.js');
    const guideRegular = bot.getCookieGuideText(false);
    assert.match(guideRegular, /Как подключить куки и напоминания/i);
    assert.match(guideRegular, /learn\.astanait\.edu\.kz/);
    assert.match(guideRegular, /sessionid/);
    assert.match(guideRegular, /MoodleSession/);
    assert.match(guideRegular, /F12/);
    assert.match(guideRegular, /Application/);
    assert.match(guideRegular, /Экспорт календаря Moodle/);

    const guideGauhar = bot.getCookieGuideText(true);
    assert.match(guideGauhar, /Пошаговый гайд по кукам специально для Гаухар/);
    assert.match(guideGauhar, /чтобы не спрашивать разработчика через 5 минут/);

    // Test bot commands triggering guide
    const originalFetch = global.fetch;
    const sentMessages = [];
    try {
        global.fetch = async (url, opts = {}) => {
            if (url && url.includes('/sendMessage')) {
                sentMessages.push(JSON.parse(opts.body));
                return { ok: true, json: async () => ({ ok: true, result: {} }) };
            }
            return { ok: true, json: async () => ({}) };
        };

        process.env.TELEGRAM_BOT_TOKEN = 'test_token';
        const createReq = (text) => ({
            method: 'POST',
            headers: {},
            body: {
                message: {
                    message_id: 20,
                    chat: { id: '1234567' },
                    from: { id: '1234567', username: 'student' },
                    text
                }
            }
        });
        const mockRes = {
            setHeader: () => {},
            status: () => mockRes,
            json: () => {}
        };

        // 1. /cookie
        await bot(createReq('/cookie'), mockRes);
        assert.ok(sentMessages.length > 0);
        assert.match(sentMessages[sentMessages.length - 1].text, /Как подключить куки и напоминания/i);

        // 2. /гайд
        await bot(createReq('/гайд'), mockRes);
        assert.match(sentMessages[sentMessages.length - 1].text, /Как подключить куки и напоминания/i);

        // 3. /set_lms without params
        await bot(createReq('/set_lms'), mockRes);
        assert.match(sentMessages[sentMessages.length - 1].text, /Как подключить куки и напоминания/i);

        // 4. /телефон and /mobile
        await bot(createReq('/телефон'), mockRes);
        assert.match(sentMessages[sentMessages.length - 1].text, /Инструкция с телефона/i);

        await bot(createReq('гайд как с телефона'), mockRes);
        assert.match(sentMessages[sentMessages.length - 1].text, /Инструкция с телефона/i);

        // 5. Callback query wiz_cookie_guide
        const callbackReq = {
            method: 'POST',
            headers: {},
            body: {
                callback_query: {
                    id: 'cq_123',
                    message: { chat: { id: '1234567' }, message_id: 21 },
                    data: 'wiz_cookie_guide'
                }
            }
        };
        await bot(callbackReq, mockRes);
        assert.match(sentMessages[sentMessages.length - 1].text, /Как подключить куки и напоминания/i);

    } finally {
        global.fetch = originalFetch;
    }
});

test('LMS & Learn: marking assignments and quizzes completed isolates them from deadlines, alarms and digests', async () => {
    const lms = require('../api/bot/lms.js');
    const aitu = require('../api/bot/aitu.js');
    const cron = require('../api/cron.js');

    const originalFetch = global.fetch;
    const originalGetUpcomingQuizzes = aitu.getUpcomingQuizzes;
    const sentMessages = [];

    try {
        const studentId = 'student_done_999';

        // 1. LMS manual completion
        await lms.clearUserCompletedLmsEvents(studentId);
        assert.strictEqual((await lms.getUserCompletedLmsEvents(studentId)).size, 0);

        await lms.markLmsEventCompleted(studentId, 'evt_101');
        const lmsCompleted = await lms.getUserCompletedLmsEvents(studentId);
        assert.ok(lmsCompleted.has('evt_101'));

        // Mock LMS result with 2 academic events
        const mockLmsCalendar = [
            'BEGIN:VCALENDAR',
            'VERSION:2.0',
            'BEGIN:VEVENT',
            'UID:evt_101@lms.astanait.edu.kz',
            'SUMMARY:Assignment 1. Lab1 is due',
            'CATEGORIES:Computer Networks',
            `DTSTART:${new Date(Date.now() + 3600000 * 1).toISOString().replace(/[-:]/g, '').split('.')[0]}Z`,
            `DTEND:${new Date(Date.now() + 3600000 * 1).toISOString().replace(/[-:]/g, '').split('.')[0]}Z`,
            'DESCRIPTION:https://lms.astanait.edu.kz/mod/assign/view.php?id=79995',
            'END:VEVENT',
            'BEGIN:VEVENT',
            'UID:evt_102@lms.astanait.edu.kz',
            'SUMMARY:Assignment 2. Lab2 is due',
            'CATEGORIES:Computer Networks',
            `DTSTART:${new Date(Date.now() + 3600000 * 2).toISOString().replace(/[-:]/g, '').split('.')[0]}Z`,
            `DTEND:${new Date(Date.now() + 3600000 * 2).toISOString().replace(/[-:]/g, '').split('.')[0]}Z`,
            'DESCRIPTION:https://lms.astanait.edu.kz/mod/assign/view.php?id=79996',
            'END:VEVENT',
            'END:VCALENDAR'
        ].join('\r\n');

        // Override fetch for calendar
        global.fetch = async (url, opts = {}) => {
            if (url && url.includes('export_execute.php')) {
                return {
                    ok: true,
                    status: 200,
                    text: async () => mockLmsCalendar
                };
            }
            if (url && url.includes('/sendMessage')) {
                sentMessages.push(JSON.parse(opts.body));
                return { ok: true, json: async () => ({ ok: true, result: {} }) };
            }
            return { ok: true, json: async () => ({}) };
        };

        await lms.saveUserLmsSession(studentId, 'https://lms.astanait.edu.kz/calendar/export_execute.php?userid=123&authtoken=abc');

        const lmsResult = await lms.getUpcomingDeadlinesForUser(studentId);
        assert.strictEqual(lmsResult.quizzesCount, 1, 'Only uncompleted event counted in active quizzesCount');
        assert.strictEqual(lmsResult.completedCount, 1);
        assert.strictEqual(lmsResult.pendingCount, 1);
        assert.strictEqual(lmsResult.activeAcademicEvents[0].id, 'evt_102');
        assert.strictEqual(lmsResult.completedAcademicEvents[0].id, 'evt_101');

        // Format active view
        const activeText = lms.formatLmsDeadlinesMessage(lmsResult);
        assert.match(activeText, /Assignment 2\. Lab2/);
        assert.doesNotMatch(activeText, /Assignment 1\. Lab1/);
        assert.match(activeText, /Сдано вами: <b>1<\/b> заданий/);

        // Format completed view
        const completedText = lms.formatLmsDeadlinesMessage(lmsResult, false, true);
        assert.match(completedText, /Assignment 1\. Lab1/);
        assert.doesNotMatch(completedText, /Assignment 2\. Lab2/);

        // Unmark LMS event
        await lms.unmarkLmsEventCompleted(studentId, 'evt_101');
        assert.strictEqual((await lms.getUserCompletedLmsEvents(studentId)).size, 0);

        // 2. AITU Learn manual completion
        await aitu.clearUserCompletedQuizzes(studentId);
        assert.strictEqual((await aitu.getUserCompletedQuizzes(studentId)).size, 0);

        await aitu.markQuizCompleted(studentId, 'block_quiz_philosophy');
        const learnCompleted = await aitu.getUserCompletedQuizzes(studentId);
        assert.ok(learnCompleted.has('block_quiz_philosophy'));

        // Mock upcoming quizzes
        aitu.getUpcomingQuizzes = async () => ({
            ok: true,
            quizzes: [
                {
                    id: 'block_quiz_philosophy',
                    blockId: 'block_quiz_philosophy',
                    shortId: 'block_quiz_philosophy',
                    courseName: 'Philosophy',
                    title: 'Quiz 2. Epistemology',
                    link: 'https://learn.astanait.edu.kz/quiz2',
                    dueDate: new Date(Date.now() + 3600000 * 5).toISOString(),
                    diffMinutes: 300,
                    diffHours: 5,
                    diffDays: 1,
                    isPast: false,
                    isCompleted: false
                },
                {
                    id: 'block_quiz_math',
                    blockId: 'block_quiz_math',
                    shortId: 'block_quiz_math',
                    courseName: 'Calculus',
                    title: 'Quiz 1. Limits',
                    link: 'https://learn.astanait.edu.kz/quiz1',
                    dueDate: new Date(Date.now() + 3600000 * 2).toISOString(),
                    diffMinutes: 120,
                    diffHours: 2,
                    diffDays: 0,
                    isPast: false,
                    isCompleted: false
                }
            ]
        });

        await aitu.saveUserSession(studentId, 'test_session_xyz');
        const learnResult = await aitu.getUpcomingQuizzesForUser(studentId);
        assert.strictEqual(learnResult.completedCount, 1);
        assert.strictEqual(learnResult.pendingCount, 1);
        assert.strictEqual(learnResult.activeQuizzes[0].id, 'block_quiz_math');
        assert.strictEqual(learnResult.completedQuizzes[0].id, 'block_quiz_philosophy');

        // Verify active view excludes completed quiz
        const learnActiveText = aitu.formatQuizzesMessage(learnResult);
        assert.match(learnActiveText, /Calculus/);
        assert.doesNotMatch(learnActiveText, /Philosophy/);
        assert.match(learnActiveText, /Сдано вами: <b>1<\/b> квизов/);

        // Verify completed view
        const learnCompText = aitu.formatQuizzesMessage(learnResult, false, true);
        assert.match(learnCompText, /Philosophy/);
        assert.doesNotMatch(learnCompText, /Calculus/);

        // 3. Cron exclusion: completed items do NOT trigger 1h critical sirens
        sentMessages.length = 0;
        cron.clearSentAlertsMemory();

        // If Philosophy quiz is in critical hour (e.g. 45 min left) but completed
        aitu.getUpcomingQuizzes = async () => ({
            ok: true,
            quizzes: [
                {
                    id: 'block_quiz_philosophy',
                    blockId: 'block_quiz_philosophy',
                    shortId: 'block_quiz_philosophy',
                    courseName: 'Philosophy',
                    title: 'Quiz 2. Epistemology',
                    link: 'https://learn.astanait.edu.kz/quiz2',
                    dueDate: new Date(Date.now() + 45 * 60000).toISOString(),
                    diffMinutes: 45,
                    diffHours: 0.75,
                    diffDays: 0,
                    isPast: false,
                    isCriticalHour: true,
                    isCompleted: false
                }
            ]
        });

        await cron.processUserQuizzes(studentId, {
            isMorningWindow: false,
            forceSend: false,
            todayStr: '2026-09-26',
            adminChatIds: []
        });
        assert.strictEqual(sentMessages.length, 0, 'Completed quiz must NOT trigger critical 1-hour alarm!');

        await lms.deleteUserLmsSession(studentId);
        await aitu.deleteUserSession(studentId);
    } finally {
        global.fetch = originalFetch;
        aitu.getUpcomingQuizzes = originalGetUpcomingQuizzes;
    }
});

test('Telegram Bot: /done command, keyboards, and callback query flows for completed tasks', async () => {
    const bot = require('../api/bot/index.js');
    const lms = require('../api/bot/lms.js');
    const aitu = require('../api/bot/aitu.js');

    const originalFetch = global.fetch;
    const sentMessages = [];
    const editedMessages = [];
    const answeredQueries = [];

    try {
        global.fetch = async (url, opts = {}) => {
            if (url && url.includes('/sendMessage')) {
                sentMessages.push(JSON.parse(opts.body));
                return { ok: true, json: async () => ({ ok: true, result: { message_id: 101 } }) };
            }
            if (url && url.includes('/editMessageText')) {
                editedMessages.push(JSON.parse(opts.body));
                return { ok: true, json: async () => ({ ok: true, result: { message_id: 101 } }) };
            }
            if (url && url.includes('/answerCallbackQuery')) {
                answeredQueries.push(JSON.parse(opts.body));
                return { ok: true, json: async () => ({ ok: true, result: true }) };
            }
            return { ok: true, json: async () => ({}) };
        };

        process.env.TELEGRAM_BOT_TOKEN = 'test_token_flow';
        const studentId = 'student_flow_123';

        // 1. Keyboard generation tests
        const kbWithActive = bot.getLmsSessionKeyboard({
            academicEvents: [{ id: '1', title: 'Lab 1' }],
            completedCount: 2
        }, 'active');
        assert.ok(kbWithActive.inline_keyboard.some(row => row.some(btn => btn.callback_data === 'lms_mark_menu')));
        assert.ok(kbWithActive.inline_keyboard.some(row => row.some(btn => btn.callback_data === 'lms_show_completed')));

        const kbCompletedMode = bot.getLmsSessionKeyboard({}, 'completed');
        assert.ok(kbCompletedMode.inline_keyboard.some(row => row.some(btn => btn.callback_data === 'user_lms_refresh')));

        const learnKb = bot.getLearnSessionKeyboard({
            activeQuizzes: [{ id: 'q1', title: 'Quiz 1' }],
            completedCount: 1
        }, 'active');
        assert.ok(learnKb.inline_keyboard.some(row => row.some(btn => btn.callback_data === 'learn_mark_menu')));
        assert.ok(learnKb.inline_keyboard.some(row => row.some(btn => btn.callback_data === 'learn_show_completed')));

        // 2. /done command test without active sessions
        const mockRes = { setHeader: () => {}, status: () => mockRes, json: () => {} };
        const msgReq = (text) => ({
            method: 'POST',
            headers: {},
            body: {
                message: {
                    message_id: 1,
                    chat: { id: studentId },
                    from: { id: studentId, username: 'flow_user' },
                    text
                }
            }
        });

        await bot(msgReq('/done'), mockRes);
        assert.match(sentMessages[sentMessages.length - 1].text, /У вас пока не подключены ни LMS, ни AITU Learn/);

        // Connect LMS session
        await lms.saveUserLmsSession(studentId, 'https://lms.astanait.edu.kz/calendar/export_execute.php?userid=5&authtoken=zzz');

        // /done with LMS connected
        await bot(msgReq('/сдал'), mockRes);
        const lastMsg = sentMessages[sentMessages.length - 1];
        assert.match(lastMsg.text, /Управление сданными заданиями/);
        assert.ok(lastMsg.reply_markup.inline_keyboard.some(row => row.some(btn => btn.callback_data === 'lms_mark_menu')));

        // 3. Callback queries: mark LMS event completed and unmark
        const cbReq = (data) => ({
            method: 'POST',
            headers: {},
            body: {
                callback_query: {
                    id: 'cq_test_1',
                    message: { chat: { id: studentId }, message_id: 88 },
                    data
                }
            }
        });

        // Mark event 777 done
        await bot(cbReq('mark_lms_777'), mockRes);
        const completedEvents = await lms.getUserCompletedLmsEvents(studentId);
        assert.ok(completedEvents.has('777'));

        // Unmark event 777
        await bot(cbReq('unmark_lms_777'), mockRes);
        const completedAfterUnmark = await lms.getUserCompletedLmsEvents(studentId);
        assert.strictEqual(completedAfterUnmark.has('777'), false);

        // Mark learn quiz done
        await bot(cbReq('mark_lrn_quiz99'), mockRes);
        const completedQuizzes = await aitu.getUserCompletedQuizzes(studentId);
        assert.ok(completedQuizzes.has('quiz99'));

        // Unmark learn quiz
        await bot(cbReq('unmark_lrn_quiz99'), mockRes);
        const quizzesAfterUnmark = await aitu.getUserCompletedQuizzes(studentId);
        assert.strictEqual(quizzesAfterUnmark.has('quiz99'), false);

        // Cleanup
        await lms.deleteUserLmsSession(studentId);
        await aitu.deleteUserSession(studentId);
    } finally {
        global.fetch = originalFetch;
    }
});

test('Top-3: SWR in-memory caching and snapshot fallback on 502/timeout for LMS and Learn', async () => {
    const lms = require('../api/bot/lms.js');
    const aitu = require('../api/bot/aitu.js');

    const originalFetch = global.fetch;
    let fetchCount = 0;
    let shouldFail = false;

    try {
        const dummyIcal = [
            'BEGIN:VCALENDAR',
            'VERSION:2.0',
            'BEGIN:VEVENT',
            'UID:swr_evt_1@lms.astanait.edu.kz',
            'SUMMARY:Lab Assignment 1 is due',
            'CATEGORIES:Cloud Computing',
            `DTSTART:${new Date(Date.now() + 3600000 * 2).toISOString().replace(/[-:]/g, '').split('.')[0]}Z`,
            `DTEND:${new Date(Date.now() + 3600000 * 2).toISOString().replace(/[-:]/g, '').split('.')[0]}Z`,
            'DESCRIPTION:https://lms.astanait.edu.kz/mod/assign/view.php?id=123',
            'END:VEVENT',
            'END:VCALENDAR'
        ].join('\r\n');

        global.fetch = async (url) => {
            fetchCount++;
            if (shouldFail) {
                return {
                    ok: false,
                    status: 502,
                    text: async () => '502 Bad Gateway'
                };
            }
            if (url && url.includes('export_execute.php')) {
                return {
                    ok: true,
                    status: 200,
                    text: async () => dummyIcal
                };
            }
            if (url && url.includes('/dashboard')) {
                return {
                    ok: true,
                    status: 200,
                    text: async () => `<a href="/courses/course-v1:AITU+Cloud101+26-27_C1_Y3/course/">Cloud</a>`
                };
            }
            if (url && url.includes('/course/')) {
                return {
                    ok: true,
                    status: 200,
                    text: async () => `<a class="outline-button" id="block@swr_q1"><h4 class="subsection-title">Quiz 1</h4><div data-datetime="${new Date(Date.now() + 3600000 * 3).toISOString()}" data-string="до"></div></a>`
                };
            }
            return { ok: true, status: 200, text: async () => '' };
        };

        const calUrl = 'https://lms.astanait.edu.kz/calendar/export_execute.php?userid=77&authtoken=swr_token';
        lms._lmsCacheMemory.clear();
        lms._lmsLastSuccessfulSnapshot.clear();

        // 1. First LMS fetch succeeds and primes cache and snapshot
        fetchCount = 0;
        const res1 = await lms.getUpcomingDeadlines(calUrl);
        assert.ok(res1.ok);
        assert.strictEqual(fetchCount, 1);
        assert.strictEqual(res1.quizzesCount, 1);

        // 2. Second immediate call uses SWR memory cache without network fetch
        const res2 = await lms.getUpcomingDeadlines(calUrl);
        assert.ok(res2.ok);
        assert.strictEqual(fetchCount, 1, 'Subsequent call within 60s must use SWR cache');

        // 3. Upstream LMS goes down (502 Bad Gateway) -> snapshot fallback is served with isStale: true
        shouldFail = true;
        const resStale = await lms.getUpcomingDeadlines(calUrl, true);
        assert.ok(resStale.ok, 'Must succeed with stale snapshot');
        assert.strictEqual(resStale.isStale, true);
        const staleFormatted = lms.formatLmsDeadlinesMessage(resStale);
        assert.match(staleFormatted, /Сервер LMS сейчас перегружен/);
        assert.match(staleFormatted, /Lab Assignment 1/);

        // 4. AITU Learn SWR caching & snapshot fallback
        aitu._quizCacheMemory.clear();
        aitu._quizLastSuccessfulSnapshot.clear();
        shouldFail = false;
        fetchCount = 0;

        const dummySid = 'sid_swr_test_xyz';
        const qRes1 = await aitu.getUpcomingQuizzes(dummySid);
        assert.ok(qRes1.ok);
        assert.strictEqual(qRes1.quizzes.length, 1);
        const qFetchInitial = fetchCount;

        // Second call within 60s
        const qRes2 = await aitu.getUpcomingQuizzes(dummySid);
        assert.ok(qRes2.ok);
        assert.strictEqual(fetchCount, qFetchInitial, 'Subsequent quiz call within 60s must use SWR cache');

        // Learn server fails -> snapshot fallback
        shouldFail = true;
        const qStale = await aitu.getUpcomingQuizzes(dummySid, true);
        assert.ok(qStale.ok);
        assert.strictEqual(qStale.isStale, true);
        const qStaleMsg = aitu.formatQuizzesMessage(qStale);
        assert.match(qStaleMsg, /Сервер Learn сейчас перегружен/);
        assert.match(qStaleMsg, /Quiz 1/);
    } finally {
        global.fetch = originalFetch;
    }
});

test('Top-2 & Top-4: Default weekly view, getEndOfWeek, and interactive course filtering', () => {
    const lms = require('../api/bot/lms.js');
    const aitu = require('../api/bot/aitu.js');
    const bot = require('../api/bot/index.js');

    // 1. Test getEndOfWeek calculation in UTC+5
    const testNow = new Date('2026-09-23T10:00:00Z'); // Wednesday
    const endOfWeek = lms.getEndOfWeek(testNow);
    assert.strictEqual(endOfWeek.toISOString(), '2026-09-27T18:59:59.999Z');

    // 2. LMS mock result with events on current week and future weeks across different courses
    const mockLms = {
        ok: true,
        academicEvents: [
            {
                id: 'ev_week',
                courseName: 'Computer Networks',
                title: 'CN Lab 1',
                dueDate: '2026-09-25T12:00:00Z',
                diffDays: 2,
                diffHours: 48,
                diffMinutes: 2880,
                link: 'https://lms.astanait.edu.kz/mod/assign/view.php?id=1'
            },
            {
                id: 'ev_next',
                courseName: 'Operating Systems',
                title: 'OS Assignment 2',
                dueDate: '2026-10-15T12:00:00Z',
                diffDays: 22,
                diffHours: 528,
                diffMinutes: 31680,
                link: 'https://lms.astanait.edu.kz/mod/assign/view.php?id=2'
            }
        ]
    };

    // Default view: week mode (only this week's items shown)
    const weekMsg = lms.formatLmsDeadlinesMessage(mockLms, false, false, 'week');
    assert.match(weekMsg, /CN Lab 1/);
    assert.doesNotMatch(weekMsg, /OS Assignment 2/);
    assert.match(weekMsg, /Показаны задачи на эту неделю: <b>1<\/b>/);

    // Full semester view: all items shown
    const allMsg = lms.formatLmsDeadlinesMessage(mockLms, false, false, 'all');
    assert.match(allMsg, /CN Lab 1/);
    assert.match(allMsg, /OS Assignment 2/);

    // Course filter: filter by 'Computer Networks'
    const cnMsg = lms.formatLmsDeadlinesMessage(mockLms, false, false, 'all', 'Computer Networks');
    assert.match(cnMsg, /CN Lab 1/);
    assert.doesNotMatch(cnMsg, /OS Assignment 2/);

    // Course filter: filter by 'Operating Systems'
    const osMsg = lms.formatLmsDeadlinesMessage(mockLms, false, false, 'all', 'Operating Systems');
    assert.match(osMsg, /OS Assignment 2/);
    assert.doesNotMatch(osMsg, /CN Lab 1/);

    // Keyboards support week and all modes
    const kbWeek = bot.getLmsSessionKeyboard(mockLms, 'week');
    assert.ok(kbWeek.inline_keyboard.some(r => r.some(b => b.callback_data === 'lms_view_all')));
    assert.ok(kbWeek.inline_keyboard.some(r => r.some(b => b.callback_data === 'lms_courses_menu')));

    const kbAll = bot.getLmsSessionKeyboard(mockLms, 'all');
    assert.ok(kbAll.inline_keyboard.some(r => r.some(b => b.callback_data === 'lms_view_week')));

    // 3. AITU Learn course filtering and week view
    const mockLearn = {
        ok: true,
        quizzes: [
            {
                id: 'q_curr',
                courseName: 'Philosophy',
                title: 'Philosophy Quiz 1',
                dueDate: '2026-09-25T15:00:00Z',
                diffDays: 2,
                diffHours: 48,
                diffMinutes: 2880,
                isPast: false,
                isCompleted: false,
                link: 'https://learn.astanait.edu.kz/q1'
            },
            {
                id: 'q_later',
                courseName: 'Cloud Computing',
                title: 'Cloud Quiz 5',
                dueDate: '2026-11-05T15:00:00Z',
                diffDays: 45,
                diffHours: 1000,
                diffMinutes: 60000,
                isPast: false,
                isCompleted: false,
                link: 'https://learn.astanait.edu.kz/q5'
            }
        ]
    };

    const learnWeekMsg = aitu.formatQuizzesMessage(mockLearn, false, false, 'week');
    assert.match(learnWeekMsg, /Philosophy Quiz 1/);
    assert.doesNotMatch(learnWeekMsg, /Cloud Quiz 5/);

    const learnFilterMsg = aitu.formatQuizzesMessage(mockLearn, false, false, 'all', 'Cloud Computing');
    assert.match(learnFilterMsg, /Cloud Quiz 5/);
    assert.doesNotMatch(learnFilterMsg, /Philosophy Quiz 1/);
});

test('Top-6: Natural language academic query parser and AITU rules verification', () => {
    const bot = require('../api/bot/index.js');

    // 1. Standard question for final score needed
    const q1 = bot.parseNaturalLanguageAcademicQuery('сколько надо на файнале если регмид 80 регенд 70');
    assert.ok(q1);
    assert.match(q1, /Прогноз на экзамен/i);
    assert.match(q1, /75\.00/);

    // 2. Question for specific target grade B+ (85)
    const q2 = bot.parseNaturalLanguageAcademicQuery('сколько надо на файнале на B+ если рм 85 рэ 80');
    assert.ok(q2);
    assert.match(q2, /Сколько нужно на экзамене для B\+:/);
    assert.match(q2, /89 баллов/);

    // 3. Question verifying given final score: "хватит ли 75 на экзамене на B+ если рм 85 рэ 80"
    const q3 = bot.parseNaturalLanguageAcademicQuery('хватит ли 75 на экзамене на B+ если рм 85 рэ 80');
    assert.ok(q3);
    assert.match(q3, /Нет, не хватит/i);
    assert.match(q3, /79.50/);

    // 4. Question verifying given final score: "хватит ли 90 на экзамене на стипендию если рм 80 рэ 80"
    const q4 = bot.parseNaturalLanguageAcademicQuery('хватит ли 90 на экзамене на стипендию если рм 80 рэ 80');
    assert.ok(q4);
    assert.match(q4, /Да, хватит с запасом/i);
    assert.match(q4, /84.00/);

    // 5. AITU final exam passing threshold: score < 50 on final is rejected regardless of high midterm
    const q5 = bot.parseNaturalLanguageAcademicQuery('хватит ли 45 на файнале если регмид 95 регенд 95');
    assert.ok(q5);
    assert.match(q5, /Нет, не хватит/i);
    assert.match(q5, /минимум 50 баллов/);

    // 6. AITU admission threshold: midterm < 25 rejects admission
    const q6 = bot.parseNaturalLanguageAcademicQuery('сколько нужно на экзамене если регмид 20 регенд 80');
    assert.ok(q6);
    assert.match(q6, /Недопуск к экзамену/);
    assert.match(q6, /не менее <b>25<\/b>/);

    // 7. Non-academic text returns null
    assert.strictEqual(bot.parseNaturalLanguageAcademicQuery('привет как дела'), null);
});

test('Rate Limiter: 5-minute timeout on NLP queries and feedback, admins exempt, wizards unblocked', async () => {
    const bot = require('../api/bot/index.js');
    const studentChatId = 'student_rl_test_456';
    const adminChatId = (process.env.ADMIN_CHAT_ID || '1365231049').split(/[,\s;]+/)[0];

    bot._userRateLimits.clear();

    // 1. Initial check: allowed
    const rl1 = bot.checkRateLimit(studentChatId);
    assert.strictEqual(rl1.allowed, true);

    // Record rate limit (user sent an NLP query or feedback)
    bot.recordRateLimit(studentChatId);

    // 2. Immediate second check: rejected with remaining time
    const rl2 = bot.checkRateLimit(studentChatId);
    assert.strictEqual(rl2.allowed, false);
    assert.ok(rl2.remainingMin > 0);
    assert.match(rl2.message, /1 раз в 5 минут/);

    // 3. Admin is exempt even right after recording
    bot.recordRateLimit(adminChatId);
    const rlAdmin = bot.checkRateLimit(adminChatId);
    assert.strictEqual(rlAdmin.allowed, true, 'Admins must never be rate limited');

    // Cleanup
    bot._userRateLimits.clear();
});

test('Message Routing: Cancel buttons, greetings, unknown commands, and feedback routing', async () => {
    const bot = require('../api/bot/index.js');
    const studentChatId = 'student_msg_routing_789';
    const adminChatId = (process.env.ADMIN_CHAT_ID || '1365231049').split(/[,\s;]+/)[0];

    const originalFetch = global.fetch;
    const sentApiMessages = [];

    global.fetch = async (url, options = {}) => {
        if (url && url.includes('telegram.org')) {
            const body = options.body ? JSON.parse(options.body) : {};
            sentApiMessages.push({ url, body });
            return {
                ok: true,
                status: 200,
                json: async () => ({ ok: true, result: { message_id: 12345 } })
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

        // 1. Student taps "Отмена / Главное меню" (with or without ❌)
        sentApiMessages.length = 0;
        await bot({
            method: 'POST',
            body: { message: { chat: { id: studentChatId }, text: 'Отмена / Главное меню', from: { id: studentChatId, username: 'testuser' } } }
        }, mockRes);

        assert.strictEqual(sentApiMessages.length, 1);
        assert.match(sentApiMessages[0].body.text, /Действие отменено/);
        assert.strictEqual(sentApiMessages.some(m => String(m.body.chat_id) === String(adminChatId)), false, 'Cancel button must never forward to admin');
        assert.strictEqual(bot.checkRateLimit(studentChatId).allowed, true, 'Cancel must not rate limit');

        // 2. Student taps "❌ Отмена / Главное меню"
        sentApiMessages.length = 0;
        await bot({
            method: 'POST',
            body: { message: { chat: { id: studentChatId }, text: '❌ Отмена / Главное меню', from: { id: studentChatId, username: 'testuser' } } }
        }, mockRes);
        assert.match(sentApiMessages[0].body.text, /Действие отменено/);
        assert.strictEqual(sentApiMessages.some(m => String(m.body.chat_id) === String(adminChatId)), false);

        // 3. Greeting "Привет"
        sentApiMessages.length = 0;
        await bot({
            method: 'POST',
            body: { message: { chat: { id: studentChatId }, text: 'Привет', from: { id: studentChatId, username: 'testuser' } } }
        }, mockRes);
        assert.strictEqual(sentApiMessages.length, 1);
        assert.match(sentApiMessages[0].body.text, /Привет!/);
        assert.strictEqual(sentApiMessages.some(m => String(m.body.chat_id) === String(adminChatId)), false);
        assert.strictEqual(bot.checkRateLimit(studentChatId).allowed, true, 'Greetings must not rate limit');

        // 4. Typo slash command "/calck"
        sentApiMessages.length = 0;
        await bot({
            method: 'POST',
            body: { message: { chat: { id: studentChatId }, text: '/calck', from: { id: studentChatId, username: 'testuser' } } }
        }, mockRes);
        assert.strictEqual(sentApiMessages.length, 1);
        assert.match(sentApiMessages[0].body.text, /Неизвестная команда/);
        assert.strictEqual(sentApiMessages.some(m => String(m.body.chat_id) === String(adminChatId)), false);

        // 5. Short noise "???"
        sentApiMessages.length = 0;
        await bot({
            method: 'POST',
            body: { message: { chat: { id: studentChatId }, text: '???', from: { id: studentChatId, username: 'testuser' } } }
        }, mockRes);
        assert.strictEqual(sentApiMessages.length, 1);
        assert.match(sentApiMessages[0].body.text, /Не удалось распознать/);
        assert.strictEqual(sentApiMessages.some(m => String(m.body.chat_id) === String(adminChatId)), false);

        // 6. Gratitude "Спасибо"
        sentApiMessages.length = 0;
        await bot({
            method: 'POST',
            body: { message: { chat: { id: studentChatId }, text: 'спасибо большое', from: { id: studentChatId, username: 'testuser' } } }
        }, mockRes);
        assert.strictEqual(sentApiMessages.length, 1);
        assert.match(sentApiMessages[0].body.text, /Пожалуйста/);
        assert.strictEqual(sentApiMessages.some(m => String(m.body.chat_id) === String(adminChatId)), false);

        // 7. Legitimate feedback in feed_input step is delivered to admin
        bot._userRateLimits.clear();
        sentApiMessages.length = 0;
        // Enter feedback mode
        await bot({
            method: 'POST',
            body: { message: { chat: { id: studentChatId }, text: 'Отзыв / Поддержка', from: { id: studentChatId, username: 'testuser' } } }
        }, mockRes);

        sentApiMessages.length = 0;
        // Send real message
        await bot({
            method: 'POST',
            body: { message: { chat: { id: studentChatId }, text: 'Хотелось бы добавить темную тему в бот', from: { id: studentChatId, username: 'testuser' } } }
        }, mockRes);

        const adminMsg = sentApiMessages.find(m => String(m.body.chat_id) === String(adminChatId));
        assert.ok(adminMsg, 'Feedback must be forwarded to admin');
        assert.match(adminMsg.body.text, /Хотелось бы добавить темную тему/);

        // Cleanup
        bot._userRateLimits.clear();
    } finally {
        global.fetch = originalFetch;
    }
});

test('Auto-detection: Calendar export URL and Learn cookie automatically connect without /set_lms or admin forward', async () => {
    const bot = require('../api/bot/index.js');
    const lms = require('../api/bot/lms.js');
    const aitu = require('../api/bot/aitu.js');

    const studentId = 'student_cal_autodetect_123';
    const adminChatId = (process.env.ADMIN_CHAT_ID || '1365231049').split(/[,\s;]+/)[0];

    const sampleCalendarUrl = 'https://lms.astanait.edu.kz/calendar/export_execute.php?userid=18258&authtoken=0d3c12c531aeec350de2ca7cc064e882f761b418&preset_what=all&preset_time=recentupcoming';

    // 1. Test extractor functions directly
    assert.strictEqual(bot.extractLmsCalendarOrCookie(sampleCalendarUrl), sampleCalendarUrl);
    assert.strictEqual(bot.extractLmsCalendarOrCookie('Вот держи: ' + sampleCalendarUrl + ' спасибо!'), sampleCalendarUrl);
    assert.strictEqual(bot.extractLmsCalendarOrCookie('webcal://lms.astanait.edu.kz/calendar/export_execute.php?userid=123&authtoken=abc'), 'https://lms.astanait.edu.kz/calendar/export_execute.php?userid=123&authtoken=abc');
    assert.strictEqual(bot.extractLmsCalendarOrCookie('MoodleSession=test_moodle_session_123'), 'test_moodle_session_123');
    assert.strictEqual(bot.extractLearnSessionId('sessionid=learn_session_token_xyz123'), 'learn_session_token_xyz123');
    assert.strictEqual(bot.extractLearnSessionId('sessionid=learn_session||part2_xyz123'), 'learn_session||part2_xyz123');

    // 2. Test bot webhook behavior: student pastes ONLY the raw calendar URL into chat
    const originalFetch = global.fetch;
    const sentApiMessages = [];

    const dummyIcal = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'BEGIN:VEVENT',
        'UID:auto_cal_evt_1@lms.astanait.edu.kz',
        'SUMMARY:Assignment 1. Final Project is due',
        'CATEGORIES:Software Architecture',
        `DTSTART:${new Date(Date.now() + 3600000 * 4).toISOString().replace(/[-:]/g, '').split('.')[0]}Z`,
        `DTEND:${new Date(Date.now() + 3600000 * 4).toISOString().replace(/[-:]/g, '').split('.')[0]}Z`,
        'DESCRIPTION:https://lms.astanait.edu.kz/mod/assign/view.php?id=999',
        'END:VEVENT',
        'END:VCALENDAR'
    ].join('\r\n');

    global.fetch = async (url, options = {}) => {
        if (url && url.includes('export_execute.php')) {
            return {
                ok: true,
                status: 200,
                text: async () => dummyIcal
            };
        }
        if (url && url.includes('telegram.org')) {
            const body = options.body ? JSON.parse(options.body) : {};
            sentApiMessages.push({ url, body });
            return {
                ok: true,
                status: 200,
                json: async () => ({ ok: true, result: { message_id: 9999 } })
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
        await lms.deleteUserLmsSession(studentId);
        sentApiMessages.length = 0;

        // Student sends RAW calendar link (exactly like student 🚬 sent)
        await bot({
            method: 'POST',
            body: {
                message: {
                    chat: { id: studentId },
                    text: sampleCalendarUrl,
                    from: { id: studentId, username: 'student_smoker' }
                }
            }
        }, mockRes);

        // Verify:
        // A) Bot responded to student that LMS is successfully connected
        const studentResponses = sentApiMessages.filter(m => String(m.body.chat_id) === String(studentId));
        assert.ok(studentResponses.length >= 1);
        const lastResponse = studentResponses[studentResponses.length - 1].body.text;
        assert.match(lastResponse, /Moodle LMS успешно подключен/);
        assert.match(lastResponse, /Сгенерирован вечный токен календаря/);

        // B) Stored user session has the calendar URL
        const savedUrl = await lms.getUserLmsSession(studentId);
        assert.ok(savedUrl);
        assert.strictEqual(savedUrl, sampleCalendarUrl);

        // C) Admin received ZERO messages! (The calendar link was NOT forwarded as feedback/question)
        const adminMessages = sentApiMessages.filter(m => String(m.body.chat_id) === String(adminChatId));
        assert.strictEqual(adminMessages.length, 0, 'Admin must not be spammed when students paste calendar links');

        // Cleanup
        await lms.deleteUserLmsSession(studentId);
    } finally {
        global.fetch = originalFetch;
    }
});

test('Evening Digest: 20:00 checklist for LMS deadlines and Learn quizzes due tonight and tomorrow', async () => {
    const cron = require('../api/cron.js');
    const lms = require('../api/bot/lms.js');
    const aitu = require('../api/bot/aitu.js');

    const originalFetch = global.fetch;
    const sentMessages = [];

    try {
        global.fetch = async (url, opts = {}) => {
            if (url && url.includes('/sendMessage')) {
                sentMessages.push(JSON.parse(opts.body));
                return { ok: true, json: async () => ({ ok: true, result: {} }) };
            }
            return { ok: true, json: async () => ({}) };
        };

        process.env.TELEGRAM_BOT_TOKEN = 'test_token';
        cron.clearSentAlertsMemory();

        // 1. Test checkDeadlineUrgency unit logic
        const baseNow = new Date('2026-09-28T15:00:00Z'); // 20:00 Asia/Almaty (UTC+5)
        const dueTonight = new Date('2026-09-28T18:59:00Z').toISOString(); // 23:59 Asia/Almaty tonight
        const dueTomorrow = new Date('2026-09-29T18:59:00Z').toISOString(); // 23:59 Asia/Almaty tomorrow
        const dueNextWeek = new Date('2026-10-04T18:59:00Z').toISOString();

        const uTonight = cron.checkDeadlineUrgency(dueTonight, baseNow);
        assert.strictEqual(uTonight.isTonight, true);
        assert.strictEqual(uTonight.isRelevantForEvening, true);
        assert.strictEqual(uTonight.diffDays, 0);

        const uTomorrow = cron.checkDeadlineUrgency(dueTomorrow, baseNow);
        assert.strictEqual(uTomorrow.isTonight, false);
        assert.strictEqual(uTomorrow.isTomorrow, true);
        assert.strictEqual(uTomorrow.isRelevantForEvening, true);
        assert.strictEqual(uTomorrow.diffDays, 1);

        const uNextWeek = cron.checkDeadlineUrgency(dueNextWeek, baseNow);
        assert.strictEqual(uNextWeek.isRelevantForEvening, false);

        // 2. Test processUserLms evening checklist
        const studentId = 'student_evening_test_123';
        const origGetDeadlines = lms.getUpcomingDeadlinesForUser;
        lms.getUpcomingDeadlinesForUser = async () => ({
            ok: true,
            academicEvents: [
                {
                    id: 'lab_tonight',
                    title: 'Database Lab 3',
                    courseName: 'Databases',
                    dueDate: dueTonight,
                    diffMinutes: 239,
                    diffHours: 4,
                    diffDays: 0,
                    link: 'https://lms.astanait.edu.kz/lab3'
                },
                {
                    id: 'lab_tomorrow',
                    title: 'Networks Assignment 1',
                    courseName: 'Networks',
                    dueDate: dueTomorrow,
                    diffMinutes: 1679,
                    diffHours: 28,
                    diffDays: 1,
                    link: 'https://lms.astanait.edu.kz/lab4'
                },
                {
                    id: 'lab_far',
                    title: 'Philosophy Essay',
                    courseName: 'Philosophy',
                    dueDate: dueNextWeek,
                    diffMinutes: 8000,
                    diffHours: 133,
                    diffDays: 6,
                    link: 'https://lms.astanait.edu.kz/essay'
                }
            ]
        });

        sentMessages.length = 0;
        const eveningContext = {
            isMorningWindow: false,
            isEveningWindow: true,
            forceSend: false,
            todayStr: '2026-09-28',
            nowDate: baseNow,
            adminChatIds: []
        };

        const lmsRes = await cron.processUserLms(studentId, eveningContext);
        assert.strictEqual(lmsRes.ok, true);
        assert.strictEqual(lmsRes.eveningSent, 1);
        assert.strictEqual(lmsRes.dailySent, 0);
        assert.strictEqual(lmsRes.criticalSent, 0);

        assert.strictEqual(sentMessages.length, 1);
        const lmsEveningMsg = sentMessages[0].text;
        assert.match(lmsEveningMsg, /Вечерний чек-лист Moodle LMS/);
        assert.match(lmsEveningMsg, /Database Lab 3/);
        assert.match(lmsEveningMsg, /Networks Assignment 1/);
        assert.doesNotMatch(lmsEveningMsg, /Philosophy Essay/);

        // 3. Test Deduplication
        const lmsRes2 = await cron.processUserLms(studentId, eveningContext);
        assert.strictEqual(lmsRes2.eveningSent, 0, 'Evening checklist must not be sent twice on the same day');
        assert.strictEqual(sentMessages.length, 1);

        lms.getUpcomingDeadlinesForUser = origGetDeadlines;
    } finally {
        global.fetch = originalFetch;
        cron.clearSentAlertsMemory();
    }
});

test('Telegram Bot: Persistent user registration in KV and /broadcast delivery with rate-limiting and auto-cleanup', async () => {
    const bot = require('../api/bot/index.js');
    const originalFetch = global.fetch;
    const kvCalls = [];
    const sentTelegramMessages = [];

    const mockKvUrl = 'https://mock-kv.upstash.io';
    const mockKvToken = 'mock_token_123';
    process.env.KV_REST_API_URL = mockKvUrl;
    process.env.KV_REST_API_TOKEN = mockKvToken;
    process.env.TELEGRAM_BOT_TOKEN = 'test_broadcast_bot_token';
    process.env.ADMIN_CHAT_ID = '999999999';

    try {
        global.fetch = async (url, opts = {}) => {
            if (url && url.includes('upstash.io')) {
                const body = JSON.parse(opts.body);
                kvCalls.push(body);
                const cmd = body[0];
                if (cmd === 'SMEMBERS') {
                    return {
                        ok: true,
                        json: async () => ({ result: ['11111', '22222', '33333'] })
                    };
                }
                return {
                    ok: true,
                    json: async () => ({ result: 1 })
                };
            }
            if (url && url.includes('/sendMessage')) {
                const payload = JSON.parse(opts.body);
                sentTelegramMessages.push(payload);
                // Simulate user 22222 blocked the bot
                if (String(payload.chat_id) === '22222') {
                    return {
                        ok: false,
                        json: async () => ({ ok: false, description: 'Forbidden: bot was blocked by the user' })
                    };
                }
                return {
                    ok: true,
                    json: async () => ({ ok: true, result: { message_id: 100 } })
                };
            }
            return { ok: true, json: async () => ({}) };
        };

        // 1. Test recordBotUser
        await bot.recordBotUser('44444');
        assert.ok(bot.activeUsers.has('44444'));
        const saddCall = kvCalls.find(c => c[0] === 'SADD' && c[1] === 'gm:all_users' && c[2] === '44444');
        assert.ok(saddCall, 'recordBotUser must persist new user to gm:all_users in Redis');

        // Verify in-memory deduplication: second call should not invoke Redis SADD again
        const countBefore = kvCalls.length;
        await bot.recordBotUser('44444');
        assert.strictEqual(kvCalls.length, countBefore, 'In-memory cache must prevent redundant Redis SADD calls');

        // 2. Test removeBotUser
        await bot.removeBotUser('44444');
        assert.strictEqual(bot.activeUsers.has('44444'), false);
        const sremCall = kvCalls.find(c => c[0] === 'SREM' && c[1] === 'gm:all_users' && c[2] === '44444');
        assert.ok(sremCall, 'removeBotUser must remove user from gm:all_users in Redis');

        // 3. Test getAllBotUsers combining Redis, memory, subscribers, and admin
        const allUsers = await bot.getAllBotUsers();
        assert.ok(allUsers.includes('11111'));
        assert.ok(allUsers.includes('22222'));
        assert.ok(allUsers.includes('33333'));
        assert.ok(allUsers.includes('999999999')); // admin

        // 4. Test /broadcast security: unauthorized user
        const nonAdminReq = {
            method: 'POST',
            body: {
                message: {
                    chat: { id: 123456 },
                    from: { id: 123456, first_name: 'Student' },
                    text: '/broadcast Важное объявление!'
                }
            }
        };
        let resJson = null;
        let resStatus = 200;
        const fakeRes = {
            setHeader: () => {},
            status: (s) => { resStatus = s; return fakeRes; },
            json: (j) => { resJson = j; return fakeRes; },
            end: () => {}
        };
        sentTelegramMessages.length = 0;
        await bot(nonAdminReq, fakeRes);
        assert.strictEqual(sentTelegramMessages.length, 1);
        assert.strictEqual(sentTelegramMessages[0].chat_id, 123456);
        assert.match(sentTelegramMessages[0].text, /Доступ запрещен/);

        // 5. Test /broadcast empty prompt
        const adminEmptyReq = {
            method: 'POST',
            body: {
                message: {
                    chat: { id: 999999999 },
                    from: { id: 999999999, first_name: 'Admin' },
                    text: '/broadcast'
                }
            }
        };
        sentTelegramMessages.length = 0;
        await bot(adminEmptyReq, fakeRes);
        assert.strictEqual(sentTelegramMessages.length, 1);
        assert.match(sentTelegramMessages[0].text, /Введите текст для рассылки/);

        // 6. Test /broadcast execution to all users + auto-cleanup of blocked user
        const adminBroadcastReq = {
            method: 'POST',
            body: {
                message: {
                    chat: { id: 999999999 },
                    from: { id: 999999999, first_name: 'Admin' },
                    text: '/broadcast Обновление расписания на пятницу!'
                }
            }
        };
        sentTelegramMessages.length = 0;
        await bot(adminBroadcastReq, fakeRes);

        // Check delivered messages
        const broadcastRecipients = sentTelegramMessages.map(m => String(m.chat_id));
        assert.ok(broadcastRecipients.includes('11111'));
        assert.ok(broadcastRecipients.includes('22222'));
        assert.ok(broadcastRecipients.includes('33333'));

        // Check content format
        const studentMsg = sentTelegramMessages.find(m => String(m.chat_id) === '11111');
        assert.match(studentMsg.text, /Объявление от GradeMaster:/);
        assert.match(studentMsg.text, /Обновление расписания на пятницу!/);

        // Check admin report (sent as the final confirmation message to admin)
        const adminMessages = sentTelegramMessages.filter(m => String(m.chat_id) === '999999999');
        const adminReportMsg = adminMessages[adminMessages.length - 1];
        assert.match(adminReportMsg.text, /Рассылка завершена!/);
        assert.match(adminReportMsg.text, /Всего адресатов:/);
        assert.match(adminReportMsg.text, /Успешно отправлено:/);
        assert.match(adminReportMsg.text, /Заблокировали бота \(удалены из базы\):/);

        // Verify blocked user was removed via SREM
        const blockedSrem = kvCalls.find(c => c[0] === 'SREM' && c[1] === 'gm:all_users' && c[2] === '22222');
        assert.ok(blockedSrem, 'Blocked user 22222 must be automatically removed from gm:all_users in Redis');
    } finally {
        global.fetch = originalFetch;
        delete process.env.KV_REST_API_URL;
        delete process.env.KV_REST_API_TOKEN;
    }
});

test('Bot: Mark All Done and in-place multi-select for LMS and Learn (/done all, mark_all_*, unmark_all_*)', async () => {
    const bot = require('../api/bot/index.js');
    const aitu = require('../api/bot/aitu.js');
    const lms = require('../api/bot/lms.js');

    const originalFetch = global.fetch;
    const sentMessages = [];
    const editedMessages = [];
    const answeredQueries = [];

    const studentId = 'test_student_mark_all_999';

    try {
        global.fetch = async (url, opts = {}) => {
            if (url && url.includes('/sendMessage')) {
                sentMessages.push(JSON.parse(opts.body));
                return { ok: true, json: async () => ({ ok: true, result: { message_id: 201 } }) };
            }
            if (url && url.includes('/editMessageText')) {
                editedMessages.push(JSON.parse(opts.body));
                return { ok: true, json: async () => ({ ok: true, result: { message_id: 201 } }) };
            }
            if (url && url.includes('/answerCallbackQuery')) {
                answeredQueries.push(JSON.parse(opts.body));
                return { ok: true, json: async () => ({ ok: true, result: true }) };
            }
            return { ok: true, json: async () => ({}) };
        };

        process.env.TELEGRAM_BOT_TOKEN = 'test_token_mark_all';

        // 1. Test markAllQuizzesCompleted and markAllLmsEventsCompleted direct helpers
        await aitu.clearUserCompletedQuizzes(studentId);
        await lms.clearUserCompletedLmsEvents(studentId);

        const aituCount = await aitu.markAllQuizzesCompleted(studentId, ['quiz_a', 'quiz_b', 'quiz_c']);
        assert.strictEqual(aituCount, 3);
        const completedAitu = await aitu.getUserCompletedQuizzes(studentId);
        assert.ok(completedAitu.has('quiz_a'));
        assert.ok(completedAitu.has('quiz_b'));
        assert.ok(completedAitu.has('quiz_c'));

        const lmsCount = await lms.markAllLmsEventsCompleted(studentId, ['evt_1', 'evt_2']);
        assert.strictEqual(lmsCount, 2);
        const completedLms = await lms.getUserCompletedLmsEvents(studentId);
        assert.ok(completedLms.has('evt_1'));
        assert.ok(completedLms.has('evt_2'));

        // Reset for menu tests
        await aitu.clearUserCompletedQuizzes(studentId);
        await lms.clearUserCompletedLmsEvents(studentId);

        // 2. Test buildLearnMarkMenu (active items vs zero active items)
        const mockLearnActive = {
            ok: true,
            activeQuizzes: [
                { id: 'q1', shortId: 'q1', title: 'Calculus Quiz 1' },
                { id: 'q2', shortId: 'q2', title: 'Algorithms Quiz 2' }
            ]
        };
        const learnMenu = bot.buildLearnMarkMenu(mockLearnActive, false);
        assert.match(learnMenu.text, /Выберите сданные квизы AITU Learn/);
        assert.ok(learnMenu.reply_markup.inline_keyboard[0][0].text.includes('✨ Отметить ВСЕ как сданные (2)'));
        assert.strictEqual(learnMenu.reply_markup.inline_keyboard[0][0].callback_data, 'mark_all_lrn');
        assert.ok(learnMenu.reply_markup.inline_keyboard.some(row => row.some(b => b.callback_data === 'mark_lrn_q1')));
        assert.ok(learnMenu.reply_markup.inline_keyboard.some(row => row.some(b => b.callback_data === 'mark_lrn_q2')));

        const mockLearnEmpty = { ok: true, activeQuizzes: [], completedCount: 2 };
        const emptyLearnMenu = bot.buildLearnMarkMenu(mockLearnEmpty, false);
        assert.match(emptyLearnMenu.text, /Все квизы.*отмечены как сданные/);
        assert.ok(emptyLearnMenu.reply_markup.inline_keyboard.some(row => row.some(b => b.callback_data === 'learn_show_completed')));

        // 3. Test buildLmsMarkMenu (active items vs zero active items)
        const mockLmsActive = {
            ok: true,
            academicEvents: [
                { id: 'e1', title: 'Network Lab 1' },
                { id: 'e2', title: 'Database Assignment 1' }
            ]
        };
        const lmsMenu = bot.buildLmsMarkMenu(mockLmsActive, false);
        assert.match(lmsMenu.text, /Выберите сданные задания Moodle LMS/);
        assert.ok(lmsMenu.reply_markup.inline_keyboard[0][0].text.includes('✨ Отметить ВСЕ как сданные (2)'));
        assert.strictEqual(lmsMenu.reply_markup.inline_keyboard[0][0].callback_data, 'mark_all_lms');
        assert.ok(lmsMenu.reply_markup.inline_keyboard.some(row => row.some(b => b.callback_data === 'mark_lms_e1')));
        assert.ok(lmsMenu.reply_markup.inline_keyboard.some(row => row.some(b => b.callback_data === 'mark_lms_e2')));

        const mockLmsEmpty = { ok: true, academicEvents: [], completedCount: 2 };
        const emptyLmsMenu = bot.buildLmsMarkMenu(mockLmsEmpty, false);
        assert.match(emptyLmsMenu.text, /Все задания.*отмечены как сданные/);
        assert.ok(emptyLmsMenu.reply_markup.inline_keyboard.some(row => row.some(b => b.callback_data === 'lms_show_completed')));

        // 4. Test callback handling through bot webhook
        const mockRes = { setHeader: () => {}, status: () => mockRes, json: () => {} };
        const makeCallbackReq = (data) => ({
            method: 'POST',
            headers: {},
            body: {
                callback_query: {
                    id: 'cq_test_mark',
                    message: { chat: { id: studentId }, message_id: 555 },
                    data
                }
            }
        });

        // Mock aitu.getUpcomingQuizzesForUser and lms.getUpcomingDeadlinesForUser
        const origGetQuizzes = aitu.getUpcomingQuizzesForUser;
        const origGetDeadlines = lms.getUpcomingDeadlinesForUser;

        let curActiveQuizzes = [
            { id: 'q10', shortId: 'q10', title: 'Math Quiz 1', isPast: false, isCompleted: false },
            { id: 'q20', shortId: 'q20', title: 'Physics Quiz 2', isPast: false, isCompleted: false }
        ];
        let curActiveLms = [
            { id: 'lms10', title: 'CS Lab 1', isPast: false, isCompleted: false },
            { id: 'lms20', title: 'CS Lab 2', isPast: false, isCompleted: false }
        ];

        aitu.getUpcomingQuizzesForUser = async () => {
            const completed = await aitu.getUserCompletedQuizzes(studentId);
            const active = curActiveQuizzes.filter(q => !completed.has(q.id));
            const done = curActiveQuizzes.filter(q => completed.has(q.id));
            return {
                ok: true,
                quizzes: curActiveQuizzes,
                activeQuizzes: active,
                completedQuizzes: done,
                pendingCount: active.length,
                completedCount: done.length
            };
        };

        lms.getUpcomingDeadlinesForUser = async () => {
            const completed = await lms.getUserCompletedLmsEvents(studentId);
            const active = curActiveLms.filter(e => !completed.has(e.id));
            const done = curActiveLms.filter(e => completed.has(e.id));
            return {
                ok: true,
                academicEvents: active,
                activeAcademicEvents: active,
                completedAcademicEvents: done,
                pendingCount: active.length,
                completedCount: done.length
            };
        };

        // In-place mark single quiz (mark_lrn_q10)
        await bot(makeCallbackReq('mark_lrn_q10'), mockRes);
        assert.ok((await aitu.getUserCompletedQuizzes(studentId)).has('q10'));
        // Verify editMessageText was called and still contains remaining quiz q20
        const lastEdit = editedMessages[editedMessages.length - 1];
        assert.ok(lastEdit);
        assert.ok(lastEdit.reply_markup.inline_keyboard.some(row => row.some(b => b.callback_data === 'mark_lrn_q20')));
        assert.ok(!lastEdit.reply_markup.inline_keyboard.some(row => row.some(b => b.callback_data === 'mark_lrn_q10')));

        // Mark ALL remaining quizzes (mark_all_lrn)
        await bot(makeCallbackReq('mark_all_lrn'), mockRes);
        assert.ok((await aitu.getUserCompletedQuizzes(studentId)).has('q20'));
        const finishEdit = editedMessages[editedMessages.length - 1];
        assert.match(finishEdit.text, /Все квизы.*отмечены как сданные/);

        // Unmark ALL quizzes (unmark_all_lrn)
        await bot(makeCallbackReq('unmark_all_lrn'), mockRes);
        assert.strictEqual((await aitu.getUserCompletedQuizzes(studentId)).size, 0);

        // In-place mark single LMS event (mark_lms_lms10)
        await bot(makeCallbackReq('mark_lms_lms10'), mockRes);
        assert.ok((await lms.getUserCompletedLmsEvents(studentId)).has('lms10'));
        const lmsEdit = editedMessages[editedMessages.length - 1];
        assert.ok(lmsEdit.reply_markup.inline_keyboard.some(row => row.some(b => b.callback_data === 'mark_lms_lms20')));
        assert.ok(!lmsEdit.reply_markup.inline_keyboard.some(row => row.some(b => b.callback_data === 'mark_lms_lms10')));

        // Mark ALL remaining LMS events (mark_all_lms)
        await bot(makeCallbackReq('mark_all_lms'), mockRes);
        assert.ok((await lms.getUserCompletedLmsEvents(studentId)).has('lms20'));
        const lmsFinishEdit = editedMessages[editedMessages.length - 1];
        assert.match(lmsFinishEdit.text, /Все задания.*отмечены как сданные/);

        // Unmark ALL LMS events (unmark_all_lms)
        await bot(makeCallbackReq('unmark_all_lms'), mockRes);
        assert.strictEqual((await lms.getUserCompletedLmsEvents(studentId)).size, 0);

        // Mark everything at once (mark_all_everything)
        await bot(makeCallbackReq('mark_all_everything'), mockRes);
        assert.ok((await aitu.getUserCompletedQuizzes(studentId)).has('q10'));
        assert.ok((await aitu.getUserCompletedQuizzes(studentId)).has('q20'));
        assert.ok((await lms.getUserCompletedLmsEvents(studentId)).has('lms10'));
        assert.ok((await lms.getUserCompletedLmsEvents(studentId)).has('lms20'));

        // 5. Test /done all, /сдал все text command
        const makeMsgReq = (text) => ({
            method: 'POST',
            headers: {},
            body: {
                message: {
                    chat: { id: studentId },
                    from: { id: studentId, username: 'test_student' },
                    text
                }
            }
        });

        // Reset completed items
        await aitu.clearUserCompletedQuizzes(studentId);
        await lms.clearUserCompletedLmsEvents(studentId);

        // Mock user session states for /done all:
        // Case A: Both LMS and Learn connected
        await lms.saveUserLmsSession(studentId, 'https://lms.astanait.edu.kz/calendar/export_execute.php?userid=999&authtoken=test');
        await aitu.saveUserSession(studentId, 'fake_sessionid_999');

        await bot(makeMsgReq('/done all'), mockRes);
        const bothPrompt = sentMessages[sentMessages.length - 1];
        assert.match(bothPrompt.text, /Отметить всё как сданное/);
        assert.ok(bothPrompt.reply_markup.inline_keyboard.some(row => row.some(b => b.callback_data === 'mark_all_everything')));

        // Case B: Russian command variant /сдал всё
        await bot(makeMsgReq('/сдал всё'), mockRes);
        const rusPrompt = sentMessages[sentMessages.length - 1];
        assert.match(rusPrompt.text, /Отметить всё как сданное/);

        // Case C: Only LMS connected
        await aitu.deleteUserSession(studentId);
        await lms.clearUserCompletedLmsEvents(studentId);
        await bot(makeMsgReq('/done all'), mockRes);
        assert.ok((await lms.getUserCompletedLmsEvents(studentId)).has('lms10'));
        assert.ok((await lms.getUserCompletedLmsEvents(studentId)).has('lms20'));
        const lmsDoneMsg = sentMessages[sentMessages.length - 1];
        assert.match(lmsDoneMsg.text, /Все задания Moodle LMS .* отмечены как сданные/);

        // Case D: Only Learn connected
        await lms.deleteUserLmsSession(studentId);
        await aitu.saveUserSession(studentId, 'fake_sessionid_999');
        await aitu.clearUserCompletedQuizzes(studentId);
        await bot(makeMsgReq('/сдал все'), mockRes);
        assert.ok((await aitu.getUserCompletedQuizzes(studentId)).has('q10'));
        assert.ok((await aitu.getUserCompletedQuizzes(studentId)).has('q20'));
        const aituDoneMsg = sentMessages[sentMessages.length - 1];
        assert.match(aituDoneMsg.text, /Все квизы AITU Learn .* отмечены как сданные/);

        aitu.getUpcomingQuizzesForUser = origGetQuizzes;
        lms.getUpcomingDeadlinesForUser = origGetDeadlines;
        await lms.deleteUserLmsSession(studentId);
        await aitu.deleteUserSession(studentId);
    } finally {
        global.fetch = originalFetch;
        delete process.env.TELEGRAM_BOT_TOKEN;
    }
});

test('Telegram Bot: formatBroadcastContent preserves safe tags and converts markdown backticks to code', () => {
    const bot = require('../api/bot/index.js');
    const formatted1 = bot.formatBroadcastContent('Вызовите команду `/cookie` для инструкции');
    assert.strictEqual(formatted1, 'Вызовите команду <code>/cookie</code> для инструкции');

    const formatted2 = bot.formatBroadcastContent('Вызовите команду <code>/cookie</code> и <b>жирный текст</b> & <неизвестный тег>');
    assert.strictEqual(formatted2, 'Вызовите команду <code>/cookie</code> и <b>жирный текст</b> &amp; &lt;неизвестный тег&gt;');
});

test('Telegram Bot: clicking stale schedule button resets keyboard cleanly', async () => {
    const bot = require('../api/bot/index.js');
    const originalFetch = global.fetch;
    process.env.TELEGRAM_BOT_TOKEN = 'mock_bot_token';
    const sentMessages = [];
    global.fetch = async (url, options) => {
        if (url.includes('/sendMessage')) {
            const body = JSON.parse(options.body);
            sentMessages.push(body);
            return {
                ok: true,
                json: async () => ({ ok: true, result: { message_id: 123 } })
            };
        }
        return { ok: true, json: async () => ({ ok: true }) };
    };

    try {
        const req = {
            method: 'POST',
            body: {
                message: {
                    chat: { id: 777123 },
                    from: { id: 777123, first_name: 'Student' },
                    text: '📅 Расписание'
                }
            }
        };
        const res = {
            setHeader: () => {},
            status: () => res,
            json: () => res,
            end: () => {}
        };
        await bot(req, res);

        assert.strictEqual(sentMessages.length, 1);
        assert.match(sentMessages[0].text, /Кнопка расписания удалена/);
        assert.ok(sentMessages[0].reply_markup && sentMessages[0].reply_markup.keyboard);
        const keyboardButtons = sentMessages[0].reply_markup.keyboard.flat().map(b => b.text);
        assert.strictEqual(keyboardButtons.includes('📅 Расписание'), false);
    } finally {
        global.fetch = originalFetch;
        delete process.env.TELEGRAM_BOT_TOKEN;
    }
});

test('Telegram Bot: Group chat interaction via tag/mention, reply-to-bot, and slash commands', async () => {
    const bot = require('../api/bot/index.js');
    const originalFetch = global.fetch;
    const sentMessages = [];

    process.env.TELEGRAM_BOT_TOKEN = '123456789:mock_group_test_token';
    process.env.TELEGRAM_BOT_USERNAME = 'aitugrademaster_bot';

    bot._setBotInfoForTesting({ username: 'aitugrademaster_bot', id: '123456789' });

    global.fetch = async (url, opts) => {
        if (url && url.includes('/sendMessage')) {
            const body = JSON.parse(opts.body);
            sentMessages.push(body);
            return {
                ok: true,
                json: async () => ({ ok: true, result: { message_id: 9999 } })
            };
        }
        if (url && url.includes('/getMe')) {
            return {
                ok: true,
                json: async () => ({ ok: true, result: { id: 123456789, username: 'aitugrademaster_bot' } })
            };
        }
        return { ok: true, json: async () => ({ ok: true, result: true }) };
    };

    try {
        const groupChat = { id: -1001234567890, type: 'supergroup', title: 'AITU CS-2401' };

        // 1. Casual message between group members without mentioning bot -> MUST IGNORE
        sentMessages.length = 0;
        await bot.handleMessage({
            message_id: 101,
            chat: groupChat,
            from: { id: 555001, first_name: 'Alikhan' },
            text: 'Ребята, кто сделал 2 лабу?'
        });
        assert.strictEqual(sentMessages.length, 0, 'Must ignore messages not addressed to bot in groups');

        // 2. Message targeting ANOTHER bot -> MUST IGNORE
        sentMessages.length = 0;
        await bot.handleMessage({
            message_id: 102,
            chat: groupChat,
            from: { id: 555001, first_name: 'Alikhan' },
            text: '/play@music_bot track_name'
        });
        assert.strictEqual(sentMessages.length, 0, 'Must ignore commands addressed to other bots');

        // 3. User tags bot without text -> MUST send helpful group guidance
        sentMessages.length = 0;
        await bot.handleMessage({
            message_id: 103,
            chat: groupChat,
            from: { id: 555001, first_name: 'Alikhan' },
            text: '@aitugrademaster_bot'
        });
        assert.strictEqual(sentMessages.length, 1);
        assert.strictEqual(sentMessages[0].chat_id, -1001234567890);
        assert.strictEqual(sentMessages[0].reply_to_message_id, 103, 'Must reply to user message in group');
        assert.match(sentMessages[0].text, /На связи GradeMaster/);
        assert.strictEqual(sentMessages[0].reply_markup, undefined, 'Must not send persistent reply keyboard in group');

        // 4. User tags bot with calculation query -> MUST calculate and reply with report
        sentMessages.length = 0;
        await bot.handleMessage({
            message_id: 104,
            chat: groupChat,
            from: { id: 555002, first_name: 'Dana' },
            text: '@aitugrademaster_bot 75 80'
        });
        assert.strictEqual(sentMessages.length, 1);
        assert.strictEqual(sentMessages[0].chat_id, -1001234567890);
        assert.strictEqual(sentMessages[0].reply_to_message_id, 104);
        assert.match(sentMessages[0].text, /РегМид = 75, РегЭнд = 80/);
        assert.match(sentMessages[0].text, /ПРОГНОЗ НА ЭКЗАМЕН/i);

        // 5. User replies to bot's message in group -> MUST process reply and answer
        sentMessages.length = 0;
        await bot.handleMessage({
            message_id: 105,
            chat: groupChat,
            from: { id: 555002, first_name: 'Dana' },
            reply_to_message: {
                message_id: 9999,
                from: { id: 123456789, is_bot: true, username: 'aitugrademaster_bot' },
                text: 'Прогноз нужного балла на Файнале'
            },
            text: '28 28 85'
        });
        assert.strictEqual(sentMessages.length, 1);
        assert.strictEqual(sentMessages[0].reply_to_message_id, 105);
        assert.match(sentMessages[0].text, /Файнал = 85/);

        // 6. User sends slash command with bot suffix in group -> MUST process
        sentMessages.length = 0;
        await bot.handleMessage({
            message_id: 106,
            chat: groupChat,
            from: { id: 555003, first_name: 'Arman' },
            text: '/help@aitugrademaster_bot'
        });
        assert.strictEqual(sentMessages.length, 1);
        assert.strictEqual(sentMessages[0].reply_to_message_id, 106);
        assert.match(sentMessages[0].text, /Калькулятор итоговой оценки/);
        // Inline keyboard is allowed and preserved, but persistent reply keyboard is stripped
        assert.ok(sentMessages[0].reply_markup?.inline_keyboard);
        assert.strictEqual(sentMessages[0].reply_markup?.keyboard, undefined);

        // 7. General slash command in group -> MUST process
        sentMessages.length = 0;
        await bot.handleMessage({
            message_id: 107,
            chat: groupChat,
            from: { id: 555003, first_name: 'Arman' },
            text: '/calc 80 85'
        });
        assert.strictEqual(sentMessages.length, 1);
        assert.strictEqual(sentMessages[0].reply_to_message_id, 107);
        assert.match(sentMessages[0].text, /РМ: 80 \| РЭ: 85/);
    } finally {
        global.fetch = originalFetch;
        delete process.env.TELEGRAM_BOT_TOKEN;
        delete process.env.TELEGRAM_BOT_USERNAME;
    }
});

test('SessionID validation: handles pipes ||, quotes, Cookie-Editor JSON, special chars and rejects dangerous input', async () => {
    const bot = require('../api/bot/index.js');
    const aitu = require('../api/bot/aitu.js');

    // 1. Direct parseAndSanitizeSessionId tests
    // A) Standard token with pipes (reported by ALmas)
    const tokenWithPipes = 'learn_token_part1||part2_xyz12345';
    assert.strictEqual(bot.parseAndSanitizeSessionId(tokenWithPipes), tokenWithPipes);
    assert.strictEqual(bot.parseAndSanitizeSessionId(`sessionid=${tokenWithPipes}`), tokenWithPipes);
    assert.strictEqual(bot.parseAndSanitizeSessionId(`sessionid: ${tokenWithPipes}`), tokenWithPipes);

    // B) Quoted values (e.g. copied from browser DevTools / Cookie-Editor)
    assert.strictEqual(bot.parseAndSanitizeSessionId(`"${tokenWithPipes}"`), tokenWithPipes);
    assert.strictEqual(bot.parseAndSanitizeSessionId(`'${tokenWithPipes}'`), tokenWithPipes);
    assert.strictEqual(bot.parseAndSanitizeSessionId(`sessionid="${tokenWithPipes}"`), tokenWithPipes);
    assert.strictEqual(bot.parseAndSanitizeSessionId(`sessionid="${tokenWithPipes}"; Path=/; Domain=learn.astanait.edu.kz; Secure`), tokenWithPipes);

    // C) Cookie-Editor JSON export format (array or object)
    const jsonArray = JSON.stringify([
        { domain: 'learn.astanait.edu.kz', name: 'sessionid', value: tokenWithPipes },
        { domain: 'learn.astanait.edu.kz', name: 'csrftoken', value: 'csrf_test_123456789' }
    ]);
    assert.strictEqual(bot.parseAndSanitizeSessionId(jsonArray), tokenWithPipes);
    assert.strictEqual(bot.extractLearnSessionId(jsonArray), tokenWithPipes);

    const jsonObject = JSON.stringify({ name: 'sessionid', value: tokenWithPipes });
    assert.strictEqual(bot.parseAndSanitizeSessionId(jsonObject), tokenWithPipes);

    // D) Open edX / Django signed session tokens with colons, dots, base64, tildes, percentages
    const complexToken = 't:2026-10-05.abc~def+ghi/jkl==%7C%7Cspecial_sig_12345';
    assert.strictEqual(bot.parseAndSanitizeSessionId(complexToken), complexToken);

    // E) Long tokens (> 128 characters)
    const longToken = 'a'.repeat(256) + '||' + 'b'.repeat(50);
    assert.strictEqual(bot.parseAndSanitizeSessionId(longToken), longToken);

    // F) extractLearnSessionId auto-detection
    assert.strictEqual(bot.extractLearnSessionId(`sessionid=${tokenWithPipes}`), tokenWithPipes);
    assert.strictEqual(bot.extractLearnSessionId(`Вот моя кука: sessionid=${tokenWithPipes}`), tokenWithPipes);
    assert.strictEqual(bot.extractLearnSessionId('Обычное сообщение без куки'), null);

    // G) Security validations: rejects dangerous input
    assert.strictEqual(bot.parseAndSanitizeSessionId(null), null);
    assert.strictEqual(bot.parseAndSanitizeSessionId(''), null);
    assert.strictEqual(bot.parseAndSanitizeSessionId('short_123'), null); // < 16 chars
    assert.strictEqual(bot.parseAndSanitizeSessionId('token with whitespace inside 12345'), null);
    assert.strictEqual(bot.parseAndSanitizeSessionId('token_123456789012\r\nSet-Cookie: evil=1'), null); // CRLF injection
    assert.strictEqual(bot.parseAndSanitizeSessionId('<script>alert("xss")</script>12345'), null); // XSS / angle brackets

    // H) Integration test with executeSetLearnCookie
    const originalGetUpcomingQuizzes = aitu.getUpcomingQuizzes;
    const originalSaveUserSession = aitu.saveUserSession;
    let savedSession = null;
    let passedSession = null;

    try {
        aitu.getUpcomingQuizzes = async (sid) => {
            passedSession = sid;
            return { ok: true, quizzes: [] };
        };
        aitu.saveUserSession = async (chatId, sid) => {
            savedSession = sid;
            return true;
        };

        const originalFetch = global.fetch;
        const sentReplies = [];
        global.fetch = async (url, opts) => {
            if (url && url.includes('/sendMessage')) {
                sentReplies.push(JSON.parse(opts.body));
                return { ok: true, json: async () => ({ ok: true, result: {} }) };
            }
            return { ok: true, json: async () => ({}) };
        };

        process.env.TELEGRAM_BOT_TOKEN = 'test_token_validation';

        // Execute /set_cookie with pipes
        await bot.executeSetLearnCookie('test_chat_pipes', `sessionid=${tokenWithPipes}`, false);

        assert.strictEqual(passedSession, tokenWithPipes, 'getUpcomingQuizzes received token with pipes');
        assert.strictEqual(savedSession, tokenWithPipes, 'saveUserSession saved token with pipes');
        assert.strictEqual(sentReplies.length, 2); // 1. "Проверяю подключение...", 2. "Успешно подключено к AITU!"
        assert.match(sentReplies[1].text, /Успешно подключено к AITU/);

        // Execute /set_cookie with invalid short value -> returns user-friendly error
        sentReplies.length = 0;
        await bot.executeSetLearnCookie('test_chat_pipes', 'bad_token', false);
        assert.strictEqual(sentReplies.length, 1);
        assert.match(sentReplies[0].text, /Некорректный формат sessionid/);
        assert.match(sentReplies[0].text, /Cookie-Editor/);

        global.fetch = originalFetch;
    } finally {
        aitu.getUpcomingQuizzes = originalGetUpcomingQuizzes;
        aitu.saveUserSession = originalSaveUserSession;
        delete process.env.TELEGRAM_BOT_TOKEN;
    }
});

test('PWA cache configuration: sw.js includes analytics and localization.js preserves grademaster-v3', () => {
    const swContent = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
    assert.match(swContent, /'grademaster-v3'/);
    assert.match(swContent, /'\.\/js\/analytics\.js'/);

    const locContent = fs.readFileSync(path.join(root, 'js/localization.js'), 'utf8');
    assert.match(locContent, /name !== 'grademaster-v3'/);
    assert.doesNotMatch(locContent, /name !== 'grademaster-v2'/);
});

test('TotalCalculator: corrupt share links show danger error and robust pick handles non-arrays', () => {
    const app = loadPage('main/TotalCalculator.html', { search: '?d=corrupted_invalid_data!!!' });
    const resultDiv = app.document.getElementById('result');
    assert.match(resultDiv.className, /danger/);
    assert.match(resultDiv.innerHTML, /недействительн|invalid|жарамсыз/i);

    // Verify pick handles strings and arrays safely
    const single = app.run('pick("single-string")');
    assert.strictEqual(single, 'single-string');
    const fromArray = app.run('pick(["only-element"])');
    assert.strictEqual(fromArray, 'only-element');
});

test('templated_calculator: tracks target calculation telemetry in calculateAll', () => {
    const app = loadPage('main/templated_calculator.html');
    let trackedType = null;
    app.context.window.trackCalculation = (type) => { trackedType = type; };
    app.run('calculateAll()');
    assert.strictEqual(trackedType, 'target');
});

test('GPA calculator: Enter key in subjects-count triggers generate-subjects', () => {
    const app = loadPage('main/CalculatorGPA.html');
    let generatedClicked = false;
    let calculateClicked = false;
    app.document.getElementById('generate-subjects').click = () => { generatedClicked = true; };
    app.document.getElementById('calculate-gpa').click = () => { calculateClicked = true; };

    const countInput = app.document.getElementById('subjects-count');
    const keyEvent = app.event('keypress');
    keyEvent.key = 'Enter';
    let currentTarget = countInput;
    Object.defineProperty(keyEvent, 'target', {
        get: () => currentTarget,
        set: () => {},
        configurable: true
    });
    app.document.dispatchEvent(keyEvent);

    assert.strictEqual(generatedClicked, true);
    assert.strictEqual(calculateClicked, false);

    // Enter in regular field triggers calculate-gpa
    generatedClicked = false;
    calculateClicked = false;
    currentTarget = app.document.createElement('input');
    app.document.dispatchEvent(keyEvent);
    assert.strictEqual(calculateClicked, true);
    assert.strictEqual(generatedClicked, false);
});

test('Telegram bot: calculateGradeReport FX on final exam does not show scholarship note to Gauhar', () => {
    const bot = require('../api/bot/index.js');
    // RM: 90, RE: 90 -> regterm: 90. Final: 40 (< 50 => FX). Total: 54 + 16 = 70.
    const reportGauhar = bot.calculateGradeReport(90, 90, 40, true);
    assert.match(reportGauhar, /Пересдача \(FX \/ Retake\)/);
    assert.doesNotMatch(reportGauhar, /стипендия на горизонте/i);
    assert.match(reportGauhar, /подготовиться к пересдаче/i);

    // When final >= 50 and total >= 70, scholarship note is present
    const passReport = bot.calculateGradeReport(90, 90, 75, true);
    assert.match(passReport, /стипендия на горизонте/i);
});

test('Telegram bot: rawSendMessage clamps oversized messages and handles HTML entity parse fallback', async () => {
    const bot = require('../api/bot/index.js');
    const originalFetch = global.fetch;
    const sentRequests = [];
    let shouldFailHtml = true;

    global.fetch = async (url, opts) => {
        if (url && url.includes('/sendMessage')) {
            const body = JSON.parse(opts.body);
            sentRequests.push(body);
            if (shouldFailHtml && body.parse_mode === 'HTML' && body.text.includes('<unclosed')) {
                return {
                    ok: false,
                    json: async () => ({ ok: false, description: "Bad Request: can't parse entities: unclosed tag" })
                };
            }
            return { ok: true, json: async () => ({ ok: true, result: { message_id: 999 } }) };
        }
        return { ok: true, json: async () => ({}) };
    };

    process.env.TELEGRAM_BOT_TOKEN = 'test_token_clamp';

    try {
        // Test message exceeding 4000 chars
        const longMessage = 'Line of test text\n'.repeat(350);
        assert.ok(longMessage.length > 4000);
        await bot.sendMessage(12345, longMessage);

        assert.strictEqual(sentRequests.length, 1);
        assert.ok(sentRequests[0].text.length <= 4000);
        assert.match(sentRequests[0].text, /сокращено/);

        // Test fallback when HTML entity parse error occurs
        sentRequests.length = 0;
        await bot.sendMessage(12345, '<b>Hello <unclosed');
        assert.strictEqual(sentRequests.length, 2); // First failed, second sent as fallback
        assert.strictEqual(sentRequests[1].parse_mode, undefined);
        assert.strictEqual(sentRequests[1].text, 'Hello <unclosed');
    } finally {
        global.fetch = originalFetch;
        delete process.env.TELEGRAM_BOT_TOKEN;
    }
});

test('AITU: formatQuizzesMessage caps upcoming semester quizzes to 15 items', () => {
    const aitu = require('../api/bot/aitu.js');
    const quizzes = [];
    const futureDate = new Date(Date.now() + 14 * 24 * 3600 * 1000).toISOString();
    for (let i = 1; i <= 25; i++) {
        quizzes.push({
            courseName: `Course ${i}`,
            courseId: `C${i}`,
            title: `Quiz ${i}`,
            link: `https://example.com/quiz/${i}`,
            dueDate: futureDate,
            diffDays: 14,
            diffHours: 336,
            diffMinutes: 20160,
            isPast: false
        });
    }

    const mockResult = {
        ok: true,
        quizzes,
        activeQuizzes: quizzes,
        completedQuizzes: []
    };

    const msg = aitu.formatQuizzesMessage(mockResult, false, false, 'all');
    assert.match(msg, /Course 15/);
    assert.doesNotMatch(msg, /Course 16/);
    assert.match(msg, /ещё 10 квизов на семестр/);
});

test('LMS Grades: parses overview courses and course gradebook tables accurately', async () => {
    const lmsGrades = require('../api/bot/lms_grades.js');

    const sampleOverviewHtml = `
        <div class="userbutton"><span class="usertext">Nursultan Nazarbayev</span></div>
        <table class="generaltable">
            <tr>
                <td><a href="https://lms.astanait.edu.kz/grade/report/user/index.php?id=1234">Probability Theory</a></td>
            </tr>
            <tr>
                <td><a href="https://lms.astanait.edu.kz/grade/report/user/index.php?id=5678">Software Engineering</a></td>
            </tr>
        </table>
    `;

    const courses = lmsGrades.parseOverviewCourses(sampleOverviewHtml);
    assert.strictEqual(courses.length, 2);
    assert.strictEqual(courses[0].id, '1234');
    assert.strictEqual(courses[0].name, 'Probability Theory');
    assert.strictEqual(courses[1].id, '5678');
    assert.strictEqual(courses[1].name, 'Software Engineering');

    const sampleCourseHtml = `
        <h1>Probability Theory</h1>
        <div class="teacher-info">Teacher: Karatay Assiya</div>
        <table class="user-grade">
            <tr>
                <td class="column-itemname">Register Midterm</td>
                <td class="column-grade">85.50</td>
            </tr>
            <tr>
                <td class="column-itemname">Register Endterm</td>
                <td class="column-grade">90.00</td>
            </tr>
            <tr>
                <td class="column-itemname">Register Final</td>
                <td class="column-grade">0.00</td>
            </tr>
        </table>
    `;

    const gradeInfo = lmsGrades.parseCourseUserGrades(sampleCourseHtml, 'Probability Theory');
    assert.strictEqual(gradeInfo.name, 'Probability Theory');
    assert.strictEqual(gradeInfo.teacher, 'Karatay Assiya');
    assert.strictEqual(gradeInfo.regmid, 85.5);
    assert.strictEqual(gradeInfo.regend, 90.0);
    assert.strictEqual(gradeInfo.regterm, 87.75);
    assert.strictEqual(gradeInfo.regfinal, null);
    assert.strictEqual(gradeInfo.foundRegisters, true);
});

test('server.js: standalone server handles health check and options preflight', async () => {
    const server = require('../server.js');
    await new Promise((resolve) => {
        server.listen(0, '127.0.0.1', resolve);
    });

    const addr = server.address();
    const port = addr.port;

    try {
        const res = await fetch(`http://127.0.0.1:${port}/health`);
        assert.strictEqual(res.status, 200);
        const data = await res.json();
        assert.strictEqual(data.ok, true);
        assert.strictEqual(data.status, 'healthy');

        const optRes = await fetch(`http://127.0.0.1:${port}/health`, { method: 'OPTIONS' });
        assert.strictEqual(optRes.status, 200);
    } finally {
        await new Promise((resolve) => server.close(resolve));
    }
});






