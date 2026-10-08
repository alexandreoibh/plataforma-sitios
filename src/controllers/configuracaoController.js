const dns = require('dns').promises;
const { QueryTypes } = require('sequelize');
const postgres = require('../database/postgres');
const { CONFIG_PADRAO } = require('../helpers/regras');

const S = postgres.SCHEMA;
const sel = (sql, replacements, transaction) => postgres.query(sql, { replacements, type: QueryTypes.SELECT, transaction });

// Configurações e regras de mínimo de noites do sítio do token (portado de admin/configuracoes.php)
class ConfiguracaoController {
    // GET /api/painel/configuracoes → { chave: valor } com os padrões do PHP para o que não foi salvo
    async listar(req, res) {
        try {
            return res.status(200).json(await this._todas(req.sitio_id));
        } catch (error) {
            return this._erro(res, error, 'listar');
        }
    }

    // PUT /api/painel/configuracoes/gerais — { min_noites_padrao 1..30, meses_antecedencia 1..24 }
    async salvarGerais(req, res) {
        try {
            await this._gravar(req.sitio_id, {
                min_noites_padrao: String(Number(req.body.min_noites_padrao)),
                meses_antecedencia: String(Number(req.body.meses_antecedencia)),
            });
            return res.status(200).json({ message: 'Configurações salvas.', configuracoes: await this._todas(req.sitio_id) });
        } catch (error) {
            return this._erro(res, error, 'gerais');
        }
    }

    // PUT /api/painel/configuracoes/email — { email_remetente, email_notificacao, site_url? }
    // A mail() da hospedagem só aceita remetente de domínio que existe: confere o DNS antes de salvar.
    async salvarEmail(req, res) {
        try {
            const remetente = String(req.body.email_remetente).trim().toLowerCase();
            const dominio = remetente.split('@')[1];
            if (!(await this._dominioExiste(dominio))) {
                return res.status(422).json({
                    message: `O domínio do remetente (${dominio}) não existe. Use um e-mail de um domínio hospedado no servidor de e-mail do site.`,
                    errors: [{ param: 'email_remetente', msg: 'Domínio inexistente.' }],
                });
            }
            await this._gravar(req.sitio_id, {
                email_remetente: remetente,
                email_notificacao: String(req.body.email_notificacao).trim().toLowerCase(),
                site_url: String(req.body.site_url || '').trim().replace(/\/+$/, ''),
            });
            return res.status(200).json({ message: 'Configurações de e-mail salvas.', configuracoes: await this._todas(req.sitio_id) });
        } catch (error) {
            return this._erro(res, error, 'email');
        }
    }

    // GET /api/painel/regras-minimo
    async listarRegras(req, res) {
        try {
            const regras = await sel(
                `SELECT id, data_inicio::text AS data_inicio, data_fim::text AS data_fim, min_noites, descricao
                   FROM ${S}.tb_regras_minimo WHERE sitio_id = :s ORDER BY data_inicio`, { s: req.sitio_id });
            return res.status(200).json(regras);
        } catch (error) {
            return this._erro(res, error, 'listarRegras');
        }
    }

    // POST /api/painel/regras-minimo — { data_inicio, data_fim, min_noites 1..30, descricao? }
    async criarRegra(req, res) {
        try {
            const { data_inicio, data_fim } = req.body;
            if (data_fim < data_inicio) return res.status(422).json({ message: 'Informe um período válido e um mínimo entre 1 e 30 noites.' });
            const [r] = await sel(
                `INSERT INTO ${S}.tb_regras_minimo (sitio_id, data_inicio, data_fim, min_noites, descricao)
                 VALUES (:s, :i, :f, :m, :d) RETURNING id`,
                { s: req.sitio_id, i: data_inicio, f: data_fim, m: Number(req.body.min_noites), d: String(req.body.descricao || '').trim().slice(0, 80) || null });
            return res.status(201).json({ id: r.id, message: 'Regra adicionada.' });
        } catch (error) {
            return this._erro(res, error, 'criarRegra');
        }
    }

    // DELETE /api/painel/regras-minimo/:id
    async removerRegra(req, res) {
        try {
            const apagadas = await sel(`DELETE FROM ${S}.tb_regras_minimo WHERE id = :id AND sitio_id = :s RETURNING id`,
                { id: req.params.id, s: req.sitio_id });
            if (!apagadas.length) return res.status(404).json({ message: 'Regra não encontrada.' });
            return res.status(200).json({ message: 'Regra removida.' });
        } catch (error) {
            return this._erro(res, error, 'removerRegra');
        }
    }

    async _todas(sitioId) {
        const out = { ...CONFIG_PADRAO, email_remetente: '', email_notificacao: '', site_url: '' };
        (await sel(`SELECT chave, valor FROM ${S}.tb_configuracoes WHERE sitio_id = :s`, { s: sitioId }))
            .forEach((c) => { out[c.chave] = c.valor; });
        return out;
    }

    // Upsert sem ON CONFLICT (PostgreSQL 9.2): UPDATE e, se não havia, INSERT — na mesma transação
    async _gravar(sitioId, pares) {
        await postgres.transaction(async (transaction) => {
            await sel('SELECT pg_advisory_xact_lock(:s)', { s: sitioId }, transaction);
            for (const [chave, valor] of Object.entries(pares)) {
                const atualizadas = await sel(
                    `UPDATE ${S}.tb_configuracoes SET valor = :v WHERE sitio_id = :s AND chave = :c RETURNING chave`,
                    { s: sitioId, c: chave, v: valor }, transaction);
                if (!atualizadas.length) {
                    await postgres.query(`INSERT INTO ${S}.tb_configuracoes (sitio_id, chave, valor) VALUES (:s, :c, :v)`,
                        { replacements: { s: sitioId, c: chave, v: valor }, type: QueryTypes.INSERT, transaction });
                }
            }
        });
    }

    async _dominioExiste(dominio) {
        if (!dominio) return false;
        for (const tipo of ['resolveMx', 'resolve4']) {
            try {
                if ((await dns[tipo](dominio)).length) return true;
            } catch (e) { /* tenta o próximo tipo */ }
        }
        return false;
    }

    _erro(res, error, acao) {
        console.error(`[configuracao.${acao}]`, error.message);
        return res.status(500).json({ message: 'Erro ao salvar as configurações.' });
    }
}

module.exports = ConfiguracaoController;
