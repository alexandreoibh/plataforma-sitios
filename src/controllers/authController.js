const bcrypt = require('bcryptjs');
const { QueryTypes } = require('sequelize');
const postgres = require('../database/postgres');
const { signToken } = require('../helpers/auth');

const S = postgres.SCHEMA;

class AuthController {
    // POST /api/auth/login — { email, senha } → { token, usuario, sitios, sitio }
    // Quem tem um sítio só já recebe o token nesse sítio; com mais de um (ou super-admin) escolhe em POST /api/auth/sitio.
    async login(req, res) {
        try {
            const email = String(req.body.email).trim().toLowerCase();
            const [u] = await postgres.query(
                `SELECT id, nome, email, senha_hash, super_admin, ativo FROM ${S}.tb_usuarios WHERE lower(email) = :email`,
                { replacements: { email }, type: QueryTypes.SELECT }
            );
            if (!u || !u.ativo || !bcrypt.compareSync(String(req.body.senha), u.senha_hash)) {
                await new Promise((r) => setTimeout(r, 1000)); // freia tentativas em sequência
                return res.status(401).json({ message: 'E-mail ou senha incorretos.' });
            }
            const superAdmin = u.super_admin === true;
            const sitios = await this._sitiosDoUsuario(u.id, superAdmin);
            if (!superAdmin && sitios.length === 0) {
                return res.status(403).json({ message: 'Seu usuário não tem acesso a nenhum sítio. Fale com o administrador.' });
            }
            await postgres.query(`UPDATE ${S}.tb_usuarios SET ultimo_acesso = now() WHERE id = :id`,
                { replacements: { id: u.id }, type: QueryTypes.UPDATE });

            const usuario = { id: u.id, nome: u.nome, email: u.email, super_admin: superAdmin };
            const unico = !superAdmin && sitios.length === 1 ? sitios[0] : null;
            return res.status(200).json({ token: this._token(usuario, unico), usuario, sitios, sitio: unico });
        } catch (error) {
            console.error('[auth.login]', error.message);
            return res.status(error.status || 500).json({ message: error.status ? error.message : 'Erro ao entrar.' });
        }
    }

    // POST /api/auth/sitio — { sitio_id } → token novo com o sítio escolhido (auth)
    async escolherSitio(req, res) {
        try {
            const [u] = await postgres.query(`SELECT id, nome, email, super_admin, ativo FROM ${S}.tb_usuarios WHERE id = :id`,
                { replacements: { id: req.idusuario }, type: QueryTypes.SELECT });
            if (!u || !u.ativo) return res.status(401).json({ message: 'Sessão inválida. Entre de novo.' });
            const superAdmin = u.super_admin === true;
            const sitio = (await this._sitiosDoUsuario(u.id, superAdmin)).find((s) => s.id === Number(req.body.sitio_id));
            if (!sitio) return res.status(403).json({ message: 'Você não tem acesso a este sítio.' });
            const usuario = { id: u.id, nome: u.nome, email: u.email, super_admin: superAdmin };
            return res.status(200).json({ token: this._token(usuario, sitio), usuario, sitio });
        } catch (error) {
            console.error('[auth.escolherSitio]', error.message);
            return res.status(500).json({ message: 'Erro ao escolher o sítio.' });
        }
    }

    // Super-admin: todos os sítios (como admin). Demais: vínculos ativos em sítios ativos.
    async _sitiosDoUsuario(usuarioId, superAdmin) {
        if (superAdmin) {
            return postgres.query(`SELECT id, slug, nome, status, 'admin' AS perfil FROM ${S}.tb_sitios ORDER BY nome`, { type: QueryTypes.SELECT });
        }
        return postgres.query(
            `SELECT s.id, s.slug, s.nome, s.status, m.perfil
               FROM ${S}.tb_membros m JOIN ${S}.tb_sitios s ON s.id = m.sitio_id
              WHERE m.usuario_id = :u AND m.ativo AND s.status = 'ativo' ORDER BY s.nome`,
            { replacements: { u: usuarioId }, type: QueryTypes.SELECT }
        );
    }

    _token(usuario, sitio) {
        const payload = { id: usuario.id, email: usuario.email, super_admin: usuario.super_admin };
        if (sitio) Object.assign(payload, { sitio_id: sitio.id, perfil: sitio.perfil });
        return signToken(payload);
    }
}

module.exports = AuthController;
