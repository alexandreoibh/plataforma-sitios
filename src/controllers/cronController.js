const fetch = require('node-fetch');
const { QueryTypes } = require('sequelize');
const postgres = require('../database/postgres');
const membros = require('../services/membros');
const { marcarConflitos } = require('../helpers/regras');
const { hojeBR } = require('../helpers/datas');

const S = postgres.SCHEMA;
const sel = (sql, replacements, transaction) => postgres.query(sql, { replacements, type: QueryTypes.SELECT, transaction });
const cfg = (chave) => `(SELECT c.valor FROM ${S}.tb_configuracoes c WHERE c.sitio_id = s.id AND c.chave = '${chave}')`;

const CHAVE_ULTIMO = 'lembrete_pendentes_em';
const TIMEOUT_MS = 8000;

// Tarefas agendadas. O e-mail sai pela hospedagem de cada site (a mail() só aceita o remetente do domínio de lá):
// a API decide quem lembrar e manda os dados para <site_url>/admin/lembrete-pendentes.php, que monta e envia.
class CronController {
    // GET /api/cron/lembrete-pendentes[?sitio=<slug>&forcar=1] → { hoje, sitios: [{ slug, pendentes, ok, enviado_para?, erro? }] }
    async lembretePendentes(req, res) {
        try {
            const hoje = hojeBR();
            const forcar = req.query.forcar === '1';
            const slug = req.query.sitio ? String(req.query.sitio) : null;

            // Sítios ativos com algum pedido pendente (+ destino, remetente, equipe e o último lembrete)
            const sitios = await sel(
                `SELECT s.id, s.slug, s.nome, ${cfg('site_url')} AS site_url, ${cfg('email_remetente')} AS email_remetente,
                        ${cfg('email_notificacao')} AS email_notificacao, ${cfg(CHAVE_ULTIMO)} AS ultimo,
                        ${membros.sqlEquipe('s.id')} AS equipe
                   FROM ${S}.tb_sitios s
                  WHERE s.status = 'ativo'${slug ? ' AND s.slug = :slug' : ''}
                    AND EXISTS (SELECT 1 FROM ${S}.tb_reservas r WHERE r.sitio_id = s.id AND r.status = 'pendente')
                  ORDER BY s.id`, { slug });
            const alvo = sitios.filter((s) => forcar || s.ultimo !== hoje);
            if (!alvo.length) return res.status(200).json({ hoje, sitios: [] });

            const ids = alvo.map((s) => s.id);
            const [pendentes, espacos] = await Promise.all([
                sel(`SELECT r.id, r.sitio_id, r.espaco_id, e.nome AS espaco_nome, e.slug AS espaco_slug, r.nome, r.email, r.telefone,
                            r.checkin::text AS checkin, r.checkout::text AS checkout, r.hospedes, r.status, r.criado_em
                       FROM ${S}.tb_reservas r JOIN ${S}.tb_espacos e ON e.id = r.espaco_id
                      WHERE r.sitio_id IN (:ids) AND r.status = 'pendente'
                      ORDER BY r.checkin, r.id`, { ids }),
                sel(`SELECT id, sitio_id, slug, nome FROM ${S}.tb_espacos WHERE sitio_id IN (:ids) AND ativo ORDER BY ordem, id`, { ids }),
            ]);

            const resultados = await Promise.all(alvo.map(async (s) => {
                const lista = pendentes.filter((p) => Number(p.sitio_id) === Number(s.id));
                const item = { slug: s.slug, pendentes: lista.length, ok: false };
                try {
                    if (!s.site_url) throw new Error('site_url não configurado (Configurações › E-mail)');
                    await marcarConflitos(s.id, lista);
                    const json = await this._enviar(s.site_url, {
                        slug: s.slug,
                        hoje,
                        pendentes: lista,
                        espacos: espacos.filter((e) => Number(e.sitio_id) === Number(s.id)),
                        equipe_emails: membros.listaEquipe(s.equipe),
                        configuracoes: { site_url: s.site_url, email_remetente: s.email_remetente || '', email_notificacao: s.email_notificacao || '' },
                    });
                    await this._marcarLembrado(s.id, hoje);
                    Object.assign(item, { ok: true, enviado_para: json.enviado_para, cc: json.cc });
                } catch (error) {
                    item.erro = error.message;
                    console.error(`[cron.lembretePendentes] ${s.slug}:`, error.message);
                }
                return item;
            }));
            return res.status(200).json({ hoje, sitios: resultados });
        } catch (error) {
            console.error('[cron.lembretePendentes]', error.message);
            return res.status(500).json({ message: 'Erro ao processar o lembrete de pendentes.' });
        }
    }

    // POST no painel do site; só conta como enviado com 200 e { ok: true }
    async _enviar(siteUrl, payload) {
        const url = `${String(siteUrl).replace(/\/+$/, '')}/admin/lembrete-pendentes.php`;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
        try {
            const resp = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-Front-Key': process.env.FRONT_KEY || '' },
                body: JSON.stringify(payload),
                signal: controller.signal,
            });
            const texto = await resp.text();
            let json = {};
            try { json = JSON.parse(texto); } catch (e) { /* resposta não-JSON: vai no erro abaixo */ }
            if (!resp.ok || !json.ok) throw new Error(`${url} → HTTP ${resp.status}: ${json.erro || texto.slice(0, 200)}`);
            return json;
        } catch (error) {
            if (error.name === 'AbortError') throw new Error(`${url} não respondeu em ${TIMEOUT_MS / 1000}s`);
            throw error;
        } finally {
            clearTimeout(timer);
        }
    }

    // Guarda o dia do último lembrete (não repete se o cron rodar de novo no mesmo dia). Sem ON CONFLICT (PG 9.2).
    async _marcarLembrado(sitioId, hoje) {
        await postgres.transaction(async (transaction) => {
            const q = (sql) => postgres.query(sql, { replacements: { s: sitioId, c: CHAVE_ULTIMO, v: hoje }, transaction });
            const [r] = await sel(`SELECT 1 AS x FROM ${S}.tb_configuracoes WHERE sitio_id = :s AND chave = :c FOR UPDATE`,
                { s: sitioId, c: CHAVE_ULTIMO }, transaction);
            if (r) await q(`UPDATE ${S}.tb_configuracoes SET valor = :v WHERE sitio_id = :s AND chave = :c`);
            else await q(`INSERT INTO ${S}.tb_configuracoes (sitio_id, chave, valor) VALUES (:s, :c, :v)`);
        });
    }
}

module.exports = CronController;
