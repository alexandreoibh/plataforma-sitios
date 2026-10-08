const bcrypt = require('bcryptjs');
const crypto = require('crypto');
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

    // ---- Esqueci minha senha (só servidores PHP, X-Front-Key; o painel envia o e-mail com o link) ----

    // POST /api/auth/senha/esqueci — { email, slug } → { nome, email, token } ou {} (o painel responde sempre neutro)
    // Só gera para quem tem acesso ao sítio do site que pediu; pedido repetido em < 2 min não gera outro (o anterior vale 1h).
    async esqueciSenha(req, res) {
        try {
            const email = String(req.body.email).trim().toLowerCase();
            const [u] = await postgres.query(
                `SELECT u.id, u.nome, u.email, u.super_admin,
                        (u.reset_expira IS NOT NULL AND u.reset_expira - interval '1 hour' > now() - interval '2 minutes') AS recente
                   FROM ${S}.tb_usuarios u WHERE lower(u.email) = :email AND u.ativo`,
                { replacements: { email }, type: QueryTypes.SELECT }
            );
            await new Promise((r) => setTimeout(r, 500)); // mesmo tempo com ou sem usuário
            if (!u || u.recente) return res.status(200).json({});
            const temAcesso = u.super_admin || (await this._sitiosDoUsuario(u.id, false)).some((s) => s.slug === req.body.slug);
            if (!temAcesso) return res.status(200).json({});
            const token = crypto.randomBytes(32).toString('hex');
            await postgres.query(
                `UPDATE ${S}.tb_usuarios SET reset_token_hash = :h, reset_expira = now() + interval '1 hour' WHERE id = :id`,
                { replacements: { h: this._hash(token), id: u.id }, type: QueryTypes.UPDATE }
            );
            // Remetente e endereço do site configurados no sítio: o painel ainda não tem login para buscá-los
            const configs = await postgres.query(
                `SELECT c.chave, c.valor FROM ${S}.tb_configuracoes c JOIN ${S}.tb_sitios s ON s.id = c.sitio_id
                  WHERE s.slug = :slug AND c.chave IN ('email_remetente', 'site_url')`,
                { replacements: { slug: req.body.slug }, type: QueryTypes.SELECT }
            );
            const configuracoes = Object.fromEntries(configs.map((c) => [c.chave, c.valor]));
            return res.status(200).json({ nome: u.nome, email: u.email, token, configuracoes });
        } catch (error) {
            console.error('[auth.esqueciSenha]', error.message);
            return res.status(500).json({ message: 'Erro ao gerar o link.' });
        }
    }

    // POST /api/auth/senha/validar — { token } → { nome, email } ou 404 (vencido, usado ou conta desativada)
    async validarToken(req, res) {
        try {
            const u = await this._donoDoToken(req.body.token);
            if (!u) return res.status(404).json({ message: 'Link inválido ou vencido.' });
            return res.status(200).json({ nome: u.nome, email: u.email });
        } catch (error) {
            console.error('[auth.validarToken]', error.message);
            return res.status(500).json({ message: 'Erro ao validar o link.' });
        }
    }

    // POST /api/auth/senha/redefinir — { token, senha } → troca a senha e invalida o token (link vale uma vez)
    async redefinirSenha(req, res) {
        try {
            const u = await this._donoDoToken(req.body.token);
            if (!u) return res.status(404).json({ message: 'Link inválido ou vencido.' });
            await postgres.query(
                `UPDATE ${S}.tb_usuarios SET senha_hash = :h, reset_token_hash = NULL, reset_expira = NULL WHERE id = :id`,
                { replacements: { h: bcrypt.hashSync(String(req.body.senha), 10), id: u.id }, type: QueryTypes.UPDATE }
            );
            return res.status(200).json({ message: 'Senha alterada. Entre com a nova senha.' });
        } catch (error) {
            console.error('[auth.redefinirSenha]', error.message);
            return res.status(500).json({ message: 'Erro ao alterar a senha.' });
        }
    }

    async _donoDoToken(token) {
        if (!/^[a-f0-9]{64}$/.test(String(token || ''))) return null;
        const [u] = await postgres.query(
            `SELECT id, nome, email FROM ${S}.tb_usuarios WHERE reset_token_hash = :h AND reset_expira > now() AND ativo`,
            { replacements: { h: this._hash(token) }, type: QueryTypes.SELECT }
        );
        return u || null;
    }

    _hash(token) {
        return crypto.createHash('sha256').update(String(token)).digest('hex');
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
