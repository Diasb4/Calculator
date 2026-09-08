// Use the API belonging to this deployment, including local and preview builds.
// БЕЗОПАСНАЯ конфигурация - без токенов!
const API_ENDPOINT = (typeof window !== 'undefined' && window.location.hostname === 'localhost')
    ? 'https://calculator-not-404.vercel.app/api/telegram'
    : '/api/telegram';
const FEEDBACK_LIMITS = { userName: 100, message: 3000, contact: 200 };

// Эмодзи и тексты
const typeEmojis = { suggestion: '💡', bug: '🐛', feature: '🚀', other: '📝' };


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

    // Блокируем кнопку
    clearTimeout(statusTimer);
    document.getElementById('statusMessage').style.display = 'none';
    submitBtn.disabled = true;
    submitBtn.dataset.translate = 'feedback_sending';
    translateElement(submitBtn);

    try {
        // Формируем сообщение
        const formattedMessage = formatMessage(userName, feedbackType, message, contact);

        // Отправляем через защищенный endpoint
        await sendFeedback(formattedMessage);
        showStatus('feedback_success', 'success');
        document.getElementById('feedbackForm').reset();
    } catch (error) {
        showStatus(error.translationKey || 'feedback_error', 'error');
    } finally {
        // Разблокируем кнопку
        submitBtn.disabled = false;
        submitBtn.dataset.translate = 'feedback_submit';
        translateElement(submitBtn);
    }
});

function formatMessage(userName, type, message, contact) {
    const title = getTranslation('feedback_type_' + (Object.hasOwn(typeEmojis, type) ? type : 'other'));
    const lines = [
        `<b>${escapeHTML(title)}</b>`,
        `👤 <b>${escapeHTML(getTranslation('feedback_from'))}</b> ${escapeHTML(userName || getTranslation('feedback_anonymous'))}`,
        `💬 <b>${escapeHTML(getTranslation('feedback_message').replace('*', ''))}</b>`,
        escapeHTML(message)
    ];
    if (contact) lines.push(`📞 ${escapeHTML(getTranslation('feedback_contact'))} ${escapeHTML(contact)}`);
    lines.push(`🌐 ${escapeHTML(getTranslation('feedback_source'))} GradeMaster Calculator`);
    lines.push(`⏰ ${escapeHTML(getTranslation('feedback_time'))} ${new Date().toLocaleString({ru: 'ru-RU', kk: 'kk-KZ', en: 'en-US'}[currentLanguage])}`);
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

function showStatus(message, type) {
    const statusElement = document.getElementById('statusMessage');
    clearTimeout(statusTimer);
    statusElement.style.display = '';
    statusElement.dataset.translate = message;
    translateElement(statusElement);
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
