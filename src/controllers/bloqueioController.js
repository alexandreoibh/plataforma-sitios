const { QueryTypes } = require('sequelize');
const postgres = require('../database/postgres');
const { hojeBR } = require('../helpers/datas');
const { resolverEspacos, responderErroEspaco } = require('../helpers/espacos');

const S = postgres.SCHEMA;
const sel = (sql, replacements, transaction) => postgres.query(sql, { replacements, type: QueryTypes.SELECT, transaction });
const COLUNAS = `b.id, b.espaco_id, (SELECT e.nome FROM ${S}.tb_espacos e WHERE e.id = b.espaco_id) AS espaco_nome,
    b.data_inicio::text AS data_inicio, b.data_fim::text AS data_fim, b.motivo, b.criado_em`;
// Reservas aprovadas/pendentes do MESMO espaço que caem dentro de um bloqueio (mesma regra do aviso do PHP)
const SOBREPOSTAS = `(SELECT count(*)::int FROM ${S}.tb_reservas r
    WHERE r.sitio_id = b.sitio_id AND r.espaco_id = b.espaco_id AND r.status IN ('aprovada', 'pendente')
      AND r.checkin <= b.data_fim AND r.checkout > b.data_inicio)`;

// Bloqueios de datas do sítio do token (portado de admin/bloqueios.php). Cada bloqueio é de um espaço.
class BloqueioController {
    // GET /api/painel/bloqueios?espaco_id=&passados=1 | ?de=&ate= (agenda) → { bloqueios, ativos }
    async listar(req, res) {
        try {
            const hoje = hojeBR();
            const rep = { s: req.sitio_id, hoje };
            const espacoId = /^\d{1,9}$/.test(String(req.query.espaco_id || '')) ? Number(req.query.espaco_id) : null;
            const doEspaco = espacoId ? ' AND b.espaco_id = :e' : '';
            if (espacoId) rep.e = espacoId;
            let where = 'b.data_fim >= :hoje ORDER BY b.data_inicio';
            if (req.query.de && req.query.ate) {
                where = 'b.data_inicio < :ate AND b.data_fim >= :de ORDER BY b.data_inicio';
                Object.assign(rep, { de: req.query.de, ate: req.query.ate });
            } else if (req.query.passados === '1') {
                where = 'b.data_fim < :hoje ORDER BY b.data_inicio DESC';
            }
            const bloqueios = await sel(
                `SELECT ${COLUNAS}, ${SOBREPOSTAS} AS reservas_no_periodo
                   FROM ${S}.tb_bloqueios b WHERE b.sitio_id = :s${doEspaco} AND ${where}`, rep);
            const [{ n }] = await sel(`SELECT count(*)::int AS n FROM ${S}.tb_bloqueios b WHERE b.sitio_id = :s${doEspaco} AND b.data_fim >= :hoje`, rep);
            return res.status(200).json({ bloqueios, ativos: n });
        } catch (error) {
            return this._erro(res, error, 'listar');
        }
    }

    // POST /api/painel/bloqueios — { espaco_ids[], data_inicio, data_fim, motivo? } → um bloqueio por espaço marcado;
    // avisa se já havia reservas nesses espaços e datas. Sem espaco_ids só vale para sítio com um espaço.
    async criar(req, res) {
        try {
            const { data_inicio, data_fim } = req.body;
            if (data_fim < data_inicio) return res.status(422).json({ message: 'Informe um período válido (a data final não pode ser antes da inicial).' });
            const motivo = String(req.body.motivo || '').trim().slice(0, 120) || null;
            const { espacos, erro } = await resolverEspacos(req.sitio_id, req.body.espaco_ids);
            if (erro) return responderErroEspaco(res, erro);
            const ids = espacos.map((e) => e.id);

            const criados = await postgres.transaction(async (transaction) => {
                const out = [];
                for (const e of ids) {
                    const [b] = await sel(
                        `INSERT INTO ${S}.tb_bloqueios (sitio_id, espaco_id, data_inicio, data_fim, motivo) VALUES (:s, :e, :i, :f, :m) RETURNING id`,
                        { s: req.sitio_id, e, i: data_inicio, f: data_fim, m: motivo }, transaction);
                    out.push(b.id);
                }
                return out;
            });
            const [{ n }] = await sel(
                `SELECT count(*)::int AS n FROM ${S}.tb_reservas
                  WHERE sitio_id = :s AND espaco_id IN (:ids) AND status IN ('aprovada', 'pendente') AND checkin <= :f AND checkout > :i`,
                { s: req.sitio_id, ids, i: data_inicio, f: data_fim });
            const quais = espacos.length > 1 ? ` em ${espacos.length} espaços` : '';
            return res.status(201).json({
                id: criados[0],
                ids: criados,
                reservas_no_periodo: n,
                message: `Período bloqueado${quais}.` + (n ? ` Atenção: existem ${n} reserva(s)/pedido(s) nessas datas.` : ''),
            });
        } catch (error) {
            return this._erro(res, error, 'criar');
        }
    }

    // DELETE /api/painel/bloqueios/:id
    async remover(req, res) {
        try {
            const apagados = await sel(`DELETE FROM ${S}.tb_bloqueios WHERE id = :id AND sitio_id = :s RETURNING id`,
                { id: req.params.id, s: req.sitio_id });
            if (!apagados.length) return res.status(404).json({ message: 'Bloqueio não encontrado.' });
            return res.status(200).json({ message: 'Bloqueio removido. As datas voltaram a ficar disponíveis.' });
        } catch (error) {
            return this._erro(res, error, 'remover');
        }
    }

    _erro(res, error, acao) {
        console.error(`[bloqueio.${acao}]`, error.message);
        return res.status(500).json({ message: 'Erro ao processar o bloqueio.' });
    }
}

module.exports = BloqueioController;
