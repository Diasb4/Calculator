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
    assert.match(report, /РАСЧЁТ GPA ЗА ТРИМЕСТР/);
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

test('Telegram bot: calculateAttendanceReport calculates 10-week limit and visual meter', () => {
    const bot = require('../api/bot/index.js');
    const reportSafe = bot.calculateAttendanceReport(3, 2);
    assert.match(reportSafe, /Всего занятий за семестр: <b>30<\/b>/);
    assert.match(reportSafe, /Порог недопуска \(30%\): <b>9 пар максимум<\/b>/);
    assert.match(reportSafe, /Безопасная зона посещаемости/);

    const reportDanger = bot.calculateAttendanceReport(3, 10);
    assert.match(reportDanger, /КРИТИЧЕСКИЙ ЛИМИТ ПРЕВЫШЕН/);
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
    assert.match(help, /ИНСТРУКЦИЯ ПО ИСПОЛЬЗОВАНИЮ БОТА/);
    assert.match(help, /Калькулятор итоговой оценки/);
    assert.match(help, /Калькулятор GPA/);
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
    assert.match(alert.text, /ГОРЯЩИЙ ДЕДЛАЙН: ОСТАЛСЯ 1 ЧАС!/);
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
        assert.match(sentTelegrams[0].text, /ГОРЯЩИЙ ДЕДЛАЙН: ОСТАЛСЯ 1 ЧАС!/);
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





