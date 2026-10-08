'use strict';
// Cadastra (ou atualiza) um sítio na tb_sitios com os dados de scripts/dados-<nome>.js.
// Pode rodar de novo sem duplicar: a 9.2 não tem ON CONFLICT, então é SELECT + INSERT/UPDATE numa transação.
// As `configuracoes` do arquivo de dados (se houver) só são gravadas quando a chave ainda não existe no sítio
// (nunca sobrescreve o que o dono mudou no painel).
// Uso: npm run sitio -- paraiso | npm run sitio -- kaxaprego
require('dotenv').config();
const path = require('path');
const fs = require('fs');
const { QueryTypes } = require('sequelize');
const postgres = require('../src/database/postgres');

const nome = String(process.argv[2] || '').replace(/[^a-z0-9-]/gi, '');
const arquivo = path.join(__dirname, `dados-${nome}.js`);
if (!nome || !fs.existsSync(arquivo)) {
    console.error(`Uso: npm run sitio -- <nome>   (precisa existir scripts/dados-<nome>.js)`);
    process.exit(1);
}
const SITIO = require(arquivo);

const S = postgres.SCHEMA;
const CAMPOS = ['nome', 'slogan', 'telefone', 'whatsapp', 'email_contato', 'endereco', 'maps_query',
    'instagram', 'facebook', 'min_hospedes', 'max_hospedes'];

async function main() {
    await postgres.transaction(async (t) => {
        const q = (sql, replacements, type = QueryTypes.SELECT) => postgres.query(sql, { replacements, transaction: t, type });
        const dados = { ...SITIO };
        CAMPOS.forEach((c) => { if (dados[c] === undefined) dados[c] = null; });
        let [sitio] = await q(`SELECT id FROM ${S}.tb_sitios WHERE slug = :slug`, { slug: SITIO.slug });
        if (sitio) {
            await q(`UPDATE ${S}.tb_sitios SET ${CAMPOS.map((c) => `${c} = :${c}`).join(', ')}, dominios = ARRAY[:dominios]::text[]
                     WHERE id = :id`, { ...dados, id: sitio.id }, QueryTypes.UPDATE);
            console.log(`Sítio ${SITIO.slug} atualizado (id ${sitio.id}).`);
        } else {
            [sitio] = await q(`INSERT INTO ${S}.tb_sitios (slug, ${CAMPOS.join(', ')}, dominios)
                     VALUES (:slug, ${CAMPOS.map((c) => `:${c}`).join(', ')}, ARRAY[:dominios]::text[]) RETURNING id`, dados);
            console.log(`Sítio ${SITIO.slug} cadastrado (id ${sitio.id}).`);
        }
        for (const [chave, valor] of Object.entries(SITIO.configuracoes || {})) {
            const [existe] = await q(`SELECT 1 AS x FROM ${S}.tb_configuracoes WHERE sitio_id = :s AND chave = :c`, { s: sitio.id, c: chave });
            if (existe) continue;
            await q(`INSERT INTO ${S}.tb_configuracoes (sitio_id, chave, valor) VALUES (:s, :c, :v)`, { s: sitio.id, c: chave, v: valor }, QueryTypes.INSERT);
            console.log(`  configuração ${chave} = ${valor}`);
        }
    });
    await postgres.close();
}

main().catch(async (err) => {
    console.error('Falha ao cadastrar o sítio:', err.message);
    try { await postgres.close(); } catch (e) { /* já fechado */ }
    process.exit(1);
});
