const crypto = require('crypto');

// Guarda das rotas chamadas por cron externo ou de diagnóstico: header X-Cron-Queue-Key
// comparado em tempo constante com CRON_QUEUE_KEY (o node-cron não roda na Vercel).
module.exports = (req, res, next) => {
    const expectedKey = process.env.CRON_QUEUE_KEY;
    const providedKey = req.header('X-Cron-Queue-Key');

    if (!expectedKey || !providedKey) {
        return res.status(401).json({ message: 'Não autorizado.' });
    }
    const expected = Buffer.from(String(expectedKey));
    const provided = Buffer.from(String(providedKey));
    if (expected.length !== provided.length || !crypto.timingSafeEqual(expected, provided)) {
        return res.status(401).json({ message: 'Não autorizado.' });
    }
    return next();
};
