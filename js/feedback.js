// БЕЗОПАСНАЯ конфигурация - без токенов!
const API_ENDPOINT = 'https://calculator-not-404.vercel.app/api/telegram';

// Эмодзи и тексты
const typeEmojis = { suggestion: '💡', bug: '🐛', feature: '🚀', other: '📝' };
const typeTitles = { suggestion: 'Предложение', bug: 'Багрепорт', feature: 'Запрос функции', other: 'Обращение' };

// Ждем загрузки DOM
document.addEventListener('DOMContentLoaded', function () {
    const form = document.getElementById('feedbackForm');
    if (form) {
        form.addEventListener('submit', handleFeedbackSubmit);
    }
});

async function handleFeedbackSubmit(e) {
    e.preventDefault();

    const submitBtn = document.getElementById('submitBtn');
    const statusMessage = document.getElementById('statusMessage');

    // Получаем данные формы
    const userName = document.getElementById('userName').value.trim();
    const feedbackType = document.getElementById('feedbackType').value;
    const message = document.getElementById('message').value.trim();
    const contact = document.getElementById('contact').value.trim();

    // Валидация
    if (!message) {
        showStatus('Пожалуйста, напишите ваше сообщение', 'error');
        return;
    }

    // Блокируем кнопку
    submitBtn.disabled = true;
    submitBtn.textContent = '📤 Отправка...';

    try {
        // Формируем сообщение
        const formattedMessage = formatMessage(userName, feedbackType, message, contact);

        // Отправляем через защищенный endpoint
        const success = await sendFeedback(formattedMessage);

        if (success) {
            showStatus('✅ Сообщение успешно отправлено! Спасибо за вашу обратную связь!', 'success');
            document.getElementById('feedbackForm').reset();
        } else {
            showStatus('❌ Ошибка при отправке. Попробуйте еще раз или напишите напрямую в Telegram.', 'error');
        }
    } catch (error) {
        console.error('Ошибка:', error);
        showStatus('❌ Произошла ошибка. Попробуйте еще раз.', 'error');
    } finally {
        // Разблокируем кнопку
        submitBtn.disabled = false;
        submitBtn.textContent = '📨 Отправить сообщение';
    }
}

function formatMessage(userName, type, message, contact) {
    const emoji = typeEmojis[type] || '📝';
    const title = typeTitles[type] || 'Обращение';

    let formattedMessage = `${emoji} <b>${title}</b>\n\n`;

    if (userName) {
        formattedMessage += `👤 <b>От:</b> ${userName}\n`;
    } else {
        formattedMessage += `👤 <b>От:</b> Анонимный пользователь\n`;
    }

    formattedMessage += `📋 <b>Тип:</b> ${typeTitles[type]}\n\n`;
    formattedMessage += `💬 <b>Сообщение:</b>\n${message}\n\n`;

    if (contact) {
        formattedMessage += `📞 <b>Контакт для ответа:</b> ${contact}\n\n`;
    }

    formattedMessage += `🌐 <b>Источник:</b> GradeMaster Calculator\n`;
    formattedMessage += `⏰ <b>Время:</b> ${new Date().toLocaleString('ru-RU')}`;

    return formattedMessage;
}

async function sendFeedback(message) {
    try {
        const response = await fetch(API_ENDPOINT, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ message })
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        return data.success;
    } catch (error) {
        console.error('Ошибка отправки:', error);
        return false;
    }
}

function showStatus(message, type) {
    const statusElement = document.getElementById('statusMessage');
    if (!statusElement) return;

    statusElement.textContent = message;
    statusElement.className = `status-message ${type}`;
    statusElement.style.display = 'block';

    // Автоскрытие успешных сообщений
    if (type === 'success') {
        setTimeout(() => {
            statusElement.style.display = 'none';
        }, 5000);
    }
}

// Функция для быстрого фидбека
window.quickFeedback = function (type, presetMessage = '') {
    const typeElement = document.getElementById('feedbackType');
    const messageElement = document.getElementById('message');

    if (typeElement) typeElement.value = type;
    if (messageElement && presetMessage) {
        messageElement.value = presetMessage;
    }

    const form = document.getElementById('feedbackForm');
    if (form) {
        form.scrollIntoView({ behavior: 'smooth' });
    }

    if (messageElement) {
        messageElement.focus();
    }
};