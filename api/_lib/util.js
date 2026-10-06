// api/_lib/util.js
// Shared helpers for the bot, the cron runner and the HTTP handlers.
// Vercel ignores `_`-prefixed paths under api/, so this never becomes a function.

const crypto = require('node:crypto');

function safeCompare(a, b) {
    if (typeof a !== 'string' || typeof b !== 'string') return false;
    const bufA = Buffer.from(a);
    const bufB = Buffer.from(b);
    if (bufA.length !== bufB.length) return false;
    return crypto.timingSafeEqual(bufA, bufB);
}

function getBotToken() {
    return (process.env.TELEGRAM_BOT_TOKEN || '').trim();
}

/** Admin chat ids, read from the environment on every call. */
function getAdminChatIds() {
    const raw = (process.env.ADMIN_CHAT_ID || process.env.TELEGRAM_CHAT_ID || '').trim();
    return raw ? raw.split(/[,\s;]+/).map(s => s.trim()).filter(Boolean) : [];
}

function isProduction() {
    return process.env.NODE_ENV === 'production';
}

function esc(str) {
    return String(str ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

/** Map that drops its least recently written entries beyond `maxEntries`. */
class BoundedMap extends Map {
    constructor(maxEntries) {
        super();
        this.max = maxEntries;
    }

    set(key, value) {
        if (this.has(key)) this.delete(key);
        super.set(key, value);
        while (this.size > this.max) {
            this.delete(this.keys().next().value);
        }
        return this;
    }
}

/** Set that drops its least recently added members beyond `maxEntries`. */
class BoundedSet extends Set {
    constructor(maxEntries) {
        super();
        this.max = maxEntries;
    }

    add(value) {
        if (this.has(value)) this.delete(value);
        super.add(value);
        while (this.size > this.max) {
            this.delete(this.values().next().value);
        }
        return this;
    }
}

// Session secrets at rest: AES-256-GCM, `enc:v1:<iv>:<tag>:<ciphertext>` (base64url).
const SEALED_PREFIX = 'enc:v1:';
const GCM_TAG_BYTES = 16;

function hasEncryptionKey() {
    return Boolean(process.env.SESSION_ENC_KEY);
}

function getEncryptionKey() {
    if (!hasEncryptionKey()) return null;
    const key = Buffer.from(process.env.SESSION_ENC_KEY, 'base64');
    if (key.length !== 32) {
        throw new Error('SESSION_ENC_KEY must be 32 bytes base64');
    }
    return key;
}

function isSealed(value) {
    return typeof value === 'string' && value.startsWith(SEALED_PREFIX);
}

/** Encrypts `plain` when SESSION_ENC_KEY is set; returns it unchanged otherwise (dev, tests). */
function sealSecret(plain) {
    const key = getEncryptionKey();
    if (!key) return plain;
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv, { authTagLength: GCM_TAG_BYTES });
    const ciphertext = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `${SEALED_PREFIX}${iv.toString('base64url')}:${tag.toString('base64url')}:${ciphertext.toString('base64url')}`;
}

/**
 * Decrypts a sealed value. Legacy plaintext passes through unchanged; a sealed
 * value that cannot be authenticated (wrong or missing key, tampering) gives null.
 */
function openSecret(stored) {
    if (!isSealed(stored)) return stored;
    try {
        const key = getEncryptionKey();
        if (!key) throw new Error('SESSION_ENC_KEY is not set');
        const [iv, tag, ciphertext] = stored.slice(SEALED_PREFIX.length).split(':');
        const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'), { authTagLength: GCM_TAG_BYTES });
        decipher.setAuthTag(Buffer.from(tag, 'base64url'));
        return Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64url')), decipher.final()]).toString('utf8');
    } catch {
        console.warn('openSecret: failed to decrypt stored secret');
        return null;
    }
}

module.exports = {
    safeCompare,
    getBotToken,
    getAdminChatIds,
    isProduction,
    esc,
    BoundedMap,
    BoundedSet,
    sealSecret,
    openSecret,
    isSealed,
    hasEncryptionKey
};
