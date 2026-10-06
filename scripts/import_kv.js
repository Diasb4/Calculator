// scripts/import_kv.js
// Восстановление дампа (scripts/export_kv.js) в настроенный KV: Redis (REDIS_URL)
// или Upstash / Vercel KV REST (KV_REST_API_URL + KV_REST_API_TOKEN).
//
//   node --env-file=.env scripts/import_kv.js <файл_дампа.json>
//
// Сессии студентов (gm:user:<id>:session, gm:user:<id>:lms_session) шифруются
// при записи, если задан SESSION_ENC_KEY.

const fs = require('node:fs');
const { getKvBackend, kvPipeline, closeKv } = require('../api/stats/engine.js');
const { sealSecret, isSealed, hasEncryptionKey } = require('../api/_lib/util.js');

const SECRET_KEY_PATTERN = /^gm:user:[^:]+:(session|lms_session)$/;
const BATCH_SIZE = 50;
const PIPELINE_TIMEOUT_MS = 15000;

const toArg = (v) => (typeof v === 'object' ? JSON.stringify(v) : String(v));

function buildCommands({ key, type, ttl, value }, sealSecrets) {
    if (!key || value === null || value === undefined) return [];
    const expire = ttl && ttl > 0 ? [['EXPIRE', key, ttl]] : [];

    if (type === 'string') {
        let str = toArg(value);
        if (sealSecrets && SECRET_KEY_PATTERN.test(key) && !isSealed(str)) {
            str = sealSecret(str);
        }
        return [ttl && ttl > 0 ? ['SET', key, str, 'EX', ttl] : ['SET', key, str]];
    }
    if (type === 'set' && Array.isArray(value) && value.length > 0) {
        return [['SADD', key, ...value.map(toArg)], ...expire];
    }
    if (type === 'list' && Array.isArray(value) && value.length > 0) {
        // DEL first so that a re-run does not append the list twice.
        return [['DEL', key], ['RPUSH', key, ...value.map(toArg)], ...expire];
    }
    if (type === 'hash' && value && typeof value === 'object') {
        // HGETALL comes back as a flat [field, value, ...] array; older dumps hold an object.
        const entries = Array.isArray(value) ? value : Object.entries(value).flat();
        return entries.length > 0 ? [['HSET', key, ...entries.map(toArg)], ...expire] : [];
    }
    if (type === 'zset' && Array.isArray(value) && value.length > 0) {
        // WITHSCORES dump is [member, score, member, score, ...]; ZADD wants score member.
        const zArgs = [];
        for (let idx = 0; idx < value.length; idx += 2) {
            zArgs.push(value[idx + 1], value[idx]);
        }
        return [['ZADD', key, ...zArgs], ...expire];
    }
    return [];
}

async function main() {
    const inputFile = process.argv[2];
    if (!inputFile) {
        console.error('Использование: node --env-file=.env scripts/import_kv.js <файл_дампа.json>');
        process.exit(1);
    }
    const backend = getKvBackend();
    if (!backend) {
        console.error('❌ KV не настроен: задайте REDIS_URL или KV_REST_API_URL + KV_REST_API_TOKEN');
        process.exit(1);
    }

    const dump = JSON.parse(fs.readFileSync(inputFile, 'utf8'));
    const records = Array.isArray(dump) ? dump : (dump.data || []);
    const sealSecrets = hasEncryptionKey();
    console.log(`📦 Записей: ${records.length} → ${backend}${sealSecrets ? ' (сессии шифруются)' : ''}`);

    let imported = 0;
    let errors = 0;

    for (let i = 0; i < records.length; i += BATCH_SIZE) {
        const commands = [];
        const owners = [];
        records.slice(i, i + BATCH_SIZE).forEach((record, idx) => {
            for (const command of buildCommands(record, sealSecrets)) {
                commands.push(command);
                owners.push(idx);
            }
        });
        if (commands.length === 0) continue;

        const results = await kvPipeline(commands, PIPELINE_TIMEOUT_MS);
        const failed = new Set();
        commands.forEach((_, j) => {
            if (!results || results[j] === null || results[j] === undefined) {
                errors++;
                failed.add(owners[j]);
            }
        });
        imported += new Set(owners).size - failed.size;

        process.stdout.write(`\r   ${Math.min(i + BATCH_SIZE, records.length)} / ${records.length}`);
    }

    console.log(`\nImported ${imported} keys, ${errors} errors`);
    await closeKv();
    if (errors > 0) process.exitCode = 1;
}

main().catch(err => {
    console.error('\n❌ Ошибка восстановления:', err.message);
    process.exit(1);
});
