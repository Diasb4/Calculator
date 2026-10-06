// scripts/export_kv.js
// Полный дамп настроенного KV — Redis (REDIS_URL) или Upstash / Vercel KV REST
// (KV_REST_API_URL + KV_REST_API_TOKEN) — в JSON-файл для scripts/import_kv.js.
//
//   node --env-file=.env scripts/export_kv.js <файл_дампа.json>

const fs = require('node:fs');
const { getKvBackend, kvCommand, kvPipeline, closeKv } = require('../api/stats/engine.js');

const BATCH_SIZE = 100;
const TIMEOUT_MS = 15000;

function readCommandFor(key, type) {
    switch (type) {
        case 'string': return ['GET', key];
        case 'set': return ['SMEMBERS', key];
        case 'hash': return ['HGETALL', key];
        case 'list': return ['LRANGE', key, '0', '-1'];
        case 'zset': return ['ZRANGE', key, '0', '-1', 'WITHSCORES'];
        default: return ['DUMP', key];
    }
}

async function main() {
    const outputFile = process.argv[2];
    if (!outputFile) {
        console.error('Использование: node --env-file=.env scripts/export_kv.js <файл_дампа.json>');
        process.exit(1);
    }
    const backend = getKvBackend();
    if (!backend) {
        console.error('❌ KV не настроен: задайте REDIS_URL или KV_REST_API_URL + KV_REST_API_TOKEN');
        process.exit(1);
    }

    console.log(`📡 Выгрузка из ${backend}...`);
    const keys = await kvCommand(['KEYS', '*'], TIMEOUT_MS);
    if (!Array.isArray(keys)) {
        throw new Error('KEYS не выполнился: KV недоступен');
    }

    const records = [];
    for (let i = 0; i < keys.length; i += BATCH_SIZE) {
        const batchKeys = keys.slice(i, i + BATCH_SIZE);
        const meta = await kvPipeline(batchKeys.flatMap(k => [['TYPE', k], ['TTL', k]]), TIMEOUT_MS);
        if (!meta) throw new Error('TYPE/TTL не выполнились: KV недоступен');

        const values = await kvPipeline(batchKeys.map((k, j) => readCommandFor(k, meta[j * 2])), TIMEOUT_MS);
        if (!values) throw new Error('Чтение значений не выполнилось: KV недоступен');

        batchKeys.forEach((key, j) => {
            records.push({ key, type: meta[j * 2], ttl: meta[j * 2 + 1], value: values[j] });
        });
        process.stdout.write(`\r   ${Math.min(i + BATCH_SIZE, keys.length)} / ${keys.length}`);
    }

    const json = JSON.stringify({ dumpedAt: new Date().toISOString(), totalKeys: records.length, data: records }, null, 2);
    fs.writeFileSync(outputFile, json, { mode: 0o600 });
    console.log(`\n💾 Выгружено ключей: ${records.length} → ${outputFile}`);
    console.error('⚠️ dump contains student credentials — never commit it');
    await closeKv();
}

main().catch(err => {
    console.error('\n❌ Ошибка выгрузки:', err.message);
    process.exit(1);
});
