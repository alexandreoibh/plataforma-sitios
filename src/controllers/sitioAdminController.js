const { QueryTypes } = require('sequelize');
const postgres = require('../database/postgres');

const S = postgres.SCHEMA;
// Campos editáveis pelo super-admin (as colunas têm o mesmo nome)
const CAMPOS = ['slug', 'nome', 'slogan', 'telefone', 'whatsapp', 'email_contato', 'endereco', 'maps_query',
    'instagram', 'facebook', 'min_hospedes', 'max_hospedes', 'status'];
const SELECT = `SELECT id, ${CAMPOS.join(', ')}, dominios, criado_em FROM ${S}.tb_sitios`;

// Cadastro de sítios da plataforma (só super-admin; ver routes/adminSitios.js)
class SitioAdminController {
    async listar(req, res) {
        try {
            const sitios = await postgres.query(`${SELECT} ORDER BY nome`, { type: QueryTypes.SELECT });
            return res.status(200).json(sitios.map((s) => this._saida(s)));
        } catch (error) {
            return this._erro(res, error, 'listar');
        }
    }

    async buscar(req, res) {
        try {
            const [sitio] = await postgres.query(`${SELECT} WHERE id = :id`,
                { replacements: { id: req.params.id }, type: QueryTypes.SELECT });
            if (!sitio) return res.status(404).json({ message: 'Sítio não encontrado.' });
            return res.status(200).json(this._saida(sitio));
        } catch (error) {
            return this._erro(res, error, 'buscar');
        }
    }

    async criar(req, res) {
        try {
            const dados = this._entrada(req.body);
            if (await this._slugEmUso(dados.slug)) return this._slugDuplicado(res);
            const [novo] = await postgres.query(
                `INSERT INTO ${S}.tb_sitios (${CAMPOS.join(', ')}, dominios)
                 VALUES (${CAMPOS.map((c) => `:${c}`).join(', ')}, ${this._arraySql(dados.dominios)}) RETURNING id`,
                { replacements: dados, type: QueryTypes.SELECT }
            );
            const [sitio] = await postgres.query(`${SELECT} WHERE id = :id`, { replacements: { id: novo.id }, type: QueryTypes.SELECT });
            return res.status(201).json(this._saida(sitio));
        } catch (error) {
            return this._erro(res, error, 'criar');
        }
    }

    async atualizar(req, res) {
        try {
            const id = Number(req.params.id);
            const [atual] = await postgres.query(`SELECT id FROM ${S}.tb_sitios WHERE id = :id`, { replacements: { id }, type: QueryTypes.SELECT });
            if (!atual) return res.status(404).json({ message: 'Sítio não encontrado.' });
            const dados = this._entrada(req.body);
            if (await this._slugEmUso(dados.slug, id)) return this._slugDuplicado(res);
            await postgres.query(
                `UPDATE ${S}.tb_sitios SET ${CAMPOS.map((c) => `${c} = :${c}`).join(', ')}, dominios = ${this._arraySql(dados.dominios)}
                 WHERE id = :id`,
                { replacements: { ...dados, id }, type: QueryTypes.UPDATE }
            );
            const [sitio] = await postgres.query(`${SELECT} WHERE id = :id`, { replacements: { id }, type: QueryTypes.SELECT });
            return res.status(200).json(this._saida(sitio));
        } catch (error) {
            return this._erro(res, error, 'atualizar');
        }
    }

    // Texto vazio vira NULL; domínios sem repetição e em minúsculas
    _entrada(body) {
        const dados = {};
        for (const c of CAMPOS) {
            const v = body[c];
            dados[c] = v === undefined || v === null || String(v).trim() === '' ? null : (typeof v === 'string' ? v.trim() : v);
        }
        dados.slug = String(dados.slug).toLowerCase();
        dados.whatsapp = dados.whatsapp ? String(dados.whatsapp).replace(/\D/g, '') : null;
        dados.min_hospedes = Number(dados.min_hospedes);
        dados.max_hospedes = Number(dados.max_hospedes);
        dados.status = dados.status || 'ativo';
        dados.dominios = [...new Set((Array.isArray(body.dominios) ? body.dominios : [])
            .map((d) => String(d).trim().toLowerCase()).filter(Boolean))];
        return dados;
    }

    // Array text[] montado com replacements (a 9.2 aceita ARRAY[...]::text[]; vazio = '{}')
    _arraySql(lista) {
        return lista.length ? 'ARRAY[:dominios]::text[]' : `'{}'::text[]`;
    }

    _saida(s) {
        return { ...s, dominios: Array.isArray(s.dominios) ? s.dominios : this._parseArray(s.dominios) };
    }

    // Fallback: alguns drivers devolvem text[] como string "{a,b}"
    _parseArray(v) {
        if (!v || v === '{}') return [];
        return String(v).replace(/^\{|\}$/g, '').split(',').map((x) => x.replace(/^"|"$/g, ''));
    }

    async _slugEmUso(slug, ignorarId = 0) {
        const [r] = await postgres.query(`SELECT id FROM ${S}.tb_sitios WHERE slug = :slug AND id <> :id`,
            { replacements: { slug, id: ignorarId }, type: QueryTypes.SELECT });
        return Boolean(r);
    }

    _slugDuplicado(res) {
        return res.status(409).json({ message: 'Já existe um sítio com este slug.', errors: [{ param: 'slug', msg: 'Slug já usado por outro sítio.' }] });
    }

    _erro(res, error, acao) {
        console.error(`[sitioAdmin.${acao}]`, error.message);
        return res.status(500).json({ message: 'Erro ao salvar o sítio.' });
    }
}

module.exports = SitioAdminController;
