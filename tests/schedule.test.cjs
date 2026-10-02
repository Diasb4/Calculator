// tests/schedule.test.cjs
// Comprehensive tests for My DU (my-du.astanait.edu.kz) Schedule integration

const test = require('node:test');
const assert = require('node:assert/strict');
const schedule = require('../api/bot/schedule.js');
const bot = require('../api/bot/index.js');

test('Schedule: normalizeGroupName normalizes valid groups and rejects invalid input', () => {
    assert.strictEqual(schedule.normalizeGroupName('SE 2301'), 'SE-2301');
    assert.strictEqual(schedule.normalizeGroupName('se-2301'), 'SE-2301');
    assert.strictEqual(schedule.normalizeGroupName('it_2204'), 'IT-2204');
    assert.strictEqual(schedule.normalizeGroupName('  CS-2405  '), 'CS-2405');
    assert.strictEqual(schedule.normalizeGroupName('MT2401'), 'MT2401');

    // Invalid & malicious input
    assert.strictEqual(schedule.normalizeGroupName('<script>alert(1)</script>'), null);
    assert.strictEqual(schedule.normalizeGroupName('SELECT * FROM groups'), null);
    assert.strictEqual(schedule.normalizeGroupName(''), null);
    assert.strictEqual(schedule.normalizeGroupName(null), null);
    assert.strictEqual(schedule.normalizeGroupName('a'), null); // too short
    assert.strictEqual(schedule.normalizeGroupName('A'.repeat(50)), null); // too long
});

test('Schedule: parseScheduleData correctly parses slots, times and assigns days', () => {
    const mockApiResponse = {
        weekNumber: 3,
        studyYear: '2024-2025',
        term: 1,
        times: [
            { id: 10, shiftNumber: 1, orderNumber: 1, startTime: '09:00', endTime: '09:50', title: '09:00 - 09:50' },
            { id: 20, shiftNumber: 1, orderNumber: 2, startTime: '10:00', endTime: '10:50', title: '10:00 - 10:50' },
            { id: 30, shiftNumber: 1, orderNumber: 3, startTime: '11:00', endTime: '11:50', title: '11:00 - 11:50' }
        ],
        weekDays: [
            { id: 1, title: 'Понедельник' },
            { id: 2, title: 'Вторник' }
        ],
        slots: [
            {
                id: 1,
                classTimeId: 10,
                items: [
                    {
                        weekDayId: 1,
                        subjectName: 'Cloud Technologies',
                        lessonTypeName: 'Lecture',
                        building: 'C1',
                        classroom: '2.234',
                        teacherName: 'Иванов И.И.',
                        academicGroupName: 'SE-2301'
                    }
                ]
            },
            {
                id: 2,
                classTimeId: 20,
                items: [
                    {
                        weekDayId: 1,
                        subjectName: 'Philosophy',
                        lessonTypeName: 'Practice',
                        building: 'C1',
                        classroom: '1.112',
                        teacherName: 'Петров П.П.',
                        academicGroupName: 'SE-2301'
                    }
                ]
            },
            {
                id: 3,
                classTimeId: 30,
                items: [
                    {
                        weekDayId: 2,
                        subjectName: 'Project Management',
                        lessonTypeName: 'Laboratory',
                        building: 'C1',
                        classroom: '3.101',
                        teacherName: 'Сидоров С.С.',
                        academicGroupName: 'SE-2301'
                    }
                ]
            }
        ]
    };

    const parsed = schedule.parseScheduleData(mockApiResponse);
    assert.strictEqual(parsed.ok, true);
    assert.strictEqual(parsed.weekNumber, 3);
    assert.strictEqual(parsed.days.length, 6);

    // Monday
    const monday = parsed.days.find(d => d.dayOfWeek === 1);
    assert.ok(monday);
    assert.strictEqual(monday.lessons.length, 2);
    assert.strictEqual(monday.lessons[0].subjectName, 'Cloud Technologies');
    assert.strictEqual(monday.lessons[0].classroom, 'C1.2.234');
    assert.strictEqual(monday.lessons[0].lessonTypeName, 'Lecture');
    assert.strictEqual(monday.lessons[1].subjectName, 'Philosophy');

    // Tuesday
    const tuesday = parsed.days.find(d => d.dayOfWeek === 2);
    assert.ok(tuesday);
    assert.strictEqual(tuesday.lessons.length, 1);
    assert.strictEqual(tuesday.lessons[0].subjectName, 'Project Management');
    assert.strictEqual(tuesday.lessons[0].classroom, 'C1.3.101');
    assert.strictEqual(tuesday.lessons[0].lessonTypeName, 'Laboratory');

    // Wednesday (empty)
    const wednesday = parsed.days.find(d => d.dayOfWeek === 3);
    assert.ok(wednesday);
    assert.strictEqual(wednesday.lessons.length, 0);
});

test('Schedule: formatScheduleMessage handles today, tomorrow, week and unconfigured states', () => {
    // 1. Unconfigured state
    const unconfigMsg = schedule.formatScheduleMessage({ ok: false, notConfigured: true }, 'today');
    assert.match(unconfigMsg, /set_group/);

    // 2. Requires auth state
    const authMsg = schedule.formatScheduleMessage({ ok: false, requiresAuth: true }, 'today');
    assert.match(authMsg, /my-du\.astanait\.edu\.kz/);

    // 3. Normal schedule
    const mockSchedule = {
        ok: true,
        groupName: 'SE-2301',
        weekNumber: 4,
        days: [
            {
                dayOfWeek: 1,
                dayTitle: 'Понедельник',
                lessons: [
                    {
                        time: '09:00 - 09:50',
                        startTime: '09:00',
                        endTime: '09:50',
                        subjectName: 'Cloud Technologies',
                        lessonTypeName: 'Lecture',
                        classroom: 'C1.2.234',
                        teacherName: 'Иванов И.И.'
                    }
                ]
            },
            {
                dayOfWeek: 2,
                dayTitle: 'Вторник',
                lessons: []
            }
        ]
    };

    // Week mode
    const weekMsg = schedule.formatScheduleMessage(mockSchedule, 'week');
    assert.match(weekMsg, /Расписание на неделю:/);
    assert.match(weekMsg, /SE-2301/);
    assert.match(weekMsg, /Cloud Technologies/);
    assert.match(weekMsg, /C1\.2\.234/);

    // Tomorrow mode
    const tomorrowMsg = schedule.formatScheduleMessage(mockSchedule, 'tomorrow');
    assert.ok(tomorrowMsg.includes('Расписание на ЗАВТРА') || tomorrowMsg.includes('Воскресенье'));

    // Today mode
    const todayMsg = schedule.formatScheduleMessage(mockSchedule, 'today');
    assert.ok(todayMsg.includes('Расписание на СЕГОДНЯ') || todayMsg.includes('Воскресенье'));
});

test('Schedule: generateScheduleIcs generates valid RFC-5545 iCalendar content', () => {
    const mockSchedule = {
        ok: true,
        groupName: 'SE-2301',
        days: [
            {
                dayOfWeek: 1,
                lessons: [
                    {
                        orderNumber: 1,
                        subjectName: 'Cloud Technologies',
                        lessonTypeName: 'Lecture',
                        classroom: 'C1.2.234',
                        teacherName: 'Иванов И.И.'
                    }
                ]
            }
        ]
    };

    const ics = schedule.generateScheduleIcs(mockSchedule);
    assert.ok(ics.startsWith('BEGIN:VCALENDAR'));
    assert.ok(ics.includes('SUMMARY:Cloud Technologies (Lecture)'));
    assert.ok(ics.includes('LOCATION:C1.2.234'));
    assert.ok(ics.includes('END:VCALENDAR'));

    // Invalid input returns empty string
    assert.strictEqual(schedule.generateScheduleIcs(null), '');
    assert.strictEqual(schedule.generateScheduleIcs({ ok: false }), '');
});

test('Schedule: User session management & subscribers memory works', async () => {
    const testChatId = '999111222';
    try {
        await schedule.saveUserGroup(testChatId, 'SE-2301');
        const session = await schedule.getUserDuSession(testChatId);
        assert.ok(session);
        assert.strictEqual(session.groupName, 'SE-2301');

        const subscribers = await schedule.getAllScheduleSubscribers();
        assert.ok(subscribers.includes(testChatId));

        await schedule.deleteUserDuSession(testChatId);
        const deletedSession = await schedule.getUserDuSession(testChatId);
        assert.strictEqual(deletedSession, null);
    } finally {
        await schedule.deleteUserDuSession(testChatId);
    }
});

test('Schedule: Bot command /set_group saves group and replies with schedule', async () => {
    const origToken = process.env.TELEGRAM_BOT_TOKEN;
    process.env.TELEGRAM_BOT_TOKEN = 'mock_token_schedule_test';
    const testChatId = 888777666;

    const originalFetch = global.fetch;
    const sentApiMessages = [];

    global.fetch = async (url, options = {}) => {
        if (url && url.includes('telegram.org')) {
            const body = options.body ? JSON.parse(options.body) : {};
            sentApiMessages.push({ url, body });
            return {
                ok: true,
                status: 200,
                json: async () => ({ ok: true, result: { message_id: 123 } })
            };
        }
        return { ok: true, status: 200, json: async () => ({ ok: true }) };
    };

    const mockRes = {
        status: () => mockRes,
        json: () => mockRes,
        setHeader: () => mockRes
    };

    try {
        // 1. User sends /set_group SE-2301
        await bot({
            method: 'POST',
            body: {
                message: {
                    chat: { id: testChatId },
                    from: { id: testChatId, first_name: 'TestStudent' },
                    text: '/set_group SE-2301'
                }
            }
        }, mockRes);

        const reply = sentApiMessages.find(m => m.body.chat_id === testChatId);
        assert.ok(reply, 'Bot must send response to student');
        assert.match(reply.body.text, /Группа SE-2301 успешно сохранена/);

        // Verify group saved
        const session = await schedule.getUserDuSession(testChatId);
        assert.strictEqual(session.groupName, 'SE-2301');

        // 2. User asks for /schedule
        sentApiMessages.length = 0;
        await bot({
            method: 'POST',
            body: {
                message: {
                    chat: { id: testChatId },
                    from: { id: testChatId, first_name: 'TestStudent' },
                    text: '/schedule'
                }
            }
        }, mockRes);

        const schedReply = sentApiMessages.find(m => m.body.chat_id === testChatId);
        assert.ok(schedReply);
        assert.ok(schedReply.body.reply_markup && schedReply.body.reply_markup.inline_keyboard);

    } finally {
        global.fetch = originalFetch;
        await schedule.deleteUserDuSession(testChatId);
        if (origToken !== undefined) process.env.TELEGRAM_BOT_TOKEN = origToken;
        else delete process.env.TELEGRAM_BOT_TOKEN;
    }
});

test('Schedule: Inline keyboard callback queries (sched_today, sched_tomorrow, sched_week) work', async () => {
    const origToken = process.env.TELEGRAM_BOT_TOKEN;
    process.env.TELEGRAM_BOT_TOKEN = 'mock_token_schedule_test';
    const testChatId = 888777666;

    const originalFetch = global.fetch;
    const sentApiMessages = [];

    global.fetch = async (url, options = {}) => {
        if (url && url.includes('telegram.org')) {
            const body = options.body ? JSON.parse(options.body) : {};
            sentApiMessages.push({ url, body });
            return {
                ok: true,
                status: 200,
                json: async () => ({ ok: true, result: { message_id: 456 } })
            };
        }
        if (url && url.includes('my-du.astanait.edu.kz')) {
            return {
                ok: true,
                status: 200,
                json: async () => ({
                    weekNumber: 2,
                    studyYear: '2024-2025',
                    term: 1,
                    times: [{ id: 1, shiftNumber: 1, orderNumber: 1, startTime: '09:00', endTime: '09:50', title: '09:00 - 09:50' }],
                    weekDays: [{ id: 1, title: 'Понедельник' }],
                    slots: [{
                        id: 1,
                        classTimeId: 1,
                        items: [{
                            weekDayId: 1,
                            subjectName: 'Software Engineering',
                            lessonTypeName: 'Lecture',
                            building: 'C1',
                            classroom: '2.100',
                            teacherName: 'Профессор А.А.'
                        }]
                    }]
                })
            };
        }
        return { ok: true, status: 200, json: async () => ({ ok: true }) };
    };

    const mockRes = {
        status: () => mockRes,
        json: () => mockRes,
        setHeader: () => mockRes
    };

    try {
        await schedule.saveUserDuSession(testChatId, {
            groupName: 'IT-2204',
            accessToken: 'mock_access_token',
            tokenExpiresAt: Date.now() + 600000
        });

        // Click 'sched_week'
        await bot({
            method: 'POST',
            body: {
                callback_query: {
                    id: 'cq_123',
                    from: { id: testChatId },
                    message: { chat: { id: testChatId }, message_id: 777 },
                    data: 'sched_week'
                }
            }
        }, mockRes);

        const editCall = sentApiMessages.find(m => m.url.includes('editMessageText') || m.url.includes('sendMessage'));
        assert.ok(editCall, 'Bot must reply or edit message with week schedule');
        assert.match(editCall.body.text, /Расписание на неделю:/);
        assert.match(editCall.body.text, /IT-2204/);

    } finally {
        global.fetch = originalFetch;
        await schedule.deleteUserDuSession(testChatId);
        if (origToken !== undefined) process.env.TELEGRAM_BOT_TOKEN = origToken;
        else delete process.env.TELEGRAM_BOT_TOKEN;
    }
});

test('Schedule: Bot auto-detects My DU login URL with code and exchanges it', async () => {
    const origToken = process.env.TELEGRAM_BOT_TOKEN;
    process.env.TELEGRAM_BOT_TOKEN = 'mock_token_schedule_test';
    const testChatId = 777111333;

    const originalFetch = global.fetch;
    const sentApiMessages = [];

    global.fetch = async (url, options = {}) => {
        if (url && url.includes('telegram.org')) {
            const body = options.body ? JSON.parse(options.body) : {};
            sentApiMessages.push({ url, body });
            return { ok: true, status: 200, json: async () => ({ ok: true, result: { message_id: 111 } }) };
        }
        if (url && url.includes('/api/auth/external-login')) {
            return {
                ok: true,
                status: 200,
                headers: {
                    get: (h) => (h.toLowerCase() === 'set-cookie' ? 'access_token=jwt_mock_token; refresh_token=refresh_mock_token' : null)
                },
                json: async () => ({ access_token: 'jwt_mock_token', refresh_token: 'refresh_mock_token' })
            };
        }
        return { ok: true, status: 200, json: async () => ({ ok: true }) };
    };

    const mockRes = {
        status: () => mockRes,
        json: () => mockRes,
        setHeader: () => mockRes
    };

    try {
        // User pastes login redirect URL
        await bot({
            method: 'POST',
            body: {
                message: {
                    chat: { id: testChatId },
                    from: { id: testChatId, first_name: 'OAuthStudent' },
                    text: 'https://my-du.astanait.edu.kz/login?code=1.ATwA_mock_oauth_code_xyz123&state=12345#/'
                }
            }
        }, mockRes);

        const reply = sentApiMessages.find(m => m.body.text && m.body.text.includes('Авторизация My DU успешно подключена'));
        assert.ok(reply, 'Bot must send success response');

        const session = await schedule.getUserDuSession(testChatId);
        assert.ok(session);
        assert.strictEqual(session.accessToken, 'jwt_mock_token');
        assert.strictEqual(session.refreshToken, 'refresh_mock_token');

    } finally {
        global.fetch = originalFetch;
        await schedule.deleteUserDuSession(testChatId);
        if (origToken !== undefined) process.env.TELEGRAM_BOT_TOKEN = origToken;
        else delete process.env.TELEGRAM_BOT_TOKEN;
    }
});

test('Schedule: Cron processUserSchedule sends morning schedule for enrolled groups', async () => {
    const cron = require('../api/cron.js');
    const testChatId = 555444333;
    const originalFetch = global.fetch;
    const sentApiMessages = [];

    global.fetch = async (url, options = {}) => {
        if (url && url.includes('telegram.org')) {
            const body = options.body ? JSON.parse(options.body) : {};
            sentApiMessages.push({ url, body });
            return { ok: true, status: 200, json: async () => ({ ok: true, result: { message_id: 222 } }) };
        }
        if (url && url.includes('my-du.astanait.edu.kz')) {
            return {
                ok: true,
                status: 200,
                json: async () => ({
                    weekNumber: 3,
                    studyYear: '2024-2025',
                    term: 1,
                    times: [{ id: 1, startTime: '09:00', endTime: '09:50', title: '09:00 - 09:50' }],
                    weekDays: [
                        { id: 1, title: 'Понедельник' },
                        { id: 2, title: 'Вторник' },
                        { id: 3, title: 'Среда' },
                        { id: 4, title: 'Четверг' },
                        { id: 5, title: 'Пятница' },
                        { id: 6, title: 'Суббота' }
                    ],
                    slots: [1, 2, 3, 4, 5, 6].map(day => ({
                        id: day,
                        classTimeId: 1,
                        items: [{
                            weekDayId: day,
                            subjectName: 'Morning Algorithm Practice',
                            lessonTypeName: 'Practice',
                            building: 'C1',
                            classroom: '2.105',
                            teacherName: 'Ахметов А.А.'
                        }]
                    }))
                })
            };
        }
        return { ok: true, status: 200, json: async () => ({ ok: true }) };
    };

    try {
        if (typeof cron.clearSentAlertsMemory === 'function') cron.clearSentAlertsMemory();
        await schedule.saveUserDuSession(testChatId, {
            groupName: 'SE-2301',
            accessToken: 'valid_cron_token',
            tokenExpiresAt: Date.now() + 600000
        });

        // Run cron in morning window
        const mockRes = {
            statusCode: 200,
            status(c) { this.statusCode = c; return this; },
            json(d) { this._data = d; return this; }
        };

        const origBotToken = process.env.TELEGRAM_BOT_TOKEN;
        process.env.TELEGRAM_BOT_TOKEN = 'mock_cron_bot_token';

        await cron({
            method: 'GET',
            query: { force: '1' },
            headers: {}
        }, mockRes);

        const morningMsg = sentApiMessages.find(m => String(m.body.chat_id) === String(testChatId));
        // If not Sunday, user should receive morning schedule
        const astanaDay = schedule.getAstanaDateInfo().dayOfWeek;
        if (astanaDay !== 7) {
            assert.ok(morningMsg, 'Subscribed student should receive morning schedule');
            assert.match(morningMsg.body.text, /Расписание пар на сегодня/);
            assert.match(morningMsg.body.text, /Morning Algorithm Practice/);
        }

        if (origBotToken !== undefined) process.env.TELEGRAM_BOT_TOKEN = origBotToken;
        else delete process.env.TELEGRAM_BOT_TOKEN;

    } finally {
        global.fetch = originalFetch;
        await schedule.deleteUserDuSession(testChatId);
        if (typeof cron.clearSentAlertsMemory === 'function') cron.clearSentAlertsMemory();
    }
});

test('Schedule: parseScheduleData correctly parses student/me/search response format', () => {
    const studentMeResponse = {
        studyYear: 2026,
        term: 1,
        weekNumber: 4,
        slots: [
            {
                weekDay: { id: 1, name: 'Понедельник' },
                items: [
                    {
                        uid: 8501,
                        classTime: { id: 5, shiftNumber: 1, orderNumber: 5, title: '12:00–12:50' },
                        academicGroupName: 'PM43-EN-L134',
                        subjectName: 'Управление проектами',
                        lessonType: 'Лекции',
                        building: 'Главный корпус',
                        classroom: 'C1.2.123',
                        teacherName: 'Ибадильдин Н.А.',
                        online: false
                    },
                    {
                        uid: null,
                        classTime: { id: 4, shiftNumber: 1, orderNumber: 4, title: '11:00–11:50' },
                        subjectName: null // empty window
                    }
                ]
            },
            {
                weekDay: { id: 5, name: 'Пятница' },
                items: [
                    {
                        uid: 8502,
                        classTime: { id: 9, shiftNumber: 2, orderNumber: 4, title: '17:00–17:50' },
                        academicGroupName: 'CN52-EN-P353',
                        subjectName: 'Компьютерные сети',
                        lessonType: 'Практические занятия',
                        building: 'Главный корпус',
                        classroom: 'C1.2.231K',
                        teacherName: 'Сағымбай А.Б.',
                        online: false
                    }
                ]
            }
        ]
    };

    const parsed = schedule.parseScheduleData(studentMeResponse);
    assert.strictEqual(parsed.ok, true);
    assert.strictEqual(parsed.weekNumber, 4);
    assert.strictEqual(parsed.studyYear, 2026);

    const monday = parsed.days.find(d => d.dayOfWeek === 1);
    assert.ok(monday);
    assert.strictEqual(monday.lessons.length, 1); // empty slot was filtered out
    assert.strictEqual(monday.lessons[0].subjectName, 'Управление проектами');
    assert.strictEqual(monday.lessons[0].time, '12:00–12:50');
    assert.strictEqual(monday.lessons[0].startTime, '12:00');
    assert.strictEqual(monday.lessons[0].endTime, '12:50');
    assert.strictEqual(monday.lessons[0].academicGroupName, 'PM43-EN-L134');
    assert.strictEqual(monday.lessons[0].classroom, 'Главный корпус.C1.2.123');

    const friday = parsed.days.find(d => d.dayOfWeek === 5);
    assert.ok(friday);
    assert.strictEqual(friday.lessons.length, 1);
    assert.strictEqual(friday.lessons[0].subjectName, 'Компьютерные сети');
});

test('Schedule: /test_du_login is strictly isolated to admin and invisible to regular students', async () => {
    const originalFetch = global.fetch;
    const origBotToken = process.env.TELEGRAM_BOT_TOKEN;
    process.env.TELEGRAM_BOT_TOKEN = 'mock_test_token';
    const sentMessages = [];

    global.fetch = async (url, opts) => {
        if (typeof url === 'string' && url.includes('/sendMessage')) {
            const body = JSON.parse(opts.body);
            sentMessages.push(body);
            return {
                ok: true,
                json: async () => ({ ok: true, result: { message_id: 1234 } })
            };
        }
        return { ok: true, json: async () => ({}) };
    };

    try {
        const regularStudentChatId = 99998888;
        const adminChatId = 1365231049; // Gauhar or test admin

        const mockRes = {
            setHeader: () => {},
            status: () => ({ json: () => {} })
        };

        // 1. Regular student sends /test_du_login
        await bot({
            method: 'POST',
            body: {
                message: {
                    chat: { id: regularStudentChatId },
                    from: { id: regularStudentChatId, username: 'regular_user' },
                    text: '/test_du_login'
                }
            },
            headers: {}
        }, mockRes);

        const studentReply = sentMessages.find(m => m.chat_id === regularStudentChatId);
        assert.ok(studentReply);
        assert.match(studentReply.text, /Команда не найдена/);
        assert.strictEqual(Boolean(studentReply.reply_markup?.inline_keyboard?.some(row => row.some(b => b.web_app))), false, 'Regular student must NOT receive WebApp button');

        // 2. Admin sends /test_du_login
        const origAdminEnv = process.env.ADMIN_CHAT_ID;
        process.env.ADMIN_CHAT_ID = String(adminChatId);

        await bot({
            method: 'POST',
            body: {
                message: {
                    chat: { id: adminChatId },
                    from: { id: adminChatId, username: 'admin_user' },
                    text: '/test_du_login'
                }
            },
            headers: {}
        }, mockRes);

        const adminReply = sentMessages.find(m => m.chat_id === adminChatId);
        assert.ok(adminReply);
        assert.match(adminReply.text, /My DU WebApp Connector/);
        const webAppBtn = adminReply.reply_markup?.inline_keyboard?.flat().find(b => b.web_app);
        assert.ok(webAppBtn, 'Admin must receive web_app button');
        assert.match(webAppBtn.web_app.url, /du_auth\.html/);

        if (origAdminEnv !== undefined) process.env.ADMIN_CHAT_ID = origAdminEnv;
        else delete process.env.ADMIN_CHAT_ID;

    } finally {
        global.fetch = originalFetch;
        if (origBotToken !== undefined) process.env.TELEGRAM_BOT_TOKEN = origBotToken;
        else delete process.env.TELEGRAM_BOT_TOKEN;
    }
});



