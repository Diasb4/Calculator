export default async function handler(req, res) {
    console.log('=== Telegram API Called ===');

    // Настраиваем CORS
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
    res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

    // Обрабатываем preflight запрос
    if (req.method === 'OPTIONS') {
        console.log('OPTIONS preflight request');
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        console.log('Method not allowed:', req.method);
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const { message } = req.body;
        console.log('Received message:', message);

        // Проверяем наличие сообщения
        if (!message) {
            console.log('No message provided');
            return res.status(400).json({ error: 'Message is required' });
        }

        // Переменные окружения
        const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
        const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

        console.log('Environment check:', {
            hasBotToken: !!BOT_TOKEN,
            hasChatId: !!CHAT_ID,
            botTokenLength: BOT_TOKEN ? BOT_TOKEN.length : 0,
            chatId: CHAT_ID
        });

        // Проверяем наличие переменных окружения
        if (!BOT_TOKEN || !CHAT_ID) {
            console.error('Missing environment variables:', {
                BOT_TOKEN: !!BOT_TOKEN,
                CHAT_ID: !!CHAT_ID
            });
            return res.status(500).json({
                error: 'Server configuration error: Missing environment variables',
                details: {
                    hasBotToken: !!BOT_TOKEN,
                    hasChatId: !!CHAT_ID
                }
            });
        }

        // Проверяем формат токена (должен быть вида 123456:ABCdef...)
        if (!BOT_TOKEN.includes(':')) {
            console.error('Invalid bot token format');
            return res.status(500).json({
                error: 'Invalid bot token format'
            });
        }

        const telegramUrl = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
        console.log('Sending to Telegram URL:', telegramUrl.replace(BOT_TOKEN, '***'));

        const telegramBody = {
            chat_id: CHAT_ID,
            text: message,
            parse_mode: 'HTML'
        };

        console.log('Telegram request body:', {
            chat_id: CHAT_ID,
            text_length: message.length,
            parse_mode: 'HTML'
        });

        const response = await fetch(telegramUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'User-Agent': 'GradeMaster-Bot/1.0'
            },
            body: JSON.stringify(telegramBody)
        });

        const responseText = await response.text();
        console.log('Telegram API response status:', response.status);
        console.log('Telegram API response:', responseText);

        let data;
        try {
            data = JSON.parse(responseText);
        } catch (parseError) {
            console.error('Failed to parse Telegram response:', parseError);
            return res.status(500).json({
                error: 'Invalid response from Telegram API',
                response: responseText
            });
        }

        if (data.ok) {
            console.log('Message sent successfully to Telegram');
            return res.status(200).json({
                success: true,
                message_id: data.result.message_id
            });
        } else {
            console.error('Telegram API error:', data);
            return res.status(500).json({
                error: 'Telegram API error',
                description: data.description,
                error_code: data.error_code
            });
        }

    } catch (error) {
        console.error('Unhandled error in Telegram handler:', error);
        return res.status(500).json({
            error: 'Internal server error',
            message: error.message,
            stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    }
}