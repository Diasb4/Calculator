// api/quizzes.js
// REST API эндпоинт для отображения квизов AITU на сайте GradeMaster

const aitu = require('./bot/aitu.js');

module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    try {
        const result = await aitu.getUpcomingQuizzes();
        return res.status(200).json(result);
    } catch (err) {
        return res.status(500).json({ ok: false, error: err.message });
    }
};
