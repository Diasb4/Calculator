export default async function handler(req, res) {
    console.log("=== Telegram API Called ===");

    // CORS
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS,PATCH,DELETE,POST,PUT");
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

    const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

    if (!BOT_TOKEN || !CHAT_ID) {
        return res.status(500).json({
            error: "Server configuration error: Missing environment variables",
            details: { hasBotToken: !!BOT_TOKEN, hasChatId: !!CHAT_ID },
        });
    }

    if (!BOT_TOKEN.includes(":")) {
        return res.status(500).json({ error: "Invalid bot token format" });
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
        const body = req.body || {};
        const { message, weblog } = body;

        let finalMessage = "";
        if (weblog) {
            if (!WEBLOG_ENABLED) {
                return res.status(200).json({ success: true, skipped: true });
            }
            finalMessage = formatWeblog(weblog);
        } else {
            if (!message) {
                return res.status(400).json({ error: "Message is required" });
            }
            finalMessage = message;
        }

        const telegramUrl = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;

        const telegramBody = {
            chat_id: CHAT_ID,
            text: finalMessage,
            parse_mode: "HTML",
        };

        const response = await fetch(telegramUrl, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "User-Agent": "GradeMaster-Bot/1.0",
            },
            body: JSON.stringify(telegramBody),
        });

        const responseText = await response.text();

        let data;
        try {
            data = JSON.parse(responseText);
        } catch (parseError) {
            console.error("Failed to parse Telegram response:", parseError);
            return res.status(500).json({
                error: "Invalid response from Telegram API",
                response: responseText,
            });
        }

        if (data.ok) {
            return res.status(200).json({ success: true, message_id: data.result.message_id });
        }

        console.error("Telegram API error:", data);
        return res.status(500).json({
            error: "Telegram API error",
            description: data.description,
            error_code: data.error_code,
        });
    } catch (error) {
        console.error("Unhandled error in Telegram handler:", error);
        return res.status(500).json({
            error: "Internal server error",
            message: error && error.message ? error.message : String(error),
            stack: process.env.NODE_ENV === "development" && error && error.stack ? error.stack : undefined,
        });
    }
}

