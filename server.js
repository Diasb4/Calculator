// server.js
// Standalone production HTTP server for GradeMaster (VPS / Docker / PM2 deployment)
// Zero external dependencies - uses standard Node.js libraries.

const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const PORT = parseInt(process.env.PORT || '3000', 10);
const HOST = process.env.HOST || '0.0.0.0';
const ROOT_DIR = __dirname;

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

// Map API routes to their respective handlers
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
 * Parse incoming request body
 */
async function parseRequestBody(req) {
    return new Promise((resolve) => {
        if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
            req.body = {};
            return resolve();
        }

        const chunks = [];
        req.on('data', (chunk) => chunks.push(chunk));
        req.on('end', () => {
            const buffer = Buffer.concat(chunks);
            const str = buffer.toString('utf8');
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

/**
 * Serve static files from workspace root
 */
function serveStatic(req, res, pathname) {
    let safePath = path.normalize(pathname).replace(/^(\.\.[\/\\])+/, '');
    if (safePath === '/' || safePath === '') {
        safePath = '/index.html';
    }

    const filePath = path.join(ROOT_DIR, safePath);

    // Prevent directory traversal outside ROOT_DIR
    if (!filePath.startsWith(ROOT_DIR)) {
        res.statusCode = 403;
        return res.end('Forbidden');
    }

    fs.stat(filePath, (err, stats) => {
        if (err || !stats.isFile()) {
            // If file not found, try adding .html (clean URLs)
            if (!path.extname(filePath)) {
                const htmlPath = filePath + '.html';
                fs.stat(htmlPath, (htmlErr, htmlStats) => {
                    if (!htmlErr && htmlStats.isFile()) {
                        return sendFile(res, htmlPath, '.html');
                    }
                    res.statusCode = 404;
                    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
                    res.end('404 Not Found');
                });
                return;
            }

            res.statusCode = 404;
            res.setHeader('Content-Type', 'text/plain; charset=utf-8');
            res.end('404 Not Found');
            return;
        }

        const ext = path.extname(filePath).toLowerCase();
        sendFile(res, filePath, ext);
    });
}

function sendFile(res, filePath, ext) {
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    res.setHeader('Content-Type', contentType);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');

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

    const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
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
            timestamp: new Date().toISOString()
        });
    }

    // Dispatch API routes
    if (pathname.startsWith('/api/')) {
        await parseRequestBody(req);

        // Exact match or prefix match
        const routeKey = Object.keys(API_ROUTES).find(r => pathname === r || pathname.startsWith(r + '/'));
        if (routeKey) {
            const handlerPath = API_ROUTES[routeKey];
            try {
                const handler = require(handlerPath);
                if (typeof handler === 'function') {
                    return await handler(req, res);
                } else if (handler && typeof handler.default === 'function') {
                    return await handler.default(req, res);
                }
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

// Start listening if run directly
if (require.main === module) {
    server.listen(PORT, HOST, () => {
        console.log(`🚀 GradeMaster server is running at http://${HOST}:${PORT}`);
        console.log(`   Health check: http://${HOST}:${PORT}/health`);
        console.log(`   Telegram Bot Webhook: http://${HOST}:${PORT}/api/bot`);
    });
}

module.exports = server;
