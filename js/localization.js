const supportedLanguages = ['ru', 'kk', 'en'];

function readPreference(key) {
    try { return localStorage.getItem(key); } catch { return null; }
}

function savePreference(key, value) {
    try { localStorage.setItem(key, value); } catch { /* Preferences are optional. */ }
}

function initialLanguage() {
    const saved = readPreference('language');
    if (supportedLanguages.includes(saved)) return saved;
    if (saved === 'kz') return 'kk';
    const browserLanguage = (navigator.language || 'ru').toLowerCase().split('-')[0];
    return supportedLanguages.includes(browserLanguage) ? browserLanguage : 'ru';
}

let currentLanguage = initialLanguage();

function getTranslation(key, params = {}) {
    const value = translations[currentLanguage]?.[key] ?? translations.ru[key] ?? key;
    return value.replace(/\{(\w+)\}/g, (match, name) => String(params[name] ?? match));
}

function escapeHTML(value) {
    return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

// Result metadata lets language changes preserve calculated values and chosen comments.
function translationHTML(key, params = {}) {
    return `<span data-translate="${escapeHTML(key)}" data-translate-params="${escapeHTML(JSON.stringify(params))}">${escapeHTML(getTranslation(key, params))}</span>`;
}

function translateElement(element) {
    let params = {};
    try { params = JSON.parse(element.dataset.translateParams || '{}'); } catch { /* Optional metadata. */ }
    const value = getTranslation(element.dataset.translate, params);
    const type = element.dataset.translateType;
    if (type === 'placeholder' || type === 'aria-label' || type === 'title') {
        element.setAttribute(type, value);
        if (type === 'placeholder') element.setAttribute('aria-label', value);
    } else {
        element.textContent = value;
    }
}

function applyTranslations() {
    document.querySelectorAll('[data-translate]').forEach(translateElement);
    document.querySelectorAll('[data-default-key]').forEach(input => {
        const name = getTranslation(input.dataset.defaultKey) + (input.dataset.defaultNumber ? ` ${input.dataset.defaultNumber}` : '');
        if (!input.dataset.defaultValue || input.value === input.dataset.defaultValue) {
            input.value = name;
            input.placeholder = name;
            input.dataset.defaultValue = name;
        } else {
            delete input.dataset.defaultKey;
        }
    });
    updateLanguageButton();
    updateThemeButton();
    updateHtmlLang();
    updatePageTitle();
    if (typeof updateModeDisplay === 'function') updateModeDisplay();
    if (typeof updateBodyPaddingForNavbar === 'function') updateBodyPaddingForNavbar();
}

function switchLanguage(lang) {
    if (!supportedLanguages.includes(lang)) return;
    currentLanguage = lang;
    savePreference('language', lang);
    applyTranslations();
}

function updateLanguageButton() {
    const select = document.getElementById('language-toggle');
    if (select) {
        select.value = currentLanguage;
        select.setAttribute('aria-label', getTranslation('language_label'));
    }
}

function updateHtmlLang() { document.documentElement.lang = currentLanguage; }

function updatePageTitle() {
    const page = window.location.pathname.split('/').pop().toLowerCase();
    const titles = {
        'totalcalculator.html': 'page_title_total', 'calculatorgpa.html': 'page_title_gpa',
        'cumulativegpa.html': 'page_title_cumulative', 'manytrimcalc.html': 'page_title_cumulative',
        'attendancecalculator.html': 'page_title_attendance', 'feedback.html': 'page_title_feedback',
        'templated_calculator.html': 'page_title_template'
    };
    document.title = getTranslation(titles[page] || 'main_title');
}

function updateThemeButton() {
    const button = document.getElementById('theme-toggle');
    if (button) {
        button.textContent = `${document.body.classList.contains('dark-mode') ? '☀️' : '🌙'} ${getTranslation('theme_label')}`;
        button.setAttribute('aria-pressed', String(document.body.classList.contains('dark-mode')));
    }
}

document.addEventListener('DOMContentLoaded', () => {
    document.body.classList.toggle('dark-mode', readPreference('theme') === 'dark');
    document.getElementById('theme-toggle')?.addEventListener('click', () => {
        const dark = document.body.classList.toggle('dark-mode');
        savePreference('theme', dark ? 'dark' : 'light');
        updateThemeButton();
    });
    document.getElementById('language-toggle')?.addEventListener('change', event => switchLanguage(event.target.value));
    applyTranslations();
});
