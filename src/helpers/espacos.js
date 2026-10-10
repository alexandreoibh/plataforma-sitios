// Espaços alugáveis do sítio (tb_espacos): o sítio em si, chalés, casas... Independentes entre si.
// Compatibilidade: quem não informa o espaço (sites e painel antigos) usa o único espaço ativo do sítio;
// com mais de um ativo, o espaço passa a ser obrigatório.
const { QueryTypes } = require('sequelize');
const postgres = require('../database/postgres');

const S = postgres.SCHEMA;
const sel = (sql, replacements, transaction) => postgres.query(sql, { replacements, type: QueryTypes.SELECT, transaction });

const TIPOS = ['sitio', 'chale', 'casa', 'suite', 'outro'];
const COLUNAS = `id, slug, nome, tipo, descricao_curta, endereco, maps_query, min_hospedes, max_hospedes,
    min_noites_padrao, ativo, ordem`;
// O que o site público enxerga (sem id interno nem inativos)
const COLUNAS_PUBLICAS = 'slug, nome, tipo, descricao_curta, endereco, maps_query, min_hospedes, max_hospedes';

const ESPACO_OBRIGATORIO = { status: 422, codigo: 'ESPACO_OBRIGATORIO', message: 'Escolha o espaço da reserva.' };
const ESPACO_INVALIDO = { status: 422, codigo: 'ESPACO_INVALIDO', message: 'Espaço não encontrado.' };

async function espacosDoSitio(sitioId, { soAtivos = true, publico = false } = {}, transaction) {
    return sel(
        `SELECT ${publico ? COLUNAS_PUBLICAS : COLUNAS} FROM ${S}.tb_espacos
          WHERE sitio_id = :s${soAtivos ? ' AND ativo' : ''} ORDER BY ordem, id`,
        { s: sitioId }, transaction
    );
}

/**
 * Espaço de uma operação, por id (painel) ou slug (site). Sem valor: o único espaço ativo do sítio.
 * Devolve { espaco } ou { erro } (ESPACO_OBRIGATORIO / ESPACO_INVALIDO). Só aceita espaço ativo, salvo `inativos`.
 */
async function resolverEspaco(sitioId, valor, { inativos = false } = {}, transaction) {
    const v = valor === undefined || valor === null ? '' : String(valor).trim();
    if (v === '') {
        const ativos = await espacosDoSitio(sitioId, {}, transaction);
        if (ativos.length === 1) return { espaco: ativos[0] };
        return { erro: ativos.length ? ESPACO_OBRIGATORIO : ESPACO_INVALIDO };
    }
    const porId = /^\d{1,9}$/.test(v);
    if (!porId && !/^[a-z0-9-]{2,60}$/.test(v)) return { erro: ESPACO_INVALIDO };
    const [e] = await sel(
        `SELECT ${COLUNAS} FROM ${S}.tb_espacos WHERE sitio_id = :s AND ${porId ? 'id = :v' : 'slug = :v'}${inativos ? '' : ' AND ativo'}`,
        { s: sitioId, v: porId ? Number(v) : v }, transaction
    );
    return e ? { espaco: e } : { erro: ESPACO_INVALIDO };
}

/** Vários espaços do sítio por id (bloqueios e regras marcam um ou mais). Ignora ids repetidos; erro se algum não existir. */
async function resolverEspacos(sitioId, ids, transaction) {
    const lista = [...new Set((Array.isArray(ids) ? ids : [ids]).filter((x) => x !== undefined && x !== null && x !== '').map(Number))];
    if (!lista.length) {
        // Sítio com um espaço só: não precisa marcar nada
        const r = await resolverEspaco(sitioId, null, {}, transaction);
        return r.erro ? { erro: { ...r.erro, message: 'Marque ao menos um espaço.' } } : { espacos: [r.espaco] };
    }
    if (lista.some((n) => !Number.isInteger(n) || n < 1)) return { erro: ESPACO_INVALIDO };
    const achados = await sel(`SELECT ${COLUNAS} FROM ${S}.tb_espacos WHERE sitio_id = :s AND id IN (:ids)`,
        { s: sitioId, ids: lista }, transaction);
    return achados.length === lista.length ? { espacos: achados } : { erro: ESPACO_INVALIDO };
}

/**
 * Id do espaço principal do sítio (o de menor ordem/id); cria o espaço "sitio" se o sítio ainda não tiver nenhum.
 * Usado ao cadastrar sítio e nos scripts de cópia (todo registro precisa de espaco_id).
 */
async function garantirEspacoPrincipal(sitioId, transaction) {
    const [e] = await sel(`SELECT id FROM ${S}.tb_espacos WHERE sitio_id = :s ORDER BY ordem, id LIMIT 1`, { s: sitioId }, transaction);
    if (e) return e.id;
    const [novo] = await sel(
        `INSERT INTO ${S}.tb_espacos (sitio_id, slug, nome, tipo, min_hospedes, max_hospedes, ordem)
         SELECT id, 'sitio', nome, 'sitio', min_hospedes, GREATEST(max_hospedes, min_hospedes), 0 FROM ${S}.tb_sitios WHERE id = :s
         RETURNING id`, { s: sitioId }, transaction);
    return novo.id;
}

/** Responde um erro de resolverEspaco no formato das outras validações da API. */
function responderErroEspaco(res, erro) {
    return res.status(erro.status).json({ message: erro.message, codigo: erro.codigo, erros: [erro.message] });
}

module.exports = { TIPOS, espacosDoSitio, resolverEspaco, resolverEspacos, garantirEspacoPrincipal, responderErroEspaco };
