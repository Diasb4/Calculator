// api/bot/lms_grades.js
// Модуль прямого парсинга журнала оценок Moodle LMS (lms.astanait.edu.kz)
// Извлекает актуальные баллы Register Midterm, Register Endterm и Register Final по всем курсам студента.

const LMS_BASE_URL = 'https://lms.astanait.edu.kz';

/**
 * Очистить строку от HTML-тегов и лишних пробелов
 */
function stripHtml(html) {
    if (!html) return '';
    return html
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
        .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Извлечь числовой балл из строки ячейки (например: "85.00", "85,50", "85.00 (85 %)")
 */
function extractScore(rawText) {
    if (!rawText) return null;
    const clean = rawText.replace(',', '.');
    const match = clean.match(/(\d+(?:\.\d+)?)/);
    return match ? parseFloat(match[1]) : null;
}

/**
 * Парсить страницу обзора курсов (grade/report/overview/index.php)
 * Возвращает массив { id: string, name: string }
 */
function parseOverviewCourses(html) {
    const courses = [];
    if (!html || typeof html !== 'string') return courses;

    // Ищем ссылки на отчет по оценкам конкретного курса:
    // /grade/report/user/index.php?id=XXXX
    const courseRegex = /href="[^"]*\/grade\/report\/user\/index\.php\?[^"]*id=(\d+)[^"]*"[^>]*>([\s\S]*?)<\/a>/gi;
    let match;
    const seenIds = new Set();

    while ((match = courseRegex.exec(html)) !== null) {
        const id = match[1];
        const rawName = stripHtml(match[2]);
        if (id && rawName && !seenIds.has(id)) {
            seenIds.add(id);
            courses.push({
                id,
                name: rawName
            });
        }
    }

    // Резервный поиск, если ссылки ведут на /course/view.php?id=XXXX
    if (courses.length === 0) {
        const fallbackRegex = /href="[^"]*\/course\/view\.php\?id=(\d+)"[^>]*>([\s\S]*?)<\/a>/gi;
        while ((match = fallbackRegex.exec(html)) !== null) {
            const id = match[1];
            const rawName = stripHtml(match[2]);
            if (id && rawName && !seenIds.has(id) && id !== '1') {
                seenIds.add(id);
                courses.push({ id, name: rawName });
            }
        }
    }

    return courses;
}

/**
 * Парсить детальную таблицу оценок курса (grade/report/user/index.php?id=XXXX)
 */
function parseCourseUserGrades(html, courseName = '') {
    const result = {
        name: courseName,
        teacher: '',
        regmid: 0,
        regend: 0,
        regterm: 0,
        regfinal: null,
        activities: [],
        foundRegisters: false
    };

    if (!html || typeof html !== 'string') return result;

    // Попытка извлечь преподавателя из страницы курса
    const teacherMatch = html.match(/(?:Преподаватель|Teacher|Оқытушы)[:\s]+<[^>]*>([^<]+)/i) ||
                         html.match(/(?:Преподаватель|Teacher|Оқытушы)[:\s]+([A-Za-zА-Яа-яЁёƏəҒғҚқҢңӨөҰұҮүҺһІі\s]{3,40})/i);
    if (teacherMatch) {
        result.teacher = stripHtml(teacherMatch[1]).trim();
    }

    // Если имя курса не было передано, извлекаем из заголовка h1/title
    if (!result.name) {
        const titleMatch = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) || html.match(/<title>([\s\S]*?)<\/title>/i);
        if (titleMatch) {
            const stripped = stripHtml(titleMatch[1]);
            result.name = stripped.replace(/:.*$/i, '').trim();
        }
    }

    // Ищем строки таблицы <tr ...>...</tr>
    const rowRegex = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
    let rowMatch;

    while ((rowMatch = rowRegex.exec(html)) !== null) {
        const rowHtml = rowMatch[1];
        const rowText = stripHtml(rowHtml);

        if (!rowText) continue;

        // Ищем ячейки оценок
        // Обычно в Moodle ячейка с оценкой имеет класс column-grade или column-percentage
        let gradeCellText = '';
        const gradeCellMatch = rowHtml.match(/class="[^"]*\bcolumn-grade\b[^"]*"[^>]*>([\s\S]*?)<\/td>/i);
        if (gradeCellMatch) {
            gradeCellText = stripHtml(gradeCellMatch[1]);
        } else {
            // Резервный поиск по всем td
            const tdMatches = Array.from(rowHtml.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi));
            if (tdMatches.length >= 2) {
                // Вторая колонка обычно балл
                gradeCellText = stripHtml(tdMatches[1][1]);
            }
        }

        const score = extractScore(gradeCellText) ?? extractScore(rowText.replace(/^[^\d]*/, ''));

        // Проверяем ключевые термины Moodle AITU
        if (/Register\s*Midterm|РегМид/i.test(rowText)) {
            result.regmid = score ?? 0;
            result.foundRegisters = true;
        } else if (/Register\s*Endterm|РегЭнд/i.test(rowText)) {
            result.regend = score ?? 0;
            result.foundRegisters = true;
        } else if (/Register\s*Term|РегТерм/i.test(rowText)) {
            result.regterm = score ?? ((result.regmid + result.regend) / 2);
        } else if (/Register\s*Final|РегФайнал|Final\s*Exam/i.test(rowText)) {
            if (score !== null && score > 0) {
                result.regfinal = score;
            }
        } else if (score !== null) {
            // Другие активности (Attendance, HW, Quizzes)
            const cleanItemName = rowText.split(/\d+/)[0].trim();
            if (cleanItemName && cleanItemName.length > 2) {
                result.activities.push({
                    name: cleanItemName,
                    score
                });
            }
        }
    }

    // Если отдельного поля Register Term не было, считаем полусумму
    if (result.regterm === 0 && (result.regmid > 0 || result.regend > 0)) {
        result.regterm = (result.regmid + result.regend) / 2;
    }

    return result;
}

/**
 * Выполнить полный сбор оценок студента из LMS по MoodleSession
 * @param {string} moodleSession - значение куки MoodleSession
 * @returns {Promise<{ ok: boolean, error?: string, sessionExpired?: boolean, courses?: Array, studentName?: string }>}
 */
async function fetchMoodleStudentGrades(moodleSession) {
    if (!moodleSession || typeof moodleSession !== 'string') {
        return { ok: false, error: 'MoodleSession cookie не указана' };
    }

    const cleanSession = moodleSession.trim().replace(/^MoodleSession=/i, '');
    const cookieHeader = `MoodleSession=${cleanSession}`;

    try {
        // 1. Запрашиваем обзор оценок всех курсов
        const overviewRes = await fetch(`${LMS_BASE_URL}/grade/report/overview/index.php`, {
            headers: {
                'Cookie': cookieHeader,
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) GradeMasterBot/2.0'
            },
            redirect: 'manual',
            signal: AbortSignal.timeout(15000)
        });

        if (overviewRes.status === 302 || overviewRes.status === 303) {
            const loc = overviewRes.headers.get('location') || '';
            if (loc.includes('login/index.php')) {
                return {
                    ok: false,
                    sessionExpired: true,
                    error: 'Сессия MoodleSession устарела. Требуется обновить куку из браузера.'
                };
            }
        }

        const overviewHtml = await overviewRes.text();
        if (overviewHtml.includes('name="logintoken"') || overviewHtml.includes('login-form')) {
            return {
                ok: false,
                sessionExpired: true,
                error: 'Сессия MoodleSession недействительна. Пожалуйста, выполните вход в lms.astanait.edu.kz заново.'
            };
        }

        // Извлекаем имя студента
        const userMatch = overviewHtml.match(/class="usertext\s+me-1">([^<]+)/i) ||
                          overviewHtml.match(/class="usertext\s+mr-1">([^<]+)/i) ||
                          overviewHtml.match(/class="userbutton"[^>]*>[\s\S]*?<span class="usertext[^"]*">([^<]+)/i);
        const studentName = userMatch ? stripHtml(userMatch[1]) : '';

        // Находим все курсы
        const courseList = parseOverviewCourses(overviewHtml);
        if (courseList.length === 0) {
            return {
                ok: false,
                error: 'Не найдены активные курсы в журнале оценок LMS.'
            };
        }

        // 2. Детальные табели по курсам, не больше 4 запросов к LMS одновременно
        const fetchCourseGrades = async (course) => {
            try {
                const reportUrl = `${LMS_BASE_URL}/grade/report/user/index.php?id=${encodeURIComponent(course.id)}`;
                const userRes = await fetch(reportUrl, {
                    headers: {
                        'Cookie': cookieHeader,
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) GradeMasterBot/2.0'
                    },
                    redirect: 'manual',
                    signal: AbortSignal.timeout(15000)
                });
                // A redirect here means the session was dropped mid-sync (login page)
                if (!userRes.ok) return null;
                const userHtml = await userRes.text();
                return parseCourseUserGrades(userHtml, course.name);
            } catch (err) {
                console.warn(`Ошибка парсинга курса ${course.id}:`, err.message);
                return null;
            }
        };

        const settledResults = [];
        for (let i = 0; i < courseList.length; i += 4) {
            settledResults.push(...await Promise.all(courseList.slice(i, i + 4).map(fetchCourseGrades)));
        }
        const validCourses = settledResults.filter(Boolean);

        return {
            ok: true,
            studentName,
            coursesCount: validCourses.length,
            courses: validCourses
        };
    } catch (err) {
        return {
            ok: false,
            error: `Сетевая ошибка при обращении к LMS: ${err.message}`
        };
    }
}

module.exports = {
    stripHtml,
    extractScore,
    parseOverviewCourses,
    parseCourseUserGrades,
    fetchMoodleStudentGrades
};
