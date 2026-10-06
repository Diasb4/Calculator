// scripts/export_kv.js
// Скрипт полного дампа базы данных Upstash Redis / Vercel KV в JSON-файл

const fs = require('fs');
const path = require('path');

function loadEnvFile() {
    const envPath = path.join(process.cwd(), '.env');
    if (!fs.existsSync(envPath)) return {};
    const content = fs.readFileSync(envPath, 'utf8');
    const result = {};
    for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx !== -1) {
            const key = trimmed.slice(0, eqIdx).trim();
            let val = trimmed.slice(eqIdx + 1).trim();
            if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
                val = val.slice(1, -1);
            }
            result[key] = val;
        }
    }
    return result;
}

const envVars = loadEnvFile();

const args = process.argv.slice(2);
const rawUrl = (args[0] || process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || envVars.KV_REST_API_URL || envVars.UPSTASH_REDIS_REST_URL || '').trim();
const token = (args[1] || process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || envVars.KV_REST_API_TOKEN || envVars.UPSTASH_REDIS_REST_TOKEN || '').trim();
const outputFile = args[2] || path.join(process.cwd(), 'backup_kv.json');

if (!rawUrl || !token) {
    console.error('❌ Ошибка: не указаны KV_REST_API_URL и KV_REST_API_TOKEN!');
    console.log('\nИспользование:');
    console.log('  node scripts/export_kv.js <URL> <TOKEN> [имя_файла.json]');
    console.log('Или пропишите KV_REST_API_URL и KV_REST_API_TOKEN в файле .env');
    process.exit(1);
}

const cleanUrl = rawUrl.replace(/\/+$/, '');
const pipelineUrl = cleanUrl.endsWith('/pipeline') ? cleanUrl : `${cleanUrl}/pipeline`;

async function kvPipeline(commands) {
    const res = await fetch(pipelineUrl, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(commands)
    });

    if (!res.ok) {
        throw new Error(`Upstash API error ${res.status}: ${await res.text()}`);
    }

    const data = await res.json();
    return Array.isArray(data) ? data.map(item => item?.result) : [];
}

async function kvCommand(cmd) {
    const res = await fetch(cleanUrl, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(cmd)
    });
    if (!res.ok) {
        throw new Error(`Upstash API error ${res.status}: ${await res.text()}`);
    }
    const data = await res.json();
    return data?.result;
}

async function main() {
    console.log('📡 Подключение к Upstash Redis:', cleanUrl);
    console.log('🔍 Получение списка ключей...');

    const keys = await kvCommand(['KEYS', '*']);
    if (!Array.isArray(keys) || keys.length === 0) {
        console.log('⚠️ База пуста, ключи не найдены.');
        fs.writeFileSync(outputFile, JSON.stringify({ dumpedAt: new Date().toISOString(), totalKeys: 0, data: [] }, null, 2));
        return;
    }

    console.log(`✅ Найдено ключей: ${keys.length}. Считывание данных...`);

    const BATCH_SIZE = 100;
    const dumpedRecords = [];

    for (let i = 0; i < keys.length; i += BATCH_SIZE) {
        const batchKeys = keys.slice(i, i + BATCH_SIZE);

        // 1. Узнаем тип и TTL каждого ключа
        const metaCommands = [];
        for (const k of batchKeys) {
            metaCommands.push(['TYPE', k]);
            metaCommands.push(['TTL', k]);
        }
        const metaResults = await kvPipeline(metaCommands);

        // 2. Формируем команды чтения в зависимости от типа
        const fetchCommands = [];
        const batchMeta = [];

        for (let j = 0; j < batchKeys.length; j++) {
            const k = batchKeys[j];
            const type = metaResults[j * 2];
            const ttl = metaResults[j * 2 + 1];

            batchMeta.push({ key: k, type, ttl });

            if (type === 'string') {
                fetchCommands.push(['GET', k]);
            } else if (type === 'set') {
                fetchCommands.push(['SMEMBERS', k]);
            } else if (type === 'hash') {
                fetchCommands.push(['HGETALL', k]);
            } else if (type === 'list') {
                fetchCommands.push(['LRANGE', k, '0', '-1']);
            } else if (type === 'zset') {
                fetchCommands.push(['ZRANGE', k, '0', '-1', 'WITHSCORES']);
            } else {
                fetchCommands.push(['DUMP', k]);
            }
        }

        const valueResults = await kvPipeline(fetchCommands);

        for (let j = 0; j < batchKeys.length; j++) {
            dumpedRecords.push({
                key: batchMeta[j].key,
                type: batchMeta[j].type,
                ttl: batchMeta[j].ttl,
                value: valueResults[j]
            });
        }

        process.stdout.write(`\r   Прогресс: ${Math.min(i + BATCH_SIZE, keys.length)} / ${keys.length}`);
    }

    console.log('\n💾 Сохранение в файл...');

    const backupPayload = {
        dumpedAt: new Date().toISOString(),
        totalKeys: dumpedRecords.length,
        data: dumpedRecords
    };

    fs.writeFileSync(outputFile, JSON.stringify(backupPayload, null, 2), 'utf8');

    const stats = fs.statSync(outputFile);
    console.log(`\n🎉 УСПЕШНО ВЫГРУЖЕНО!`);
    console.log(`📁 Файл бэкапа: ${outputFile}`);
    console.log(`📊 Размер файла: ${(stats.size / 1024).toFixed(2)} KB`);
    console.log(`🔑 Всего сохранено ключей: ${dumpedRecords.length}`);
}

main().catch(err => {
    console.error('\n❌ Ошибка выгрузки:', err);
    process.exit(1);
});
