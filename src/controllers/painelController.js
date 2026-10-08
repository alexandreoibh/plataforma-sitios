const bcrypt = require('bcryptjs');
const { QueryTypes } = require('sequelize');
const postgres = require('../database/postgres');
const membros = require('../services/membros');

const S = postgres.SCHEMA;
const sel = (sql, replacements) => postgres.query(sql, { replacements, type: QueryTypes.SELECT });

// Contexto do painel, "Meus dados" e "Usuários" do sítio do token
// (portado de admin/_bootstrap.php, perfil.php e usuarios.php)
class PainelController {
    // GET /api/painel/contexto → quem sou, sítio ativo (identidade), meu perfil nele e nº de pedidos pendentes (badge do menu)
    async contexto(req, res) {
        try {
            // Uma consulta só (usuário + sítio + pendentes)
            const [r] = await sel(
                `SELECT u.id AS u_id, u.nome AS u_nome, u.email AS u_email, u.telefone AS u_telefone, u.super_admin AS u_super_admin,
                        u.ultimo_acesso AS u_ultimo_acesso,
                        s.id, s.slug, s.nome, s.slogan, s.telefone, s.whatsapp, s.email_contato, s.endereco, s.maps_query,
                        s.instagram, s.facebook, s.dominios, s.min_hospedes, s.max_hospedes, s.status,
                        (SELECT count(*)::int FROM ${S}.tb_reservas x WHERE x.sitio_id = s.id AND x.status = 'pendente') AS pendentes
                   FROM ${S}.tb_sitios s, ${S}.tb_usuarios u WHERE s.id = :s AND u.id = :u`,
                { s: req.sitio_id, u: req.idusuario });
            const usuario = {};
            const sitio = {};
            Object.entries(r).forEach(([k, v]) => {
                if (k.startsWith('u_')) usuario[k.slice(2)] = v;
                else if (k !== 'pendentes') sitio[k] = v;
            });
            const n = r.pendentes;
            return res.status(200).json({ usuario, sitio, perfil: req.perfil, pendentes: n });
        } catch (error) {
            return this._erro(res, error, 'contexto');
        }
    }

    // PUT /api/painel/perfil — { nome, email, telefone? } (dados da própria pessoa, valem na plataforma toda)
    async salvarPerfil(req, res) {
        try {
            const nome = String(req.body.nome).trim().slice(0, 100);
            const email = String(req.body.email).trim().toLowerCase();
            const telefone = String(req.body.telefone || '').trim().slice(0, 30) || null;
            const [dup] = await sel(`SELECT 1 AS x FROM ${S}.tb_usuarios WHERE lower(email) = :email AND id <> :u`, { email, u: req.idusuario });
            if (dup) return res.status(409).json({ message: 'Este e-mail já é usado por outro usuário.', errors: [{ param: 'email', msg: 'E-mail já cadastrado.' }] });
            await postgres.query(`UPDATE ${S}.tb_usuarios SET nome = :nome, email = :email, telefone = :telefone WHERE id = :u`,
                { replacements: { nome, email, telefone, u: req.idusuario }, type: QueryTypes.UPDATE });
            return res.status(200).json({ message: 'Seus dados foram atualizados.' });
        } catch (error) {
            return this._erro(res, error, 'perfil');
        }
    }

    // PUT /api/painel/perfil/senha — { atual, nova }
    async trocarSenha(req, res) {
        try {
            const [u] = await sel(`SELECT senha_hash FROM ${S}.tb_usuarios WHERE id = :u`, { u: req.idusuario });
            if (!u || !bcrypt.compareSync(String(req.body.atual), u.senha_hash)) {
                return res.status(422).json({ message: 'Senha atual incorreta.', errors: [{ param: 'atual', msg: 'Senha atual incorreta.' }] });
            }
            await postgres.query(`UPDATE ${S}.tb_usuarios SET senha_hash = :h WHERE id = :u`,
                { replacements: { h: bcrypt.hashSync(String(req.body.nova), 10), u: req.idusuario }, type: QueryTypes.UPDATE });
            return res.status(200).json({ message: 'Senha alterada.' });
        } catch (error) {
            return this._erro(res, error, 'senha');
        }
    }

    // ---- Usuários do sítio (só admin; regras em services/membros.js) ----

    async listarUsuarios(req, res) {
        try {
            return res.status(200).json(await membros.listar(req.sitio_id));
        } catch (error) {
            return this._erro(res, error, 'listarUsuarios');
        }
    }

    async adicionarUsuario(req, res) {
        return this._responder(res, 'adicionarUsuario', () => membros.adicionar(req.sitio_id, req.body));
    }

    async alterarUsuario(req, res) {
        const dados = {};
        ['perfil', 'ativo', 'nome', 'email'].forEach((k) => { if (req.body[k] !== undefined) dados[k] = req.body[k]; });
        return this._responder(res, 'alterarUsuario', () => membros.alterar(req.sitio_id, Number(req.params.usuarioId), dados, { euId: req.idusuario }));
    }

    async removerUsuario(req, res) {
        return this._responder(res, 'removerUsuario', () => membros.remover(req.sitio_id, Number(req.params.usuarioId), { euId: req.idusuario }));
    }

    async redefinirSenhaUsuario(req, res) {
        return this._responder(res, 'redefinirSenha', () => membros.redefinirSenha(req.sitio_id, Number(req.params.usuarioId)));
    }

    async _responder(res, acao, fn) {
        try {
            const r = await fn();
            return res.status(r.status).json(r.json);
        } catch (error) {
            return this._erro(res, error, acao);
        }
    }

    _erro(res, error, acao) {
        console.error(`[painel.${acao}]`, error.message);
        return res.status(500).json({ message: 'Erro ao processar a solicitação.' });
    }
}

module.exports = PainelController;
