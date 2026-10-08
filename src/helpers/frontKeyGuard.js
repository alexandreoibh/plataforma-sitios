const crypto = require('crypto');

// Rotas chamadas só pelos servidores PHP (sites e painel na hospedagem): exigem X-Front-Key = FRONT_KEY.
// Sem FRONT_KEY configurada (ou curta) a rota fica fechada — nunca aberta por esquecimento.
module.exports = (req, res, next) => {
    const esperada = process.env.FRONT_KEY || '';
    const recebida = String(req.header('X-Front-Key') || '');
    const ok = esperada.length >= 16 && recebida.length === esperada.length
        && crypto.timingSafeEqual(Buffer.from(recebida), Buffer.from(esperada));
    if (!ok) return res.status(403).json({ message: 'Acesso negado.' });
    return next();
};
