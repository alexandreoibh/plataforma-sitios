const crypto = require('crypto');

// Guarda das rotas chamadas por cron ou de diagnóstico (o node-cron não roda na Vercel). Aceita:
// - Vercel Cron: `Authorization: Bearer <CRON_SECRET>` (a Vercel manda sozinha quando CRON_SECRET está no ambiente);
// - chamada manual/agendador externo: header X-Cron-Queue-Key = CRON_QUEUE_KEY.
// Comparação em tempo constante; sem a variável configurada, aquele caminho fica fechado.
const confere = (esperada, recebida) => {
    if (!esperada || !recebida) return false;
    const a = Buffer.from(String(esperada));
    const b = Buffer.from(String(recebida));
    return a.length === b.length && crypto.timingSafeEqual(a, b);
};

module.exports = (req, res, next) => {
    const bearer = String(req.header('Authorization') || '').replace(/^Bearer\s+/i, '');
    if (confere(process.env.CRON_QUEUE_KEY, req.header('X-Cron-Queue-Key')) || confere(process.env.CRON_SECRET, bearer)) {
        return next();
    }
    return res.status(401).json({ message: 'Não autorizado.' });
};
