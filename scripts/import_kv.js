// scripts/import_kv.js
// Скрипт восстановления дампа базы данных Upstash Redis / Vercel KV из JSON-файла

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
const inputFile = args[2] || path.join(process.cwd(), 'backup_kv.json');

if (!rawUrl || !token) {
    console.error('❌ Ошибка: не указаны целевой KV_REST_API_URL и KV_REST_API_TOKEN!');
    console.log('\nИспользование:');
    console.log('  node scripts/import_kv.js <URL> <TOKEN> [файл_бэкапа.json]');
    process.exit(1);
}

if (!fs.existsSync(inputFile)) {
    console.error(`❌ Файл бэкапа не найден: ${inputFile}`);
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

async function main() {
    console.log('📖 Чтение файла бэкапа:', inputFile);
    const raw = fs.readFileSync(inputFile, 'utf8');
    const backup = JSON.parse(raw);
    const records = backup.data || [];

    console.log(`📦 Записей для загрузки: ${records.length}`);
    console.log('📡 Подключение к целевому Redis:', cleanUrl);

    const BATCH_SIZE = 50;

    for (let i = 0; i < records.length; i += BATCH_SIZE) {
        const batch = records.slice(i, i + BATCH_SIZE);
        const commands = [];

        for (const item of batch) {
            const { key, type, ttl, value } = item;
            if (value === null || value === undefined) continue;

            if (type === 'string') {
                if (ttl && ttl > 0) {
                    commands.push(['SET', key, typeof value === 'object' ? JSON.stringify(value) : String(value), 'EX', ttl]);
                } else {
                    commands.push(['SET', key, typeof value === 'object' ? JSON.stringify(value) : String(value)]);
                }
            } else if (type === 'set' && Array.isArray(value) && value.length > 0) {
                commands.push(['SADD', key, ...value.map(v => typeof v === 'object' ? JSON.stringify(v) : String(v))]);
                if (ttl && ttl > 0) commands.push(['EXPIRE', key, ttl]);
            } else if (type === 'list' && Array.isArray(value) && value.length > 0) {
                commands.push(['RPUSH', key, ...value.map(v => typeof v === 'object' ? JSON.stringify(v) : String(v))]);
                if (ttl && ttl > 0) commands.push(['EXPIRE', key, ttl]);
            } else if (type === 'hash' && value && typeof value === 'object') {
                const entries = Object.entries(value).flat();
                if (entries.length > 0) {
                    commands.push(['HSET', key, ...entries.map(v => typeof v === 'object' ? JSON.stringify(v) : String(v))]);
                    if (ttl && ttl > 0) commands.push(['EXPIRE', key, ttl]);
                }
            } else if (type === 'zset' && Array.isArray(value) && value.length > 0) {
                // WITHSCORES returns [member, score, member, score] or pairs
                const zArgs = [];
                for (let idx = 0; idx < value.length; idx += 2) {
                    zArgs.push(value[idx + 1], value[idx]); // score member
                }
                if (zArgs.length > 0) {
                    commands.push(['ZADD', key, ...zArgs]);
                    if (ttl && ttl > 0) commands.push(['EXPIRE', key, ttl]);
                }
            }
        }

        if (commands.length > 0) {
            await kvPipeline(commands);
        }

        process.stdout.write(`\r   Восстановлено: ${Math.min(i + BATCH_SIZE, records.length)} / ${records.length}`);
    }

    console.log('\n🎉 ВСЕ ДАННЫЕ УСПЕШНО ВОССТАНОВЛЕНЫ В ЦЕЛЕВУЮ БАЗУ!');
}

main().catch(err => {
    console.error('\n❌ Ошибка восстановления:', err);
    process.exit(1);
});
