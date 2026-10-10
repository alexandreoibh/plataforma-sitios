const { QueryTypes } = require('sequelize');
const postgres = require('../database/postgres');
const { TIPOS, espacosDoSitio } = require('../helpers/espacos');

const S = postgres.SCHEMA;
const sel = (sql, replacements, transaction) => postgres.query(sql, { replacements, type: QueryTypes.SELECT, transaction });

// Campos editáveis de um espaço (vazio vira NULL nos opcionais)
const CAMPOS = ['slug', 'nome', 'tipo', 'descricao_curta', 'endereco', 'maps_query', 'min_hospedes', 'max_hospedes', 'min_noites_padrao', 'ativo', 'ordem'];

// Espaços alugáveis do sítio do token (sítio, chalés...). Não há exclusão: espaço com histórico é desativado.
class EspacoController {
    // GET /api/painel/espacos → todos, inclusive inativos, com o nº de reservas futuras de cada um
    async listar(req, res) {
        try {
            const espacos = await sel(
                `SELECT e.id, e.slug, e.nome, e.tipo, e.descricao_curta, e.endereco, e.maps_query, e.min_hospedes, e.max_hospedes,
                        e.min_noites_padrao, e.ativo, e.ordem,
                        (SELECT count(*)::int FROM ${S}.tb_reservas r
                          WHERE r.espaco_id = e.id AND r.status IN ('pendente', 'aprovada') AND r.checkout >= current_date) AS reservas_futuras
                   FROM ${S}.tb_espacos e WHERE e.sitio_id = :s ORDER BY e.ordem, e.id`, { s: req.sitio_id });
            return res.status(200).json(espacos);
        } catch (error) {
            return this._erro(res, error, 'listar');
        }
    }

    // POST /api/painel/espacos
    async criar(req, res) {
        try {
            const d = this._dados(req.body);
            if (d.erro) return res.status(422).json({ message: d.erro });
            const resultado = await postgres.transaction(async (transaction) => {
                await sel('SELECT pg_advisory_xact_lock(:s)', { s: req.sitio_id }, transaction);
                if (await this._slugUsado(req.sitio_id, d.slug, null, transaction)) return this._slugDuplicado();
                const [e] = await sel(
                    `INSERT INTO ${S}.tb_espacos (sitio_id, ${CAMPOS.join(', ')})
                     VALUES (:s, ${CAMPOS.map((c) => ':' + c).join(', ')}) RETURNING id`, { s: req.sitio_id, ...d }, transaction);
                return { status: 201, json: { id: e.id, message: `Espaço "${d.nome}" criado.` } };
            });
            return res.status(resultado.status).json(resultado.json);
        } catch (error) {
            return this._erro(res, error, 'criar');
        }
    }

    // PUT /api/painel/espacos/:id — não deixa desativar o último espaço ativo
    async alterar(req, res) {
        try {
            const d = this._dados(req.body);
            if (d.erro) return res.status(422).json({ message: d.erro });
            const id = Number(req.params.id);
            const resultado = await postgres.transaction(async (transaction) => {
                await sel('SELECT pg_advisory_xact_lock(:s)', { s: req.sitio_id }, transaction);
                const [atual] = await sel(`SELECT id, ativo FROM ${S}.tb_espacos WHERE id = :id AND sitio_id = :s FOR UPDATE`,
                    { id, s: req.sitio_id }, transaction);
                if (!atual) return { status: 404, json: { message: 'Espaço não encontrado.' } };
                if (await this._slugUsado(req.sitio_id, d.slug, id, transaction)) return this._slugDuplicado();
                if (atual.ativo && !d.ativo) {
                    const ativos = await espacosDoSitio(req.sitio_id, {}, transaction);
                    if (ativos.length <= 1) return { status: 409, json: { message: 'O sítio precisa de ao menos um espaço ativo.' } };
                }
                await postgres.query(
                    `UPDATE ${S}.tb_espacos SET ${CAMPOS.map((c) => `${c} = :${c}`).join(', ')} WHERE id = :id AND sitio_id = :s`,
                    { replacements: { ...d, id, s: req.sitio_id }, type: QueryTypes.UPDATE, transaction });
                return { status: 200, json: { message: `Espaço "${d.nome}" atualizado.` } };
            });
            return res.status(resultado.status).json(resultado.json);
        } catch (error) {
            return this._erro(res, error, 'alterar');
        }
    }

    _dados(b) {
        const txt = (v, max) => String(v === undefined || v === null ? '' : v).trim().slice(0, max);
        const d = {
            slug: txt(b.slug, 60).toLowerCase(),
            nome: txt(b.nome, 120),
            tipo: TIPOS.includes(b.tipo) ? b.tipo : 'outro',
            descricao_curta: txt(b.descricao_curta, 255) || null,
            endereco: txt(b.endereco, 200) || null,
            maps_query: txt(b.maps_query, 200) || null,
            min_hospedes: parseInt(b.min_hospedes, 10),
            max_hospedes: parseInt(b.max_hospedes, 10),
            min_noites_padrao: txt(b.min_noites_padrao, 3) === '' ? null : parseInt(b.min_noites_padrao, 10),
            ativo: !(b.ativo === false || b.ativo === 'false' || b.ativo === '0' || b.ativo === 0),
            ordem: parseInt(b.ordem, 10) || 0,
        };
        if ([...d.nome].length < 2) return { erro: 'Informe o nome do espaço.' };
        if (!/^[a-z0-9-]{2,60}$/.test(d.slug)) return { erro: 'Identificador (slug): de 2 a 60 letras minúsculas, números ou hífen. Ex.: chale-1' };
        if (!(d.min_hospedes >= 1 && d.min_hospedes <= 500) || !(d.max_hospedes >= d.min_hospedes && d.max_hospedes <= 500)) {
            return { erro: 'Hóspedes: o mínimo deve ser pelo menos 1 e o máximo não pode ser menor que o mínimo.' };
        }
        if (d.min_noites_padrao !== null && !(d.min_noites_padrao >= 1 && d.min_noites_padrao <= 30)) return { erro: 'Mínimo de noites: 1 a 30 (ou vazio para usar o padrão do sítio).' };
        if (d.ordem < -999 || d.ordem > 999) d.ordem = 0;
        return d;
    }

    async _slugUsado(sitioId, slug, ignorarId, transaction) {
        const [r] = await sel(`SELECT 1 AS x FROM ${S}.tb_espacos WHERE sitio_id = :s AND slug = :slug${ignorarId ? ' AND id <> :id' : ''}`,
            { s: sitioId, slug, id: ignorarId }, transaction);
        return Boolean(r);
    }

    _slugDuplicado() {
        return { status: 409, json: { message: 'Já existe um espaço com esse identificador (slug) neste sítio.' } };
    }

    _erro(res, error, acao) {
        console.error(`[espaco.${acao}]`, error.message);
        return res.status(500).json({ message: 'Erro ao processar o espaço.' });
    }
}

module.exports = EspacoController;
