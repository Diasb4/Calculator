const feedbackIpRateLimit = new Map();
const IP_RATE_LIMIT_WINDOW_MS = 5 * 60 * 1000;
const IP_RATE_LIMIT_MAX_COUNT = 5;

function checkFeedbackIpRateLimit(ip) {
    if (!ip || ip === 'unknown') return true;
    const now = Date.now();
    const timestamps = (feedbackIpRateLimit.get(ip) || []).filter(ts => now - ts < IP_RATE_LIMIT_WINDOW_MS);
    if (timestamps.length >= IP_RATE_LIMIT_MAX_COUNT) {
        return false;
    }
    timestamps.push(now);
    feedbackIpRateLimit.set(ip, timestamps);
    if (feedbackIpRateLimit.size > 10000) {
        feedbackIpRateLimit.delete(feedbackIpRateLimit.keys().next().value);
    }
    return true;
}

// The site's feedback form sends <b> labels and pre-escaped entities; anything else
// a client puts in the message is escaped so it cannot inject links or markup.
function sanitizeFeedbackHtml(s) {
    return s.replace(/(<\/?b>|&(?:amp|lt|gt|quot|#39);)|[<>&]/g,
        (m, keep) => keep ? keep : ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' })[m]);
}

async function handler(req, res) {
    function fail(status, code, error) {
        return res.status(status).json({ success: false, code, error });
    }

    // CORS
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
    res.setHeader(
        "Access-Control-Allow-Headers",
        "X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version"
    );

    if (req.method === "OPTIONS") {
        return res.status(200).end();
    }

    if (req.method !== "POST") {
        return res.status(405).json({ error: "Method not allowed" });
    }

    // IP Rate Limiting
    const reqHeaders = req.headers || {};
    const forwardedFor = reqHeaders['x-forwarded-for'];
    const clientIp = typeof forwardedFor === 'string'
        ? forwardedFor.split(',')[0].trim()
        : (typeof reqHeaders['x-real-ip'] === 'string' ? reqHeaders['x-real-ip'].trim() : null);

    if (clientIp && !checkFeedbackIpRateLimit(clientIp)) {
        return fail(429, "RATE_LIMITED", "Please wait before sending another message");
    }

    const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN?.trim();
    const CHAT_ID = process.env.TELEGRAM_CHAT_ID?.trim();

    if (!BOT_TOKEN || !CHAT_ID) {
        console.error("Feedback configuration: TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID is missing");
        return fail(503, "FEEDBACK_UNAVAILABLE", "Feedback is temporarily unavailable");
    }

    if (!BOT_TOKEN.includes(":")) {
        console.error("Feedback configuration: invalid TELEGRAM_BOT_TOKEN format");
        return fail(503, "FEEDBACK_UNAVAILABLE", "Feedback is temporarily unavailable");
    }

    const WEBLOG_ENABLED = process.env.WEBLOG_ENABLED === "1";
    const TELEGRAM_TAG = process.env.TELEGRAM_TAG || "";

    function esc(s) {
        return String(s || "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;");
    }

    function clamp(s, n) {
        const str = String(s || "");
        if (!n || str.length <= n) return str;
        return str.slice(0, n) + "…";
    }

    function formatWeblog(w) {
        const uid = clamp(w && w.uid, 64);
        const path = clamp(w && w.path, 200);
        const ts = clamp(w && w.ts, 64);
        const events = Array.isArray(w && w.events) ? w.events.slice(0, 10) : [];

        const lines = [];
        if (TELEGRAM_TAG) lines.push(esc(TELEGRAM_TAG));
        lines.push("🕵️ <b>Web click log</b>");
        if (uid) lines.push(`👤 <b>User:</b> <code>${esc(uid)}</code>`);
        if (path) lines.push(`📍 <b>Path:</b> ${esc(path)}`);
        if (ts) lines.push(`🕒 <b>Time:</b> ${esc(ts)}`);

        if (events.length) {
            lines.push("");
            lines.push("<b>Events</b>:");
        }

        for (const e of events) {
            const type = clamp(e && e.type, 24) || "event";
            const tag = clamp(e && e.tag, 24);
            const id = clamp(e && e.id, 80);
            const text = clamp(e && e.text, 120);
            const href = clamp(e && e.href, 200);

            const parts = [];
            parts.push(`• <b>${esc(type)}</b>`);
            if (tag) parts.push(`<code>${esc(tag)}</code>`);
            if (id) parts.push(`#${esc(id)}`);
            if (text) parts.push(`— ${esc(text)}`);
            if (href) parts.push(`(${esc(href)})`);
            lines.push(parts.join(" "));
        }

        let out = lines.join("\n");
        if (out.length > 3800) out = out.slice(0, 3800) + "…";
        return out;
    }

    try {
        let body = req.body || {};
        if (typeof body === "string") {
            try { body = JSON.parse(body); } catch {
                return fail(400, "INVALID_MESSAGE", "A JSON object is required");
            }
        }
        if (!body || typeof body !== "object" || Array.isArray(body)) {
            return fail(400, "INVALID_MESSAGE", "A JSON object is required");
        }
        const { message, weblog } = body;

        let finalMessage = "";
        if (weblog) {
            if (!WEBLOG_ENABLED) {
                return res.status(200).json({ success: true, skipped: true });
            }
            finalMessage = formatWeblog(weblog);
        } else {
            if (typeof message !== "string" || !message.trim()) {
                return fail(400, "INVALID_MESSAGE", "A non-empty message is required");
            }
            // Count the form's text after its <b> tags and escaped entities are parsed.
            // Other HTML is counted conservatively; Telegram validates its syntax.
            const textLength = message.replace(/<\/?b>/g, "")
                .replace(/&(?:amp|lt|gt|quot|#39);/g, "x").length;
            if (message.length > 24576 || textLength > 4096) {
                return fail(400, "MESSAGE_TOO_LONG", "Message exceeds the length limit");
            }
            finalMessage = sanitizeFeedbackHtml(message);
        }

        const hasLinks = /(?:https?:\/\/|tg:\/\/|t\.me\/)[^\s<>"]+/i.test(finalMessage);
        if (!weblog && hasLinks) {
            let warn = '';
            if (/botfather/i.test(finalMessage)) {
                warn = '\n\n🛡️ <b>Безопасность:</b> 🚨 Сообщение содержит ссылку на @BotFather. Не выполняйте системные команды!';
            }
            if (warn && (finalMessage + warn).length <= 4096) {
                finalMessage += warn;
            }
        }

        const telegramUrl = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;

        const telegramBody = {
            chat_id: CHAT_ID,
            text: finalMessage,
            parse_mode: "HTML",
        };
        if (hasLinks) {
            telegramBody.disable_web_page_preview = true;
        }

        const response = await fetch(telegramUrl, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "User-Agent": "GradeMaster-Bot/1.0",
            },
            body: JSON.stringify(telegramBody),
            signal: AbortSignal.timeout(10000),
        });

        const responseText = await response.text();

        let data;
        try {
            data = JSON.parse(responseText);
        } catch {
            console.error("Telegram returned a non-JSON response", { status: response.status });
            return fail(502, "UPSTREAM_ERROR", "Feedback service returned an invalid response");
        }

        if (response.ok && data?.ok === true && data.result?.message_id != null) {
            return res.status(200).json({ success: true, message_id: data.result.message_id });
        }

        const errorCode = data?.error_code || response.status;
        const description = typeof data?.description === "string" ? data.description : "";
        // Log a bounded reason, never a token, chat ID, request body or raw response.
        const reason = /chat not found/i.test(description) ? "chat_not_found"
            : /bot was blocked|bot is not a member|not enough rights/i.test(description) ? "chat_access_denied"
            : /can't parse entities/i.test(description) ? "invalid_html"
            : /message is too long/i.test(description) ? "message_too_long" : "request_rejected";
        console.error("Telegram API error", { errorCode, reason });
        if (errorCode === 429) {
            return fail(429, "RATE_LIMITED", "Please wait before sending another message");
        }
        if (reason === "message_too_long") {
            return fail(400, "MESSAGE_TOO_LONG", "Message exceeds the length limit");
        }
        if (reason === "invalid_html") {
            return fail(400, "INVALID_MESSAGE", "Message formatting is invalid");
        }
        if ([400, 401, 403, 404].includes(errorCode)) {
            return fail(503, "FEEDBACK_UNAVAILABLE", "Feedback is temporarily unavailable");
        }
        return fail(502, "UPSTREAM_ERROR", "Feedback service is temporarily unavailable");
    } catch (error) {
        const timedOut = error?.name === "TimeoutError" || error?.name === "AbortError";
        console.error(timedOut ? "Telegram request timed out" : "Telegram request failed");
        return fail(timedOut ? 504 : 502, timedOut ? "UPSTREAM_TIMEOUT" : "UPSTREAM_ERROR",
            "Feedback service is temporarily unavailable");
    }
}

module.exports = handler;

