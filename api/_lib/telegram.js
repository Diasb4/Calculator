// api/_lib/telegram.js
// Telegram Bot API client shared by the bot and the cron runner.

const { getBotToken } = require('./util.js');

const MESSAGE_LIMIT = 4096;
const MAX_ATTEMPTS = 3;

class TelegramError extends Error {
    constructor(method, data = {}) {
        super(data.description || 'Unknown Telegram API error');
        this.name = 'TelegramError';
        this.method = method;
        this.code = data.error_code;
        this.description = data.description;
    }
}

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Calls a Bot API method and returns `result`. 429 and 5xx answers are retried
 * (3 attempts in total); network errors and timeouts propagate as thrown.
 */
async function callTelegram(method, payload = {}, { timeoutMs = 15000, signal } = {}) {
    const token = getBotToken();
    if (!token) {
        throw new Error('TELEGRAM_BOT_TOKEN environment variable is not configured');
    }
    for (let attempt = 1; ; attempt++) {
        const timeout = AbortSignal.timeout(timeoutMs);
        const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            signal: signal ? AbortSignal.any([signal, timeout]) : timeout
        });
        const data = (await response.json()) || {};
        if (data.ok === true) return data.result;

        const code = data.error_code;
        const retryable = code === 429 || code >= 500;
        if (!retryable || attempt >= MAX_ATTEMPTS) {
            throw new TelegramError(method, data);
        }
        const waitMs = code === 429
            ? (data.parameters?.retry_after ?? 1) * 1000 + Math.floor(Math.random() * 250)
            : 1000 * attempt;
        await sleep(waitMs);
    }
}

/** Splits text into chunks of at most `limit` chars, preferring line breaks. */
function splitMessage(text, limit = MESSAGE_LIMIT) {
    const chunks = [];
    let rest = String(text ?? '');
    while (rest.length > limit) {
        const newline = rest.lastIndexOf('\n', limit);
        let cut = newline >= limit / 2 ? newline : limit;
        // A hard cut must not split a UTF-16 surrogate pair (emoji).
        if (cut === limit && /[\uD800-\uDBFF]/.test(rest[cut - 1])) cut -= 1;
        chunks.push(rest.slice(0, cut));
        rest = rest.slice(cut).replace(/^\n+/, '');
    }
    if (rest || chunks.length === 0) chunks.push(rest);
    return chunks;
}

/**
 * Sends HTML text, split into as many messages as needed. `reply_markup` goes
 * on the last chunk only; a chunk Telegram cannot parse is resent as plain text.
 */
async function sendText(chatId, text, options = {}) {
    const { reply_markup: replyMarkup, ...rest } = options;
    const chunks = splitMessage(text);
    let result;
    for (let i = 0; i < chunks.length; i++) {
        const payload = {
            chat_id: chatId,
            text: chunks[i],
            parse_mode: 'HTML',
            disable_web_page_preview: true,
            ...rest
        };
        if (replyMarkup !== undefined && i === chunks.length - 1) {
            payload.reply_markup = replyMarkup;
        }
        try {
            result = await callTelegram('sendMessage', payload);
        } catch (err) {
            if (!/parse|entity|tag/i.test(err.description || err.message || '')) throw err;
            const plain = { ...payload, text: chunks[i].replace(/<[^>]*>/g, '') };
            delete plain.parse_mode;
            result = await callTelegram('sendMessage', plain);
        }
    }
    return result;
}

/** True when Telegram says the chat can no longer receive messages from the bot. */
function isChatGoneError(err) {
    return err?.code === 403 || /blocked|deactivated|chat not found|kicked/i.test(err?.description || err?.message || '');
}

module.exports = {
    TelegramError,
    callTelegram,
    splitMessage,
    sendText,
    isChatGoneError
};
