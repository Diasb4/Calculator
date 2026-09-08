// Use the API belonging to this deployment, including local and preview builds.
const API_ENDPOINT = '/api/telegram';
const FEEDBACK_LIMITS = { userName: 100, message: 3000, contact: 200 };
const COOLDOWN_MS = 5 * 60 * 1000; // 5 минут между отправками

// Эмодзи и тексты для типов обращений
const typeEmojis = { suggestion: '💡', bug: '🐛', feature: '🚀', other: '📝' };

let lastDraft = null;

function getCooldownRemaining() {
    try {
        const lastSentStr = (typeof readPreference === 'function')
            ? readPreference('feedback_last_sent')
            : (typeof localStorage !== 'undefined' ? localStorage.getItem('feedback_last_sent') : null);
        const lastSent = parseInt(lastSentStr || '0', 10);
        if (!lastSent) return 0;
        const diff = Date.now() - lastSent;
        return diff < COOLDOWN_MS ? (COOLDOWN_MS - diff) : 0;
    } catch {
        return 0;
    }
}

document.getElementById('feedbackForm').addEventListener('submit', async function (e) {
    e.preventDefault();

    const submitBtn = document.getElementById('submitBtn');
    if (submitBtn.disabled) return;

    // Получаем данные формы
    const userName = document.getElementById('userName').value.trim();
    const feedbackType = document.getElementById('feedbackType').value;
    const message = document.getElementById('message').value.trim();
    const contact = document.getElementById('contact').value.trim();

    // Валидация
    if (!message) {
        showStatus('feedback_required', 'error');
        return;
    }
    if (Object.entries({ userName, message, contact }).some(([key, value]) => value.length > FEEDBACK_LIMITS[key])) {
        showStatus('feedback_too_long', 'error');
        return;
    }

    // Проверка кулдаун-таймера (5 минут)
    const remaining = getCooldownRemaining();
    if (remaining > 0) {
        const totalSec = Math.ceil(remaining / 1000);
        const min = Math.floor(totalSec / 60);
        const sec = String(totalSec % 60).padStart(2, '0');
        showStatus('feedback_cooldown_notice', 'error', { time: `${min}:${sec}` });
        return;
    }

    // Блокируем кнопку на время отправки
    clearTimeout(statusTimer);
    document.getElementById('statusMessage').style.display = 'none';
    submitBtn.disabled = true;
    submitBtn.dataset.translate = 'feedback_sending';
    if (typeof translateElement === 'function') {
        translateElement(submitBtn);
    } else {
        submitBtn.textContent = 'Отправка...';
    }

    try {
        // Формируем сообщение (всегда на русском языке для Telegram)
        const formattedMessage = formatMessage(userName, feedbackType, message, contact);

        // Отправляем через защищенный endpoint
        await sendFeedback(formattedMessage);

        // Сохраняем черновик для функции «Вернуть обращение»
        lastDraft = { userName, feedbackType, message, contact };
        const restoreBtn = document.getElementById('restoreDraftBtn');
        if (restoreBtn) restoreBtn.style.display = 'block';

        // Запоминаем время отправки для 5-минутного лимита
        const now = String(Date.now());
        if (typeof savePreference === 'function') {
            savePreference('feedback_last_sent', now);
        } else if (typeof localStorage !== 'undefined') {
            localStorage.setItem('feedback_last_sent', now);
        }

        showStatus('feedback_success', 'success');
        document.getElementById('feedbackForm').reset();
    } catch (error) {
        showStatus(error.translationKey || 'feedback_error', 'error');
    } finally {
        submitBtn.disabled = false;
        submitBtn.dataset.translate = 'feedback_submit';
        if (typeof translateElement === 'function') {
            translateElement(submitBtn);
        } else {
            submitBtn.textContent = '📨 Отправить сообщение';
        }
    }
});

// Обработчик кнопки «Вернуть обращение»
const restoreBtn = document.getElementById('restoreDraftBtn');
if (restoreBtn) {
    restoreBtn.addEventListener('click', () => {
        if (!lastDraft) return;
        const nameInput = document.getElementById('userName');
        const typeSelect = document.getElementById('feedbackType');
        const msgInput = document.getElementById('message');
        const contactInput = document.getElementById('contact');

        if (nameInput) nameInput.value = lastDraft.userName || '';
        if (typeSelect) typeSelect.value = lastDraft.feedbackType || 'suggestion';
        if (msgInput) msgInput.value = lastDraft.message || '';
        if (contactInput) contactInput.value = lastDraft.contact || '';

        restoreBtn.style.display = 'none';
        showStatus('feedback_draft_restored', 'success');
        if (msgInput) msgInput.focus();
    });
}

// Форматирование сообщения ВСЕГДА на русском языке для бота в Telegram
function formatMessage(userName, type, message, contact) {
    const typeTitles = {
        suggestion: '💡 Предложение',
        bug: '🐛 Багрепорт (Ошибка)',
        feature: '🚀 Запрос функции',
        other: '📝 Обращение'
    };
    const title = typeTitles[type] || '📝 Обращение';
    const lines = [
        `<b>${escapeHTML(title)}</b>`,
        `👤 <b>От:</b> ${escapeHTML(userName || 'Анонимный пользователь')}`,
        `💬 <b>Сообщение:</b>\n${escapeHTML(message)}`
    ];

    if (contact) {
        const cleanContact = contact.trim();
        let contactFormatted = escapeHTML(cleanContact);
        if (cleanContact.startsWith('@')) {
            const username = cleanContact.slice(1);
            contactFormatted = `<a href="https://t.me/${escapeHTML(username)}">${escapeHTML(cleanContact)}</a>`;
        } else if (cleanContact.includes('@') && cleanContact.includes('.')) {
            contactFormatted = `<a href="mailto:${escapeHTML(cleanContact)}">${escapeHTML(cleanContact)}</a>`;
        }
        lines.push(`📞 <b>Контакт:</b> ${contactFormatted}`);
    }

    lines.push(`🌐 <b>Источник:</b> GradeMaster Calculator`);

    const now = new Date();
    const timeStr = now.toISOString().replace('T', ' ').slice(0, 19);
    lines.push(`⏰ <b>Время:</b> ${timeStr}`);

    return lines.join('\n\n');
}

async function sendFeedback(message) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
        const response = await fetch(API_ENDPOINT, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ message }),
            signal: controller.signal
        });

        // Hosting errors may be HTML or plain text rather than JSON.
        const data = await response.json().catch(() => null);
        if (!response.ok || data?.success !== true) {
            const keys = {
                INVALID_MESSAGE: 'feedback_invalid',
                MESSAGE_TOO_LONG: 'feedback_too_long',
                FEEDBACK_UNAVAILABLE: 'feedback_unavailable',
                RATE_LIMITED: 'feedback_rate_limited',
                UPSTREAM_TIMEOUT: 'feedback_timeout',
                UPSTREAM_ERROR: 'feedback_unavailable'
            };
            const statusKey = {
                404: 'feedback_unavailable', 405: 'feedback_unavailable',
                413: 'feedback_too_long', 429: 'feedback_rate_limited',
                500: 'feedback_unavailable', 502: 'feedback_unavailable',
                503: 'feedback_unavailable', 504: 'feedback_timeout'
            }[response.status];
            throw Object.assign(new Error('Feedback request failed'), {
                translationKey: keys[data?.code] || statusKey || 'feedback_error'
            });
        }
    } catch (error) {
        if (error.translationKey) throw error;
        throw Object.assign(new Error('Feedback connection failed'), {
            translationKey: controller.signal.aborted ? 'feedback_timeout' : 'feedback_network_error'
        });
    } finally {
        clearTimeout(timeout);
    }
}

let statusTimer;

function showStatus(messageKey, type, params = {}) {
    const statusElement = document.getElementById('statusMessage');
    if (!statusElement) return;
    clearTimeout(statusTimer);
    statusElement.style.display = '';
    statusElement.dataset.translate = messageKey;
    statusElement.dataset.translateParams = JSON.stringify(params);
    if (typeof translateElement === 'function') {
        translateElement(statusElement);
    } else {
        statusElement.textContent = (typeof getTranslation === 'function') ? getTranslation(messageKey, params) : messageKey;
    }
    statusElement.className = `status-message ${type}`;

    // Автоскрытие успешных сообщений
    if (type === 'success') {
        statusTimer = setTimeout(() => {
            statusElement.style.display = 'none';
        }, 5000);
    }
}

// Функция для быстрого фидбека
window.quickFeedback = function (type, presetMessage = '') {
    document.getElementById('feedbackType').value = type;
    if (presetMessage) {
        document.getElementById('message').value = presetMessage;
    }
    document.getElementById('feedbackForm').scrollIntoView({ behavior: 'smooth' });
    document.getElementById('message').focus();
};
