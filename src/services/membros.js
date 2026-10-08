// Vínculo usuário × sítio (tb_membros). Usado pelo cadastro de sítios (super-admin) e pela tela
// Usuários do painel (admin do sítio). Cada função devolve { status, json } para o controller responder.
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { QueryTypes } = require('sequelize');
const postgres = require('../database/postgres');

const S = postgres.SCHEMA;
const sel = (sql, replacements, transaction) => postgres.query(sql, { replacements, type: QueryTypes.SELECT, transaction });
const trava = (sitioId, transaction) => sel('SELECT pg_advisory_xact_lock(:s)', { s: sitioId }, transaction);

// `exclusivo`: a pessoa só está neste sítio e não é super-admin — só então o admin do sítio
// pode mexer no nome/e-mail/senha dela (são dados da plataforma, valem para os outros sítios também).
const COLUNAS = `u.id, u.nome, u.email, u.telefone, u.ultimo_acesso, u.super_admin, m.perfil, m.ativo, m.criado_em,
    (NOT u.super_admin AND NOT EXISTS (SELECT 1 FROM ${S}.tb_membros o WHERE o.usuario_id = u.id AND o.sitio_id <> m.sitio_id)) AS exclusivo`;

async function listar(sitioId) {
    return sel(
        `SELECT ${COLUNAS} FROM ${S}.tb_membros m JOIN ${S}.tb_usuarios u ON u.id = m.usuario_id
          WHERE m.sitio_id = :s ORDER BY m.ativo DESC, u.nome`, { s: sitioId });
}

async function buscar(sitioId, usuarioId, transaction) {
    const [m] = await sel(
        `SELECT ${COLUNAS} FROM ${S}.tb_membros m JOIN ${S}.tb_usuarios u ON u.id = m.usuario_id
          WHERE m.sitio_id = :s AND m.usuario_id = :u`, { s: sitioId, u: usuarioId }, transaction);
    return m || null;
}

// Admins ativos do sítio sem contar `exceto`
async function outrosAdmins(sitioId, exceto, transaction) {
    const [r] = await sel(
        `SELECT count(*)::int AS n FROM ${S}.tb_membros WHERE sitio_id = :s AND perfil = 'admin' AND ativo AND usuario_id <> :u`,
        { s: sitioId, u: exceto }, transaction);
    return r.n;
}

// E-mail já cadastrado: só cria o vínculo. E-mail novo: cria o usuário (nome e senha obrigatórios) e o vínculo.
async function adicionar(sitioId, { email, perfil, nome, senha }) {
    email = String(email).trim().toLowerCase();
    return postgres.transaction(async (transaction) => {
        let [u] = await sel(`SELECT id FROM ${S}.tb_usuarios WHERE lower(email) = :email`, { email }, transaction);
        let criado = false;
        if (!u) {
            nome = String(nome || '').trim();
            senha = String(senha || '');
            const errors = [];
            if (nome.length < 2) errors.push({ param: 'nome', msg: 'Usuário novo: informe o nome.' });
            if (senha.length < 8) errors.push({ param: 'senha', msg: 'Usuário novo: senha com pelo menos 8 caracteres.' });
            if (errors.length) return { status: 422, json: { message: 'Este e-mail ainda não tem cadastro: informe nome e senha.', errors } };
            [u] = await sel(`INSERT INTO ${S}.tb_usuarios (nome, email, senha_hash) VALUES (:nome, :email, :hash) RETURNING id`,
                { nome, email, hash: bcrypt.hashSync(senha, 10) }, transaction);
            criado = true;
        } else {
            const [m] = await sel(`SELECT 1 AS x FROM ${S}.tb_membros WHERE usuario_id = :u AND sitio_id = :s`, { u: u.id, s: sitioId }, transaction);
            if (m) return { status: 409, json: { message: 'Este usuário já está vinculado ao sítio.', errors: [{ param: 'email', msg: 'Já vinculado a este sítio.' }] } };
        }
        await postgres.query(`INSERT INTO ${S}.tb_membros (usuario_id, sitio_id, perfil) VALUES (:u, :s, :perfil)`,
            { replacements: { u: u.id, s: sitioId, perfil }, type: QueryTypes.INSERT, transaction });
        return { status: 201, json: { usuario_id: u.id, perfil, usuario_criado: criado } };
    });
}

/**
 * Altera o vínculo e, se a pessoa for exclusiva do sítio, os dados dela.
 * dados: { perfil?, ativo?, nome?, email? }; opcoes.euId = quem está editando (não pode se rebaixar/desativar).
 */
async function alterar(sitioId, usuarioId, dados, opcoes = {}) {
    return postgres.transaction(async (transaction) => {
        await trava(sitioId, transaction);
        const m = await buscar(sitioId, usuarioId, transaction);
        if (!m) return { status: 404, json: { message: 'Usuário não encontrado neste sítio.' } };

        const perfil = dados.perfil || m.perfil;
        const ativo = dados.ativo === undefined ? m.ativo : Boolean(dados.ativo);
        if (opcoes.euId && Number(opcoes.euId) === Number(usuarioId) && (!ativo || perfil !== 'admin')) {
            return { status: 409, json: { message: 'Você não pode desativar nem tirar o perfil de administrador da sua própria conta.' } };
        }
        if (m.perfil === 'admin' && m.ativo && (perfil !== 'admin' || !ativo) && (await outrosAdmins(sitioId, usuarioId, transaction)) === 0) {
            return { status: 409, json: { message: 'O sítio precisa de pelo menos um administrador ativo.' } };
        }

        const mudaPessoa = dados.nome !== undefined || dados.email !== undefined;
        if (mudaPessoa) {
            if (!m.exclusivo) {
                return { status: 403, json: { message: 'Esta pessoa também acessa outros sítios: o nome e o e-mail só podem ser alterados por ela (Meus dados).' } };
            }
            const nome = dados.nome !== undefined ? String(dados.nome).trim() : m.nome;
            const email = dados.email !== undefined ? String(dados.email).trim().toLowerCase() : m.email;
            const [dup] = await sel(`SELECT 1 AS x FROM ${S}.tb_usuarios WHERE lower(email) = :email AND id <> :u`, { email, u: usuarioId }, transaction);
            if (dup) return { status: 409, json: { message: 'Já existe um usuário com este e-mail.', errors: [{ param: 'email', msg: 'E-mail já cadastrado.' }] } };
            await postgres.query(`UPDATE ${S}.tb_usuarios SET nome = :nome, email = :email WHERE id = :u`,
                { replacements: { nome, email, u: usuarioId }, type: QueryTypes.UPDATE, transaction });
        }
        await postgres.query(`UPDATE ${S}.tb_membros SET perfil = :perfil, ativo = :ativo WHERE usuario_id = :u AND sitio_id = :s`,
            { replacements: { perfil, ativo, u: usuarioId, s: sitioId }, type: QueryTypes.UPDATE, transaction });
        return { status: 200, json: { message: 'Usuário atualizado.', usuario: await buscar(sitioId, usuarioId, transaction) } };
    });
}

// Remove só o vínculo; o usuário continua existindo (pode estar em outros sítios)
async function remover(sitioId, usuarioId, opcoes = {}) {
    return postgres.transaction(async (transaction) => {
        await trava(sitioId, transaction);
        const m = await buscar(sitioId, usuarioId, transaction);
        if (!m) return { status: 404, json: { message: 'Vínculo não encontrado.' } };
        if (opcoes.euId && Number(opcoes.euId) === Number(usuarioId)) {
            return { status: 409, json: { message: 'Você não pode remover o seu próprio acesso.' } };
        }
        if (m.perfil === 'admin' && m.ativo && (await outrosAdmins(sitioId, usuarioId, transaction)) === 0) {
            return { status: 409, json: { message: 'Não dá para remover o último administrador do sítio.' } };
        }
        await postgres.query(`DELETE FROM ${S}.tb_membros WHERE usuario_id = :u AND sitio_id = :s`,
            { replacements: { u: usuarioId, s: sitioId }, type: QueryTypes.DELETE, transaction });
        return { status: 200, json: { message: 'Usuário desvinculado do sítio (o cadastro dele continua na plataforma).' } };
    });
}

// Senha aleatória legível (sem 0/O, 1/l) para o admin repassar — só para quem é exclusivo do sítio
async function redefinirSenha(sitioId, usuarioId) {
    const m = await buscar(sitioId, usuarioId);
    if (!m) return { status: 404, json: { message: 'Usuário não encontrado neste sítio.' } };
    if (!m.exclusivo) {
        return { status: 403, json: { message: 'Esta pessoa também acessa outros sítios: ela mesma deve trocar a senha (Esqueci minha senha).' } };
    }
    const chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const senha = Array.from({ length: 10 }, () => chars[crypto.randomInt(chars.length)]).join('');
    await postgres.query(`UPDATE ${S}.tb_usuarios SET senha_hash = :h WHERE id = :u`,
        { replacements: { h: bcrypt.hashSync(senha, 10), u: usuarioId }, type: QueryTypes.UPDATE });
    return { status: 200, json: { message: `Nova senha de ${m.nome}: ${senha} (repasse e peça para trocar em Meus dados).`, senha } };
}

module.exports = { listar, buscar, adicionar, alterar, remover, redefinirSenha };
