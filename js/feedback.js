// Управление темной темой
const toggle = document.getElementById("theme-toggle");
const body = document.body;

// Проверяем сохраненную тему
if (localStorage.getItem("theme") === "dark") {
    body.classList.add("dark-mode");
    toggle.textContent = "☀️ Тема";
} else {
    toggle.textContent = "🌙 Тема";
}

// Обработчик переключения темы
toggle.addEventListener("click", () => {
    body.classList.toggle("dark-mode");

    if (body.classList.contains("dark-mode")) {
        toggle.textContent = "☀️ Тема";
        localStorage.setItem("theme", "dark");
    } else {
        toggle.textContent = "🌙 Тема";
        localStorage.setItem("theme", "light");
    }
});

// Обработчик touch для переключения темы на мобильных
toggle.addEventListener('touchstart', function (e) {
    e.preventDefault();
    body.classList.toggle("dark-mode");

    if (body.classList.contains("dark-mode")) {
        toggle.textContent = "☀️ Тема";
        localStorage.setItem("theme", "dark");
    } else {
        toggle.textContent = "🌙 Тема";
        localStorage.setItem("theme", "light");
    }
});

// БЕЗОПАСНАЯ конфигурация - без токенов!
const API_ENDPOINT = 'https://calculator-not-404.vercel.app/api/telegram';

// Эмодзи и тексты
const typeEmojis = { suggestion: '💡', bug: '🐛', feature: '🚀', other: '📝' };
const typeTitles = { suggestion: 'Предложение', bug: 'Багрепорт', feature: 'Запрос функции', other: 'Обращение' };

document.getElementById('feedbackForm').addEventListener('submit', async function (e) {
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
});

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
            throw new Error('Network response was not ok');
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
    statusElement.textContent = message;
    statusElement.className = `status-message ${type}`;

    // Автоскрытие успешных сообщений
    if (type === 'success') {
        setTimeout(() => {
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