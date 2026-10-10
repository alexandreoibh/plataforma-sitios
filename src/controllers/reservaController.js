const { QueryTypes } = require('sequelize');
const postgres = require('../database/postgres');
const { periodHasConflict, marcarConflitos } = require('../helpers/regras');
const { resolverEspaco, responderErroEspaco } = require('../helpers/espacos');
const { hojeBR } = require('../helpers/datas');

const S = postgres.SCHEMA;
const sel = (sql, replacements, transaction) => postgres.query(sql, { replacements, type: QueryTypes.SELECT, transaction });

// Mesmas colunas do MySQL do PHP (datas como texto 'YYYY-MM-DD'), para o painel reaproveitar os helpers dele,
// + o espaço da reserva (subconsultas: as consultas usam tb_reservas sem alias)
const ESPACO = (campo) => `(SELECT e.${campo} FROM ${S}.tb_espacos e WHERE e.id = tb_reservas.espaco_id)`;
const COLUNAS = `id, espaco_id, ${ESPACO('nome')} AS espaco_nome, ${ESPACO('slug')} AS espaco_slug, ${ESPACO('tipo')} AS espaco_tipo,
    nome, email, telefone, checkin::text AS checkin, checkout::text AS checkout, hospedes, mensagem, status,
    observacao_admin, pagamento_forma, pagamento_condicao, pagamento_parcelas, valor_total, entrada_paga,
    entrada_paga_em::text AS entrada_paga_em, saldo_pago, saldo_pago_em::text AS saldo_pago_em, aprovada_em, criado_em, atualizado_em`;
const STATUS = ['pendente', 'aprovada', 'recusada', 'cancelada'];
// Transições permitidas (como no admin/reservas.php)
const TRANSICOES = { aprovar: ['pendente', 'aprovada'], recusar: ['pendente', 'recusada'], cancelar: ['aprovada', 'cancelada'] };
const MSG_ACAO = {
    aprovar: 'Reserva aprovada. As datas já aparecem como ocupadas no site',
    recusar: 'Pedido recusado',
    cancelar: 'Reserva cancelada. As datas foram liberadas',
};

// Reservas do sítio do token (painel). Regras portadas de admin/reservas.php, index.php e agenda.php.
class ReservaController {
    // GET /api/painel/reservas?espaco_id=&status=pendente,aprovada&q=&de=&ate=&checkout_apos=&ordem=checkin|criado&conflito=1&contagem=1
    async listar(req, res) {
        try {
            const where = ['sitio_id = :s'];
            const rep = { s: req.sitio_id };
            // Filtro por espaço (a contagem das abas segue o mesmo filtro)
            const espacoId = /^\d{1,9}$/.test(String(req.query.espaco_id || '')) ? Number(req.query.espaco_id) : null;
            if (espacoId) { where.push('espaco_id = :e'); rep.e = espacoId; }
            const status = String(req.query.status || '').split(',').filter((x) => STATUS.includes(x));
            if (status.length) { where.push('status IN (:status)'); rep.status = status; }

            const q = String(req.query.q || '').trim();
            if (q) {
                // Nome, e-mail, telefone ou nº do pedido (#7 ou 7)
                const cond = ['nome ILIKE :like', 'email ILIKE :like', 'telefone ILIKE :like'];
                rep.like = `%${q.replace(/[\\%_]/g, (c) => '\\' + c)}%`;
                const digitos = q.replace(/\D/g, '');
                if (digitos && digitos.length <= 9) { cond.push('id = :num'); rep.num = Number(digitos); }
                where.push(`(${cond.join(' OR ')})`);
            }
            // Sobreposição com um período [de, ate) — agenda e "do mês"
            if (req.query.de && req.query.ate) { where.push('checkin < :ate AND checkout > :de'); rep.de = req.query.de; rep.ate = req.query.ate; }
            if (req.query.checkout_apos) { where.push('checkout > :co'); rep.co = req.query.checkout_apos; }

            const ordem = req.query.ordem === 'checkin' ? 'checkin' : req.query.ordem === 'checkin_desc' ? 'checkin DESC' : 'criado_em DESC';
            const reservas = await sel(`SELECT ${COLUNAS} FROM ${S}.tb_reservas WHERE ${where.join(' AND ')} ORDER BY ${ordem}, id`, rep);

            // Marca quem conflita com reserva aprovada ou bloqueio (uma consulta para a lista toda)
            if (req.query.conflito === '1') await marcarConflitos(req.sitio_id, reservas);
            // Total de cada aba (Reservas): só quando pedido, para não pagar uma ida ao banco à toa
            const out = { reservas };
            if (req.query.contagem === '1') out.contagem = await this._contagem(req.sitio_id, espacoId);
            return res.status(200).json(out);
        } catch (error) {
            return this._erro(res, error, 'listar');
        }
    }

    // GET /api/painel/reservas/:id → { reserva, conflito, outros_pendentes }
    async buscar(req, res) {
        try {
            const r = await this._reserva(req.sitio_id, req.params.id);
            if (!r) return res.status(404).json({ message: 'Pedido não encontrado.' });
            // Conflito e pedidos concorrentes: só no mesmo espaço
            const [conflito, outros] = await Promise.all([
                ['pendente', 'aprovada'].includes(r.status) && periodHasConflict(req.sitio_id, r.espaco_id, r.checkin, r.checkout, r.id),
                r.status !== 'pendente' ? [] : sel(
                `SELECT id, nome FROM ${S}.tb_reservas
                  WHERE sitio_id = :s AND espaco_id = :e AND status = 'pendente' AND id <> :id AND checkin < :co AND checkout > :ci ORDER BY id`,
                { s: req.sitio_id, e: r.espaco_id, id: r.id, co: r.checkout, ci: r.checkin }),
            ]);
            return res.status(200).json({ reserva: r, conflito: Boolean(conflito), outros_pendentes: outros });
        } catch (error) {
            return this._erro(res, error, 'buscar');
        }
    }

    // POST /api/painel/reservas/:id/(aprovar|recusar|cancelar) — { observacao?, pagamento (só aprovar) }
    // Aprovação com trava por sítio: duas aprovações simultâneas para as mesmas datas não passam juntas.
    async mudarStatus(req, res) {
        const acao = req.params.acao;
        const [de, para] = TRANSICOES[acao];
        let pagamento = null;
        if (acao === 'aprovar') {
            pagamento = this._pagamento(req.body);
            if (pagamento.erro) return res.status(422).json({ message: 'Não foi possível aprovar: ' + pagamento.erro.charAt(0).toLowerCase() + pagamento.erro.slice(1) });
        }
        const obs = String(req.body.observacao || '').trim() || null;
        try {
            const resultado = await postgres.transaction(async (transaction) => {
                await sel('SELECT pg_advisory_xact_lock(:s)', { s: req.sitio_id }, transaction);
                const r = await this._reserva(req.sitio_id, req.params.id, transaction, true);
                if (!r) return { status: 404, json: { message: 'Pedido não encontrado.' } };
                if (r.status !== de) return { status: 409, json: { message: 'Ação inválida para este pedido.' } };
                if (acao === 'aprovar' && await periodHasConflict(req.sitio_id, r.espaco_id, r.checkin, r.checkout, r.id, transaction)) {
                    return { status: 409, json: { message: 'Não foi possível aprovar: o período conflita com outra reserva aprovada ou com um bloqueio.' } };
                }
                await postgres.query(
                    `UPDATE ${S}.tb_reservas SET status = :para, observacao_admin = COALESCE(:obs, observacao_admin), atualizado_em = now()
                     ${acao === 'aprovar' ? ', aprovada_em = now()' : ''} WHERE id = :id AND sitio_id = :s`,
                    { replacements: { para, obs, id: r.id, s: req.sitio_id }, type: QueryTypes.UPDATE, transaction }
                );
                if (pagamento) await this._salvarPagamento(req.sitio_id, r.id, pagamento, transaction);
                return { status: 200, json: { message: MSG_ACAO[acao], reserva: await this._reserva(req.sitio_id, r.id, transaction) } };
            });
            return res.status(resultado.status).json(resultado.json);
        } catch (error) {
            return this._erro(res, error, acao);
        }
    }

    // PUT /api/painel/reservas/:id/espaco — { espaco_id } troca o espaço de um pedido pendente ou reserva aprovada.
    // Aprovada só muda se o período estiver livre no espaço novo (mesma trava da aprovação).
    async trocarEspaco(req, res) {
        try {
            const resultado = await postgres.transaction(async (transaction) => {
                await sel('SELECT pg_advisory_xact_lock(:s)', { s: req.sitio_id }, transaction);
                const r = await this._reserva(req.sitio_id, req.params.id, transaction, true);
                if (!r) return { status: 404, json: { message: 'Pedido não encontrado.' } };
                if (!['pendente', 'aprovada'].includes(r.status)) return { status: 409, json: { message: 'Só pedidos pendentes ou reservas aprovadas mudam de espaço.' } };
                const { espaco, erro } = await resolverEspaco(req.sitio_id, req.body.espaco_id, {}, transaction);
                if (erro) return { erro };
                if (Number(espaco.id) === Number(r.espaco_id)) return { status: 200, json: { message: 'O pedido já está nesse espaço.', reserva: r } };
                if (r.status === 'aprovada' && await periodHasConflict(req.sitio_id, espaco.id, r.checkin, r.checkout, r.id, transaction)) {
                    return { status: 409, json: { message: `Não foi possível trocar: ${espaco.nome} já está ocupado nesse período.` } };
                }
                await postgres.query(
                    `UPDATE ${S}.tb_reservas SET espaco_id = :e, atualizado_em = now() WHERE id = :id AND sitio_id = :s`,
                    { replacements: { e: espaco.id, id: r.id, s: req.sitio_id }, type: QueryTypes.UPDATE, transaction }
                );
                return { status: 200, json: { message: `Pedido movido para ${espaco.nome}.`, reserva: await this._reserva(req.sitio_id, r.id, transaction) } };
            });
            if (resultado.erro) return responderErroEspaco(res, resultado.erro);
            return res.status(resultado.status).json(resultado.json);
        } catch (error) {
            return this._erro(res, error, 'trocarEspaco');
        }
    }

    // PUT /api/painel/reservas/:id/pagamento — só reserva aprovada
    async atualizarPagamento(req, res) {
        const p = this._pagamento(req.body);
        if (p.erro) return res.status(422).json({ message: p.erro });
        try {
            const r = await this._reserva(req.sitio_id, req.params.id);
            if (!r || r.status !== 'aprovada') return res.status(409).json({ message: 'Ação inválida para este pedido.' });
            await this._salvarPagamento(req.sitio_id, r.id, p);
            return res.status(200).json({ message: 'Pagamento atualizado.', reserva: await this._reserva(req.sitio_id, r.id) });
        } catch (error) {
            return this._erro(res, error, 'pagamento');
        }
    }

    // POST /api/painel/reservas/:id/recebimento — { tipo: entrada|saldo, data? } (financeiro: "marcar como recebido")
    async marcarRecebido(req, res) {
        try {
            const flag = req.body.tipo === 'saldo' ? 'saldo_pago' : 'entrada_paga';
            const data = req.body.data && req.body.data <= hojeBR() ? req.body.data : hojeBR();
            const [, n] = await postgres.query(
                `UPDATE ${S}.tb_reservas SET ${flag} = true, ${flag}_em = :data, atualizado_em = now()
                  WHERE id = :id AND sitio_id = :s AND status = 'aprovada'`,
                { replacements: { data, id: req.params.id, s: req.sitio_id }, type: QueryTypes.UPDATE }
            );
            if (!n) return res.status(409).json({ message: 'Não foi possível marcar: a reserva não está aprovada.' });
            return res.status(200).json({ message: 'Recebimento registrado.', reserva: await this._reserva(req.sitio_id, req.params.id) });
        } catch (error) {
            return this._erro(res, error, 'recebimento');
        }
    }

    // Dados de pagamento (mesmas regras de payment_from_post do PHP); `erro` preenchido se faltar algo
    _pagamento(b) {
        const forma = b.pagamento_forma;
        let cond = b.pagamento_condicao;
        if (forma === 'credito') cond = 'avista'; // no cartão não há condição: o valor é cobrado no cartão
        const p = { erro: null };
        if (!['pix', 'credito', 'debito'].includes(forma) || !['avista', '50_50'].includes(cond)) {
            p.erro = 'Informe a forma de pagamento e a condição.';
            return p;
        }
        let valor = null;
        if (b.valor_total !== undefined && b.valor_total !== null && String(b.valor_total).trim() !== '') {
            valor = Number(b.valor_total);
            if (!Number.isFinite(valor) || valor < 0 || valor > 99999999) return { erro: 'Valor total inválido. Use, por exemplo, 3.000,00.' };
            valor = Math.round(valor * 100) / 100;
        }
        let parcelas = null;
        if (forma === 'credito') {
            parcelas = Number(b.pagamento_parcelas || 3);
            if (!Number.isInteger(parcelas) || parcelas < 1 || parcelas > 12) return { erro: 'Informe o número de parcelas no cartão (2 a 12).' };
        }
        const hoje = hojeBR();
        const dataRecebida = (v) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && v <= hoje ? v : hoje);
        const entrada = Boolean(b.entrada_paga) && b.entrada_paga !== '0';
        const saldo = cond === '50_50' && Boolean(b.saldo_pago) && b.saldo_pago !== '0';
        return {
            erro: null,
            pagamento_forma: forma,
            pagamento_condicao: cond,
            pagamento_parcelas: parcelas,
            valor_total: valor,
            entrada_paga: entrada,
            entrada_paga_em: entrada ? dataRecebida(b.entrada_paga_em) : null,
            saldo_pago: saldo,
            saldo_pago_em: saldo ? dataRecebida(b.saldo_pago_em) : null,
        };
    }

    async _salvarPagamento(sitioId, id, p, transaction) {
        await postgres.query(
            `UPDATE ${S}.tb_reservas SET pagamento_forma = :pagamento_forma, pagamento_condicao = :pagamento_condicao,
                    pagamento_parcelas = :pagamento_parcelas, valor_total = :valor_total, entrada_paga = :entrada_paga,
                    entrada_paga_em = :entrada_paga_em, saldo_pago = :saldo_pago, saldo_pago_em = :saldo_pago_em, atualizado_em = now()
              WHERE id = :id AND sitio_id = :s`,
            { replacements: { ...p, id, s: sitioId }, type: QueryTypes.UPDATE, transaction }
        );
    }

    async _reserva(sitioId, id, transaction, paraAtualizar = false) {
        if (!/^\d{1,9}$/.test(String(id))) return null;
        const [r] = await sel(`SELECT ${COLUNAS} FROM ${S}.tb_reservas WHERE id = :id AND sitio_id = :s${paraAtualizar ? ' FOR UPDATE' : ''}`,
            { id: Number(id), s: sitioId }, transaction);
        return r || null;
    }

    async _contagem(sitioId, espacoId = null) {
        const contagem = { pendente: 0, aprovada: 0, recusada: 0, cancelada: 0 };
        (await sel(`SELECT status, count(*)::int AS n FROM ${S}.tb_reservas
                     WHERE sitio_id = :s${espacoId ? ' AND espaco_id = :e' : ''} GROUP BY status`, { s: sitioId, e: espacoId }))
            .forEach((c) => { contagem[c.status] = c.n; });
        contagem.todas = Object.values(contagem).reduce((a, b) => a + b, 0);
        return contagem;
    }

    _erro(res, error, acao) {
        console.error(`[reserva.${acao}]`, error.message);
        return res.status(500).json({ message: 'Erro ao processar a reserva.' });
    }
}

module.exports = ReservaController;
