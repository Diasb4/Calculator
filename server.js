// server.js
// Standalone HTTP server for GradeMaster (VPS / Docker): serves the public site and
// the API handlers, and, when enabled, runs the Telegram bot in long-polling mode
// and the reminder cron in-process.

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const statsEngine = require('./api/stats/engine.js');
const { getBotToken, getAdminChatIds, isProduction } = require('./api/_lib/util.js');

const PORT = parseInt(process.env.PORT || '3000', 10);
const HOST = process.env.HOST || '0.0.0.0';
const ROOT_DIR = __dirname;
const MAX_BODY_BYTES = 1048576;

const MIME_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.cjs': 'application/javascript; charset=utf-8',
    '.mjs': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.webp': 'image/webp',
    '.txt': 'text/plain; charset=utf-8',
    '.webmanifest': 'application/manifest+json'
};

// Same page security headers as the Vercel deployment; vercel.json is the single source.
const SECURITY_HEADERS = require('./vercel.json').headers.find(rule => rule.source === '/(.*)').headers;

// Only the public site is served. Server code, .env, .git and data dumps never are.
const PUBLIC_FILES = new Set(['/index.html', '/manifest.json', '/sw.js']);
const PUBLIC_DIRS = ['/main/', '/js/', '/style/', '/icons/'];

const API_ROUTES = {
    '/api/bot': path.join(ROOT_DIR, 'api', 'bot', 'index.js'),
    '/api/telegram': path.join(ROOT_DIR, 'api', 'telegram.js'),
    '/api/cron': path.join(ROOT_DIR, 'api', 'cron.js'),
    '/api/stats': path.join(ROOT_DIR, 'api', 'stats.js'),
    '/api/quizzes': path.join(ROOT_DIR, 'api', 'quizzes.js')
};

/**
 * Decorate response object with Express/Vercel convenience methods
 */
function enhanceResponse(res) {
    res.status = function (statusCode) {
        res.statusCode = statusCode;
        return res;
    };

    res.json = function (data) {
        if (!res.getHeader('Content-Type')) {
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
        }
        res.end(JSON.stringify(data));
        return res;
    };

    res.send = function (data) {
        if (typeof data === 'object' && !Buffer.isBuffer(data)) {
            return res.json(data);
        }
        res.end(data);
        return res;
    };

    return res;
}

/**
 * Parse the request body. Past MAX_BODY_BYTES nothing more is buffered: the rest is
 * drained and req.bodyTooLarge is set, so the client still receives the 413.
 */
async function parseRequestBody(req) {
    return new Promise((resolve) => {
        if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
            req.body = {};
            return resolve();
        }

        const chunks = [];
        let size = 0;
        const onData = (chunk) => {
            if (req.bodyTooLarge) return;
            size += chunk.length;
            if (size > MAX_BODY_BYTES) {
                req.bodyTooLarge = true;
                chunks.length = 0;
                return;
            }
            chunks.push(chunk);
        };
        req.on('data', onData);
        req.on('end', () => {
            if (req.bodyTooLarge) {
                req.body = {};
                return resolve();
            }
            const str = Buffer.concat(chunks).toString('utf8');
            const contentType = req.headers['content-type'] || '';

            if (contentType.includes('application/json')) {
                try {
                    req.body = str ? JSON.parse(str) : {};
                } catch {
                    req.body = str;
                }
            } else if (contentType.includes('application/x-www-form-urlencoded')) {
                try {
                    const params = new URLSearchParams(str);
                    req.body = Object.fromEntries(params.entries());
                } catch {
                    req.body = str;
                }
            } else {
                req.body = str;
            }
            resolve();
        });
        req.on('error', () => {
            req.body = {};
            resolve();
        });
    });
}

/** Absolute path of a public file for a URL path, or null when it must not be served. */
function resolvePublicPath(pathname) {
    let decoded;
    try {
        decoded = decodeURIComponent(pathname === '/' ? '/index.html' : pathname);
    } catch {
        return null;
    }
    if (decoded.includes('\0') || decoded.includes('\\')) return null;
    if (decoded.split('/').some(segment => segment.startsWith('.'))) return null;
    if (!PUBLIC_FILES.has(decoded) && !PUBLIC_DIRS.some(dir => decoded.startsWith(dir))) return null;

    const filePath = path.join(ROOT_DIR, decoded);
    const relative = path.relative(ROOT_DIR, filePath);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return null;
    return filePath;
}

function sendNotFound(res) {
    res.statusCode = 404;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.end('404 Not Found');
}

function serveStatic(req, res, pathname) {
    const filePath = resolvePublicPath(pathname);
    if (!filePath) return sendNotFound(res);

    fs.stat(filePath, (err, stats) => {
        if (!err && stats.isFile()) {
            return sendFile(res, filePath, pathname);
        }
        // Clean URLs (/main/CalculatorGPA -> /main/CalculatorGPA.html) exist only under /main/
        if (pathname.startsWith('/main/') && !path.extname(filePath)) {
            const htmlPath = `${filePath}.html`;
            return fs.stat(htmlPath, (htmlErr, htmlStats) => {
                if (!htmlErr && htmlStats.isFile()) return sendFile(res, htmlPath, pathname);
                sendNotFound(res);
            });
        }
        sendNotFound(res);
    });
}

function sendFile(res, filePath, pathname) {
    const ext = path.extname(filePath).toLowerCase();
    res.setHeader('Content-Type', MIME_TYPES[ext] || 'application/octet-stream');
    for (const { key, value } of SECURITY_HEADERS) {
        res.setHeader(key, value);
    }
    res.setHeader('Cache-Control', ext === '.html' || pathname === '/sw.js' ? 'no-cache' : 'public, max-age=3600');

    const stream = fs.createReadStream(filePath);
    stream.on('error', () => {
        if (!res.headersSent) {
            res.statusCode = 500;
            res.end('Server Error');
        }
    });
    stream.pipe(res);
}

/**
 * Main HTTP request dispatcher
 */
const server = http.createServer(async (req, res) => {
    enhanceResponse(res);

    let parsedUrl;
    try {
        parsedUrl = new URL(req.url, 'http://localhost');
    } catch {
        res.statusCode = 400;
        return res.end('Bad Request');
    }
    req.query = Object.fromEntries(parsedUrl.searchParams.entries());
    const pathname = parsedUrl.pathname || '/';

    // CORS preflight and headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
    res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization, x-telegram-bot-api-secret-token');

    if (req.method === 'OPTIONS') {
        res.statusCode = 200;
        return res.end();
    }

    // Health check
    if (pathname === '/health' || pathname === '/api/health') {
        return res.json({
            ok: true,
            status: 'healthy',
            uptime: Math.round(process.uptime()),
            timestamp: new Date().toISOString(),
            kv: statsEngine.getKvBackend(),
            kvReady: statsEngine.isKvReady(),
            polling: process.env.BOT_POLLING === 'true'
        });
    }

    // Dispatch API routes
    if (pathname.startsWith('/api/')) {
        // Without a trusted reverse proxy in front, client-supplied forwarding headers are spoofable.
        if (process.env.TRUST_PROXY !== '1') {
            req.headers['x-forwarded-for'] = req.socket.remoteAddress || 'unknown';
            delete req.headers['x-real-ip'];
        }

        await parseRequestBody(req);
        if (req.bodyTooLarge) {
            res.statusCode = 413;
            res.setHeader('Connection', 'close');
            return res.json({ ok: false, error: 'Payload too large' });
        }

        const handlerPath = API_ROUTES[pathname];
        if (handlerPath) {
            try {
                const handler = require(handlerPath);
                return await handler(req, res);
            } catch (err) {
                console.error(`API Route Error [${pathname}]:`, err);
                if (!res.headersSent) {
                    res.statusCode = 500;
                    return res.json({ ok: false, error: 'Internal Server Error' });
                }
                return;
            }
        }

        res.statusCode = 404;
        return res.json({ ok: false, error: `API route ${pathname} not found` });
    }

    // Static files
    serveStatic(req, res, pathname);
});

/** First configuration problem that makes a production start unsafe, or null. */
function validateProductionEnv() {
    if (!getBotToken().includes(':')) {
        return 'TELEGRAM_BOT_TOKEN is missing or malformed';
    }
    if (getAdminChatIds().length === 0) {
        return 'ADMIN_CHAT_ID is not set';
    }
    if (Buffer.from(process.env.SESSION_ENC_KEY || '', 'base64').length !== 32) {
        return 'SESSION_ENC_KEY must be 32 bytes, base64-encoded (openssl rand -base64 32)';
    }
    if (!statsEngine.getKvBackend()) {
        return 'no KV backend: set REDIS_URL or KV_REST_API_URL + KV_REST_API_TOKEN';
    }
    if (process.env.BOT_POLLING !== 'true' && (process.env.TELEGRAM_SECRET_TOKEN || '').length < 32) {
        return 'TELEGRAM_SECRET_TOKEN must be at least 32 characters in webhook mode';
    }
    return null;
}

if (require.main === module) {
    if (isProduction()) {
        const problem = validateProductionEnv();
        if (problem) {
            console.error(`❌ Config error: ${problem}`);
            process.exit(1);
        }
    }
    process.on('unhandledRejection', (err) => console.error('Unhandled rejection:', err));

    const bot = process.env.BOT_POLLING === 'true' ? require('./api/bot/index.js') : null;
    let cronTimeout = null;
    let cronInterval = null;
    let currentRun = null;

    async function cronTick(runCron) {
        if (currentRun) {
            console.warn('Cron tick skipped: previous run still active');
            return;
        }
        currentRun = (async () => {
            try {
                const r = await runCron();
                if (r.ok === false) {
                    console.warn(`⏰ Cron: ${r.error}`);
                } else {
                    console.log(`⏰ Cron: users=${r.usersChecked ?? 0} critical=${r.criticalSent ?? 0} daily=${r.dailySent ?? 0} evening=${r.eveningSent ?? 0}`);
                }
            } catch (err) {
                console.warn('Background cron run error:', err.message);
            }
        })();
        try {
            await currentRun;
        } finally {
            currentRun = null;
        }
    }

    server.listen(PORT, HOST, () => {
        console.log(`🚀 GradeMaster server is running at http://${HOST}:${PORT}`);
        console.log(`   🩺 Health check: http://${HOST}:${PORT}/health`);

        if (bot) {
            bot.startPolling();
        }

        if (process.env.ENABLE_BACKGROUND_CRON === 'true') {
            const { runCron } = require('./api/cron.js');
            cronTimeout = setTimeout(() => cronTick(runCron), 60 * 1000);
            cronInterval = setInterval(() => cronTick(runCron), 15 * 60 * 1000);
            console.log('⏰ Background cron active: first run in 60 s, then every 15 minutes');
        }
    });

    let shuttingDown = false;
    async function shutdown() {
        if (shuttingDown) return;
        shuttingDown = true;
        console.log('Shutting down…');
        setTimeout(() => process.exit(1), 25000).unref();
        clearTimeout(cronTimeout);
        clearInterval(cronInterval);
        try {
            if (bot) await bot.stopPolling();
            if (currentRun) await Promise.race([currentRun, delay(20000, undefined, { ref: false })]);
            await new Promise(resolve => server.close(() => resolve()));
            await statsEngine.closeKv();
        } catch (err) {
            console.error('Shutdown error:', err.message);
        }
        process.exit(0);
    }
    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
}

module.exports = server;
