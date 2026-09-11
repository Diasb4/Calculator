// api/cron.js
// Vercel Cron handler для ежедневных напоминаний о квизах AITU

const aitu = require('./bot/aitu.js');

const BOT_TOKEN = (process.env.TELEGRAM_BOT_TOKEN || '').trim();
const ADMIN_CHAT_ID = (process.env.TELEGRAM_CHAT_ID || '').trim();
const API_BASE = `https://api.telegram.org/bot${BOT_TOKEN}`;

async function sendTelegram(chatId, text) {
    if (!BOT_TOKEN || !chatId) return;
    const res = await fetch(`${API_BASE}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            chat_id: chatId,
            text,
            parse_mode: 'HTML',
            disable_web_page_preview: true
        })
    });
    return res.json();
}

module.exports = async function handler(req, res) {
    // Проверка CRON_SECRET от Vercel (если настроен)
    const authHeader = req.headers['authorization'];
    if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    if (!ADMIN_CHAT_ID) {
        return res.status(500).json({ error: 'TELEGRAM_CHAT_ID is not configured' });
    }

    try {
        const result = await aitu.getUpcomingQuizzes();

        if (!result.ok) {
            if (result.sessionExpired) {
                await sendTelegram(
                    ADMIN_CHAT_ID,
                    `⚠️ <b>Внимание: Сессия learn.astanait.edu.kz истекла!</b>\n\n` +
                    `Бот не смог проверить дедлайны по квизам. Пожалуйста, обновите <code>AITU_SESSION_ID</code> в настройках Vercel или отправьте боту команду <code>/set_cookie ВАШ_SESSION_ID</code>.`
                );
            }
            return res.status(200).json({ ok: false, error: result.error });
        }

        // Фильтруем квизы, до дедлайна которых осталось <= 3 дней
        const urgentQuizzes = result.quizzes.filter(q => !q.isPast && q.diffDays <= 3);

        if (urgentQuizzes.length > 0) {
            let alertMsg = `🔔 <b>Напоминание о квизах AITU!</b>\n\n`;
            for (const item of urgentQuizzes) {
                const dateObj = new Date(item.dueDate);
                const astanaTime = new Intl.DateTimeFormat('ru-RU', {
                    timeZone: 'Asia/Almaty',
                    day: 'numeric',
                    month: 'short',
                    hour: '2-digit',
                    minute: '2-digit'
                }).format(dateObj);

                let badge = '';
                if (item.diffDays <= 0) {
                    badge = '🚨 <b>СЕГОДНЯ!</b>';
                } else if (item.diffDays === 1) {
                    badge = '🔥 <b>ЗАВТРА!</b>';
                } else {
                    badge = `⏳ через ${item.diffDays} дн.`;
                }

                alertMsg += `📚 <b>${item.courseName}</b>\n` +
                            `📝 <a href="${item.link}">${item.title}</a>\n` +
                            `⏰ Дедлайн: <b>${astanaTime}</b> (${badge})\n\n`;
            }
            alertMsg += `Не забудьте сдать вовремя! 🚀`;

            await sendTelegram(ADMIN_CHAT_ID, alertMsg);
            return res.status(200).json({ ok: true, reminded: urgentQuizzes.length });
        }

        return res.status(200).json({ ok: true, message: 'No urgent quizzes today', total: result.quizzes.length });
    } catch (err) {
        console.error('Cron error:', err);
        return res.status(500).json({ error: err.message });
    }
};
