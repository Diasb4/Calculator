// bot/config.js
// Конфигурация Telegram-бота GradeMaster

module.exports = {
    // Токен Telegram бота
    BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN || '',

    // ID администратора (куда приходят уведомления и откуда можно отвечать)
    ADMIN_CHAT_ID: process.env.TELEGRAM_CHAT_ID || '',

    // URL веб-приложения GradeMaster
    WEBAPP_URL: process.env.WEBAPP_URL || 'https://calculator-not-404.vercel.app',

    // Порог посещаемости (30% при 10 неделях)
    ATTENDANCE_WEEKS: 10,
    ATTENDANCE_LIMIT_PERCENT: 0.30
};

