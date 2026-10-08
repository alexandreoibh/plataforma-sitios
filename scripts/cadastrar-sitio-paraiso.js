'use strict';
// Cadastra (ou atualiza) o sítio Paraíso na tb_sitios com os dados de scripts/dados-paraiso.js.
// Pode rodar de novo sem duplicar: a 9.2 não tem ON CONFLICT, então é SELECT + INSERT/UPDATE numa transação.
// Uso: npm run sitio:paraiso
require('dotenv').config();
const { QueryTypes } = require('sequelize');
const postgres = require('../src/database/postgres');
const SITIO = require('./dados-paraiso');

const S = postgres.SCHEMA;
const CAMPOS = ['nome', 'slogan', 'telefone', 'whatsapp', 'email_contato', 'endereco', 'maps_query',
    'instagram', 'facebook', 'min_hospedes', 'max_hospedes'];

async function main() {
    await postgres.transaction(async (t) => {
        const q = (sql, replacements, type = QueryTypes.SELECT) => postgres.query(sql, { replacements, transaction: t, type });
        const [existe] = await q(`SELECT id FROM ${S}.tb_sitios WHERE slug = :slug`, { slug: SITIO.slug });
        if (existe) {
            await q(`UPDATE ${S}.tb_sitios SET ${CAMPOS.map((c) => `${c} = :${c}`).join(', ')}, dominios = ARRAY[:dominios]::text[]
                     WHERE id = :id`, { ...SITIO, id: existe.id }, QueryTypes.UPDATE);
            console.log(`Sítio ${SITIO.slug} atualizado (id ${existe.id}).`);
        } else {
            const [novo] = await q(`INSERT INTO ${S}.tb_sitios (slug, ${CAMPOS.join(', ')}, dominios)
                     VALUES (:slug, ${CAMPOS.map((c) => `:${c}`).join(', ')}, ARRAY[:dominios]::text[]) RETURNING id`, SITIO);
            console.log(`Sítio ${SITIO.slug} cadastrado (id ${novo.id}).`);
        }
    });
    await postgres.close();
}

main().catch(async (err) => {
    console.error('Falha ao cadastrar o sítio:', err.message);
    try { await postgres.close(); } catch (e) { /* já fechado */ }
    process.exit(1);
});
