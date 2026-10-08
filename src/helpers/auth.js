const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET || 'dev_jwt_secret_change_me';

const extractTokenFromRequest = (req) => {
    const authHeader = req.header('Authorization') || req.header('authorization');
    if (authHeader) {
        const raw = String(authHeader).trim();
        if (raw.toLowerCase().startsWith('bearer ')) {
            const token = raw.split(' ')[1];
            if (token) return token.trim();
        }
    }
    const headerToken = req.header('x-access-token');
    if (headerToken && String(headerToken).trim().split('.').length === 3) {
        return String(headerToken).trim();
    }
    return null;
};

// Middleware do painel. O escopo vem SEMPRE do token, nunca do body/query:
//   req.idusuario, req.sitio_id (sítio ativo), req.perfil ('admin'|'operador'), req.superAdmin
// Super-admin pode operar em outro sítio enviando o header X-Sitio-Id (override, como o Admin do e-Morador).
const auth = async (req, res, next) => {
    try {
        const token = extractTokenFromRequest(req);
        if (!token) {
            return res.status(401).send({ message: 'Token necessário' });
        }
        const verify = jwt.verify(token, JWT_SECRET);

        req.token = token;
        req.idusuario = verify.id || null;
        req.emailUsuario = verify.email || '';
        req.sitio_id = verify.sitio_id || null;
        req.perfil = verify.perfil || '';
        req.superAdmin = verify.super_admin === true;

        const override = parseInt(req.header('X-Sitio-Id'), 10);
        if (req.superAdmin && override > 0) {
            req.sitio_id = override;
            req.perfil = 'admin';
        }
        return next();
    } catch (err) {
        return res.status(401).send({ message: 'Token inválido', detail: err.message });
    }
};

// Rotas só do administrador do sítio (ou super-admin)
const requireAdmin = (req, res, next) => {
    if (req.superAdmin || req.perfil === 'admin') return next();
    return res.status(403).send({ message: 'Acesso restrito ao administrador.' });
};

const signToken = (payload, expiresIn = '12h') => jwt.sign(payload, JWT_SECRET, { expiresIn });

module.exports = auth;
module.exports.requireAdmin = requireAdmin;
module.exports.signToken = signToken;
