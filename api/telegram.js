export default async function handler(req, res) {
    // Настраиваем CORS
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
    res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

    // Обрабатываем preflight запрос
    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const { message } = req.body;

    // Проверяем наличие сообщения
    if (!message) {
        return res.status(400).json({ error: 'Message is required' });
    }

    // Переменные окружения на сервере
    const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

    // Проверяем наличие переменных окружения
    if (!BOT_TOKEN || !CHAT_ID) {
        console.error('Missing environment variables');
        return res.status(500).json({ error: 'Server configuration error' });
    }

    try {
        const response = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: CHAT_ID,
                text: message,
                parse_mode: 'HTML'
            })
        });

        const data = await response.json();

        if (data.ok) {
            res.status(200).json({ success: true });
        } else {
            console.error('Telegram API error:', data);
            res.status(500).json({ error: 'Failed to send message to Telegram' });
        }
    } catch (error) {
        console.error('Error sending to Telegram:', error);
        res.status(500).json({ error: 'Failed to send message' });
    }
}