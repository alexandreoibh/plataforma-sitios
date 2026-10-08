const jwt = require('jsonwebtoken');

// Em produção (Vercel) o segredo é obrigatório e forte: com o padrão de dev qualquer um forjaria tokens.
const IS_PROD = Boolean(process.env.VERCEL) || process.env.NODE_ENV === 'production';
const RAW_SECRET = process.env.JWT_SECRET || '';
const SECRET_OK = RAW_SECRET.length >= 32;
const JWT_SECRET = SECRET_OK ? RAW_SECRET : (IS_PROD ? null : 'dev_jwt_secret_change_me');
if (!JWT_SECRET) {
    console.error('[auth] JWT_SECRET ausente ou curto (mín. 32 caracteres): login e rotas protegidas ficam bloqueados.');
}
const secretMissing = (res) => res.status(500).send({ message: 'Configuração ausente no servidor (JWT_SECRET).' });

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
    if (!JWT_SECRET) return secretMissing(res);
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

// Rotas do painel de um sítio: exige sítio ativo no token e confere o vínculo NO BANCO a cada chamada
// (acesso removido/desativado vale na hora, sem esperar o token expirar). O perfil vem do banco.
const requireSitio = async (req, res, next) => {
    if (!req.sitio_id) return res.status(400).send({ message: 'Escolha um sítio para continuar.', code: 'SITIO_NAO_ESCOLHIDO' });
    try {
        // require tardio: helpers/auth é carregado antes da conexão em alguns scripts
        const postgres = require('../database/postgres');
        const { QueryTypes } = require('sequelize');
        const S = postgres.SCHEMA;
        const [sitio] = await postgres.query(`SELECT id, status FROM ${S}.tb_sitios WHERE id = :s`,
            { replacements: { s: req.sitio_id }, type: QueryTypes.SELECT });
        if (!sitio) return res.status(404).send({ message: 'Sítio não encontrado.' });
        if (req.superAdmin) {
            req.perfil = 'admin';
            return next();
        }
        const [m] = await postgres.query(
            `SELECT m.perfil FROM ${S}.tb_membros m JOIN ${S}.tb_usuarios u ON u.id = m.usuario_id
              WHERE m.usuario_id = :u AND m.sitio_id = :s AND m.ativo AND u.ativo`,
            { replacements: { u: req.idusuario, s: req.sitio_id }, type: QueryTypes.SELECT });
        if (!m) return res.status(403).send({ message: 'Você não tem acesso a este sítio.', code: 'SEM_ACESSO' });
        if (sitio.status !== 'ativo') return res.status(403).send({ message: 'Este sítio está suspenso. Fale com o suporte da plataforma.', code: 'SITIO_SUSPENSO' });
        req.perfil = m.perfil;
        return next();
    } catch (error) {
        console.error('[auth.requireSitio]', error.message);
        return res.status(500).send({ message: 'Erro ao verificar o acesso ao sítio.' });
    }
};

// Rotas só do administrador do sítio (ou super-admin)
const requireAdmin = (req, res, next) => {
    if (req.superAdmin || req.perfil === 'admin') return next();
    return res.status(403).send({ message: 'Acesso restrito ao administrador.' });
};

// Rotas da plataforma (cadastro de sítios etc.): só o super-admin
const requireSuperAdmin = (req, res, next) => {
    if (req.superAdmin) return next();
    return res.status(403).send({ message: 'Acesso restrito ao super-admin.' });
};

const signToken = (payload, expiresIn = '12h') => {
    if (!JWT_SECRET) throw Object.assign(new Error('Configuração ausente no servidor (JWT_SECRET).'), { status: 500 });
    return jwt.sign(payload, JWT_SECRET, { expiresIn });
};

module.exports = auth;
module.exports.requireSitio = requireSitio;
module.exports.requireAdmin = requireAdmin;
module.exports.requireSuperAdmin = requireSuperAdmin;
module.exports.signToken = signToken;
