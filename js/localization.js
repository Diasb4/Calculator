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
    initEasterEggEngine();
});

// PWA Service Worker Registration & Cache Invalidation
if (typeof window !== 'undefined') {
    if ('caches' in window) {
        caches.keys().then(names => {
            names.forEach(name => {
                if (name !== 'grademaster-v2') {
                    caches.delete(name);
                }
            });
        }).catch(() => {});
    }
    if ('serviceWorker' in navigator && (window.location.protocol === 'http:' || window.location.protocol === 'https:')) {
        window.addEventListener('load', () => {
            const swPath = window.location.pathname.includes('/main/') ? '../sw.js' : './sw.js';
            navigator.serviceWorker.register(swPath).then(registration => {
                registration.update();
            }).catch(err => {
                console.debug('Service Worker registration skipped:', err);
            });
        });
    }
}

// ==========================================
// EASTER EGG, DEV HUD & KEYBOARD SHORTCUTS
// ==========================================

function showSpecialToast(message) {
    const existing = document.getElementById('gm-glass-toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.id = 'gm-glass-toast';
    toast.innerHTML = `
        <div style="font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: #94a3b8; margin-bottom: 4px;">
            GradeMaster Insight
        </div>
        <div style="font-size: 13px; line-height: 1.45; color: #f8fafc;">
            ${escapeHTML(message)}
        </div>
    `;
    toast.style.cssText = `
        position: fixed;
        bottom: 24px;
        right: 24px;
        background: rgba(15, 23, 42, 0.94);
        backdrop-filter: blur(16px);
        -webkit-backdrop-filter: blur(16px);
        border: 1px solid rgba(255, 255, 255, 0.12);
        color: #f8fafc;
        padding: 14px 20px;
        border-radius: 14px;
        z-index: 100000;
        box-shadow: 0 20px 40px -10px rgba(0, 0, 0, 0.6);
        animation: gmToastSlideIn 0.35s cubic-bezier(0.16, 1, 0.3, 1);
        max-width: 340px;
        pointer-events: auto;
        cursor: pointer;
    `;

    toast.onclick = () => {
        toast.style.animation = 'gmToastSlideOut 0.25s ease forwards';
        setTimeout(() => toast.remove(), 250);
    };

    document.body.appendChild(toast);

    setTimeout(() => {
        if (toast.parentNode) {
            toast.style.animation = 'gmToastSlideOut 0.25s ease forwards';
            setTimeout(() => toast.remove(), 250);
        }
    }, 5500);
}

function revealSecret() {
    const secretKeys = [
        'secret_extra_1', 'secret_extra_2', 'secret_extra_3', 'secret_extra_4',
        'secret_manual_check', 'secret_rare_user', 'secret_easter_egg', 'secret_auto_passing',
        'secret_calculator_student', 'secret_calculator_scholarship', 'secret_extra_5',
        'secret_extra_6', 'secret_extra_7', 'secret_leak', 'secret_hack', 'secret_success',
        'secret_warning', 'secret_difference', 'secret_extra_8', 'secret_extra_9',
        'secret_extra_10', 'secret_extra_11', 'secret_extra_12', 'secret_excuse',
        'secret_extra_13', 'secret_extra_14', 'secret_extra_15', 'secret_extra_16', 'secret_extra_17'
    ];
    const randomKey = secretKeys[Math.floor(Math.random() * secretKeys.length)];
    showSpecialToast(getTranslation(randomKey));
}

function initEasterEggEngine() {
    if (typeof window === 'undefined') return;

    // Inject Toast animations
    const styleEl = document.createElement('style');
    styleEl.textContent = `
        @keyframes gmToastSlideIn {
            from { transform: translateY(20px) scale(0.95); opacity: 0; }
            to { transform: translateY(0) scale(1); opacity: 1; }
        }
        @keyframes gmToastSlideOut {
            from { transform: translateY(0) scale(1); opacity: 1; }
            to { transform: translateY(15px) scale(0.95); opacity: 0; }
        }
        .gm-modal-overlay {
            position: fixed; inset: 0; background: rgba(9, 13, 22, 0.7);
            backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
            display: flex; align-items: center; justify-content: center;
            z-index: 100000; animation: gmToastSlideIn 0.25s ease;
        }
        .gm-modal-card {
            background: #111827; border: 1px solid rgba(255, 255, 255, 0.12);
            color: #f8fafc; border-radius: 18px; padding: 28px; width: 90%; max-width: 480px;
            box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.7); font-family: -apple-system, BlinkMacSystemFont, 'Inter', sans-serif;
        }
        .gm-hud-badge {
            display: inline-block; padding: 4px 8px; border-radius: 6px;
            background: rgba(59, 130, 246, 0.15); border: 1px solid rgba(59, 130, 246, 0.35);
            color: #60a5fa; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em;
        }
        .gm-key-pill {
            background: rgba(255, 255, 255, 0.08); border: 1px solid rgba(255, 255, 255, 0.15);
            border-radius: 6px; padding: 2px 7px; font-family: monospace; font-size: 12px; color: #f1f5f9;
        }
        .easter-egg {
            position: absolute;
            right: 16px;
            bottom: 12px;
            width: 24px;
            height: 24px;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            z-index: 1001;
            border-radius: 50%;
            transition: transform 0.2s cubic-bezier(0.16, 1, 0.3, 1);
        }
        .easter-egg::before {
            content: '';
            width: 7px;
            height: 7px;
            border-radius: 50%;
            background: #94a3b8;
            opacity: 0.45;
            transition: all 0.25s ease;
            animation: gmPulse 3.5s infinite ease-in-out;
        }
        .easter-egg:hover {
            transform: scale(1.35);
        }
        .easter-egg:hover::before {
            background: #2563eb;
            opacity: 1;
            box-shadow: 0 0 10px rgba(37, 99, 235, 0.8), 0 0 4px rgba(37, 99, 235, 0.5);
        }
        body.dark-mode .easter-egg::before {
            background: #64748b;
            opacity: 0.5;
        }
        body.dark-mode .easter-egg:hover::before {
            background: #60a5fa;
            box-shadow: 0 0 10px rgba(96, 165, 250, 0.8), 0 0 4px rgba(96, 165, 250, 0.5);
        }
        @keyframes gmPulse {
            0%, 100% { transform: scale(1); opacity: 0.35; }
            50% { transform: scale(1.45); opacity: 0.75; }
        }
    `;
    document.head.appendChild(styleEl);

    // Ensure easter-egg dot exists in footer on every page
    const footer = document.querySelector('footer');
    if (footer && !footer.querySelector('.easter-egg')) {
        const egg = document.createElement('div');
        egg.className = 'easter-egg';
        egg.title = 'ssshhh...';
        egg.setAttribute('role', 'button');
        egg.setAttribute('aria-label', 'Secret');
        egg.onclick = () => {
            if (typeof trackEasterEgg === 'function') trackEasterEgg();
            revealSecret();
        };
        footer.appendChild(egg);
    }

    // Console Dev Banner (logged once)
    if (!window.__gmDevEngineInit) {
        window.__gmDevEngineInit = true;
        try {
            console.log(
                '%c GradeMaster %c Academic Utility Engine %c',
                'background: #0f172a; color: #38bdf8; font-weight: bold; padding: 4px 8px; border-radius: 4px 0 0 4px;',
                'background: #2563eb; color: #ffffff; font-weight: 600; padding: 4px 8px; border-radius: 0 4px 4px 0;',
                'background: transparent;'
            );
            console.log('Tip: Press ? for keyboard shortcuts or enter Konami Code (↑ ↑ ↓ ↓ ← → ← → B A) for Dev HUD.');
        } catch { /* Ignore console errors */ }
    }

    // Konami Code sequence: Up Up Down Down Left Right Left Right B A
    const konamiSequence = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a'];
    let konamiIndex = 0;

    window.addEventListener('keydown', (e) => {
        const activeTag = document.activeElement?.tagName?.toLowerCase();
        const isTyping = activeTag === 'input' || activeTag === 'textarea' || activeTag === 'select';

        // Konami code tracker
        if (e.key.toLowerCase() === konamiSequence[konamiIndex].toLowerCase() || e.key === konamiSequence[konamiIndex]) {
            konamiIndex++;
            if (konamiIndex === konamiSequence.length) {
                konamiIndex = 0;
                openDevHUD();
            }
        } else {
            konamiIndex = 0;
        }

        if (isTyping) {
            if (e.key === 'Escape') closeAnyModal();
            return;
        }

        if (e.key === '?' || (e.shiftKey && e.key === '/')) {
            e.preventDefault();
            openShortcutsModal();
        } else if (e.key === 't' || e.key === 'T' || e.key === 'е' || e.key === 'Е') {
            e.preventDefault();
            document.getElementById('theme-toggle')?.click();
        } else if (e.key === 'l' || e.key === 'L' || e.key === 'д' || e.key === 'Д') {
            e.preventDefault();
            const order = ['ru', 'kk', 'en'];
            const next = order[(order.indexOf(currentLanguage) + 1) % order.length];
            switchLanguage(next);
            showSpecialToast(`Language: ${next.toUpperCase()}`);
        } else if (e.key >= '1' && e.key <= '5') {
            const isMainDir = window.location.pathname.includes('/main/');
            const prefix = isMainDir ? '' : 'main/';
            const targets = [
                'TotalCalculator.html',
                'CalculatorGPA.html',
                'templated_calculator.html',
                'CumulativeGPA.html',
                'AttendanceCalculator.html'
            ];
            const targetPage = targets[parseInt(e.key, 10) - 1];
            if (targetPage) {
                window.location.href = prefix + targetPage;
            }
        } else if (e.key === 'Escape') {
            closeAnyModal();
        }
    });
}

function closeAnyModal() {
    const modal = document.querySelector('.gm-modal-overlay');
    if (modal) modal.remove();
}

function openShortcutsModal() {
    closeAnyModal();
    const modal = document.createElement('div');
    modal.className = 'gm-modal-overlay';
    modal.onclick = (e) => { if (e.target === modal) modal.remove(); };
    modal.innerHTML = `
        <div class="gm-modal-card">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 18px;">
                <div style="font-size: 17px; font-weight: 700;">Keyboard Shortcuts</div>
                <span class="gm-hud-badge">Quick Navigation</span>
            </div>
            <div style="display: flex; flex-direction: column; gap: 10px; font-size: 13px;">
                <div style="display: flex; justify-content: space-between; align-items: center; padding: 6px 0; border-bottom: 1px solid rgba(255,255,255,0.06);">
                    <span>Total Grade Calculator</span>
                    <span class="gm-key-pill">1</span>
                </div>
                <div style="display: flex; justify-content: space-between; align-items: center; padding: 6px 0; border-bottom: 1px solid rgba(255,255,255,0.06);">
                    <span>Term GPA Calculator</span>
                    <span class="gm-key-pill">2</span>
                </div>
                <div style="display: flex; justify-content: space-between; align-items: center; padding: 6px 0; border-bottom: 1px solid rgba(255,255,255,0.06);">
                    <span>Subject Templates</span>
                    <span class="gm-key-pill">3</span>
                </div>
                <div style="display: flex; justify-content: space-between; align-items: center; padding: 6px 0; border-bottom: 1px solid rgba(255,255,255,0.06);">
                    <span>Cumulative GPA</span>
                    <span class="gm-key-pill">4</span>
                </div>
                <div style="display: flex; justify-content: space-between; align-items: center; padding: 6px 0; border-bottom: 1px solid rgba(255,255,255,0.06);">
                    <span>Attendance Calculator</span>
                    <span class="gm-key-pill">5</span>
                </div>
                <div style="display: flex; justify-content: space-between; align-items: center; padding: 6px 0; border-bottom: 1px solid rgba(255,255,255,0.06);">
                    <span>Toggle Theme (Dark / Light)</span>
                    <span class="gm-key-pill">T</span>
                </div>
                <div style="display: flex; justify-content: space-between; align-items: center; padding: 6px 0; border-bottom: 1px solid rgba(255,255,255,0.06);">
                    <span>Cycle Language (RU / KK / EN)</span>
                    <span class="gm-key-pill">L</span>
                </div>
                <div style="display: flex; justify-content: space-between; align-items: center; padding: 6px 0;">
                    <span>Close Helper</span>
                    <span class="gm-key-pill">Esc</span>
                </div>
            </div>
            <button onclick="closeAnyModal()" style="margin-top: 20px; width: 100%; padding: 10px; background: #0f172a; color: white; border: 1px solid rgba(255, 255, 255, 0.15); border-radius: 8px; font-weight: 600; cursor: pointer;">
                Got it
            </button>
        </div>
    `;
    document.body.appendChild(modal);
}

function openDevHUD() {
    closeAnyModal();
    const modal = document.createElement('div');
    modal.className = 'gm-modal-overlay';
    modal.onclick = (e) => { if (e.target === modal) modal.remove(); };

    const nodeCount = document.querySelectorAll('*').length;
    const isDark = document.body.classList.contains('dark-mode');

    modal.innerHTML = `
        <div class="gm-modal-card">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
                <div style="font-size: 18px; font-weight: 700;">GradeMaster DevEngine</div>
                <span class="gm-hud-badge">Konami HUD</span>
            </div>
            <p style="color: #94a3b8; font-size: 13px; line-height: 1.4; margin-bottom: 18px;">
                You unlocked the developer console overlay. Client engine running nominal.
            </p>
            <div style="background: #0b0f19; border: 1px solid rgba(255,255,255,0.08); border-radius: 10px; padding: 14px; font-family: monospace; font-size: 12px; color: #cbd5e1; margin-bottom: 18px;">
                <div>• Version: GradeMaster 2.5 (Client Engine)</div>
                <div>• Active Locale: ${currentLanguage.toUpperCase()}</div>
                <div>• Theme: ${isDark ? 'Dark Mode (Obsidian)' : 'Light Mode (Crisp)'}</div>
                <div>• DOM Nodes: ${nodeCount} elements</div>
                <div>• Client Security: Standalone / Isolated Sandbox</div>
            </div>
            <div style="display: flex; gap: 10px;">
                <button onclick="fillDevTestData()" style="flex: 1; padding: 10px; background: #0f172a; color: white; border: 1px solid rgba(255,255,255,0.15); border-radius: 8px; font-size: 13px; font-weight: 600; cursor: pointer;">
                    Auto-fill Test Data
                </button>
                <button onclick="closeAnyModal()" style="flex: 1; padding: 10px; background: #2563eb; color: white; border: none; border-radius: 8px; font-size: 13px; font-weight: 600; cursor: pointer;">
                    Close HUD
                </button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
}

function fillDevTestData() {
    closeAnyModal();
    const regmid = document.getElementById('regmid');
    const regend = document.getElementById('regend');
    const finalInput = document.getElementById('final');
    if (regmid && regend) {
        regmid.value = '85';
        regend.value = '90';
        if (finalInput) finalInput.value = '95';
        if (typeof calculate === 'function') calculate();
        showSpecialToast('Dev Data populated for Total Calculator.');
        return;
    }

    const lessonsPerWeek = document.getElementById('lessonsPerWeek');
    if (lessonsPerWeek) {
        lessonsPerWeek.value = '3';
        const alreadyMissed = document.getElementById('alreadyMissed');
        if (alreadyMissed) alreadyMissed.value = '2';
        if (typeof calculateAttendance === 'function') calculateAttendance();
        showSpecialToast('Dev Data populated for Attendance.');
        return;
    }

    showSpecialToast('Dev Mode Active: Ready.');
}
