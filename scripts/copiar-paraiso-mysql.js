'use strict';
// Copia o Paraíso na Serra do Cipó (site PHP atual, MySQL) para o schema da plataforma no Postgres.
// - No MySQL só LÊ (tabelas com prefixo MYSQL_PREFIX, ex.: sc_).
// - No Postgres cria o sítio "paraiso-serra-do-cipo" e copia usuários, membros, configurações,
//   regras de mínimo, bloqueios e reservas, tudo numa transação. Os nº das reservas são mantidos.
// - Recusa rodar de novo se o sítio já tiver reservas (use --forcar para apagar e copiar outra vez).
// Uso: node scripts/copiar-paraiso-mysql.js [--super=email@do.dono] [--forcar]
require('dotenv').config();
const mysql = require('mysql2/promise');
const { QueryTypes } = require('sequelize');
const postgres = require('../src/database/postgres');

const S = postgres.SCHEMA;
const P = process.env.MYSQL_PREFIX || 'sc_';
const args = Object.fromEntries(process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v === undefined ? true : v];
}));

const SITIO = {
    slug: 'paraiso-serra-do-cipo',
    nome: 'Paraíso na Serra do Cipó',
    dominios: ['paraisonaserradocipo.com.br', 'www.paraisonaserradocipo.com.br'],
    whatsapp: '5531996519766',
    telefone: '(31) 99651-9766',
    endereco: 'São José da Serra — Jaboticatubas/MG',
    maps_query: 'São José da Serra, Jaboticatubas - MG',
    min_hospedes: 10,
    max_hospedes: 20,
};

// password_hash() do PHP gera $2y$; bcryptjs confere $2a$/$2b$ (mesmo algoritmo)
const bcryptCompat = (hash) => String(hash).replace(/^\$2y\$/, '$2b$');
const bool = (v) => Number(v) === 1;
const ymd = (d) => (d ? (d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10)) : null);

async function main() {
    const my = await mysql.createConnection({
        host: process.env.MYSQL_HOST, port: process.env.MYSQL_PORT || 3306,
        user: process.env.MYSQL_USER, password: process.env.MYSQL_PASSWORD, database: process.env.MYSQL_DATABASE,
        dateStrings: true,
    });
    const read = async (table) => (await my.query(`SELECT * FROM \`${P}${table}\``))[0];
    const usuarios = await read('usuarios');
    const reservas = await read('reservas');
    const bloqueios = await read('bloqueios');
    const regras = await read('regras_minimo');
    const configs = (await read('configuracoes')).filter((c) => c.chave !== 'schema_versao');
    await my.end();
    console.log(`MySQL: ${usuarios.length} usuários, ${reservas.length} reservas, ${bloqueios.length} bloqueios, ${regras.length} regras, ${configs.length} configurações`);

    const q = (sql, replacements, t, type = QueryTypes.SELECT) => postgres.query(sql, { replacements, transaction: t, type });

    await postgres.transaction(async (t) => {
        let [sitio] = await q(`SELECT id FROM ${S}.tb_sitios WHERE slug = :slug`, { slug: SITIO.slug }, t);
        if (sitio) {
            const [{ n }] = await q(`SELECT COUNT(*)::int AS n FROM ${S}.tb_reservas WHERE sitio_id = :id`, { id: sitio.id }, t);
            if (n > 0 && !args.forcar) {
                throw new Error(`O sítio ${SITIO.slug} (id ${sitio.id}) já tem ${n} reservas no Postgres. Use --forcar para apagar e copiar de novo.`);
            }
            for (const tb of ['tb_reservas', 'tb_bloqueios', 'tb_regras_minimo', 'tb_configuracoes', 'tb_membros']) {
                await q(`DELETE FROM ${S}.${tb} WHERE sitio_id = :id`, { id: sitio.id }, t, QueryTypes.DELETE);
            }
        } else {
            [sitio] = await q(
                `INSERT INTO ${S}.tb_sitios (slug, nome, dominios, whatsapp, telefone, endereco, maps_query, min_hospedes, max_hospedes)
                 VALUES (:slug, :nome, ARRAY[:dominios]::text[], :whatsapp, :telefone, :endereco, :maps_query, :min_hospedes, :max_hospedes)
                 RETURNING id`, SITIO, t, QueryTypes.SELECT);
        }
        const sitioId = sitio.id;

        // Usuários: o e-mail é global na plataforma; se já existir, só vincula ao sítio
        for (const u of usuarios) {
            let [pg] = await q(`SELECT id FROM ${S}.tb_usuarios WHERE lower(email) = lower(:email)`, { email: u.email }, t);
            if (!pg) {
                [pg] = await q(
                    `INSERT INTO ${S}.tb_usuarios (nome, email, senha_hash, telefone, super_admin, ativo, ultimo_acesso, criado_em)
                     VALUES (:nome, lower(:email), :hash, :telefone, :superAdmin, :ativo, :ultimo, :criado) RETURNING id`,
                    { nome: u.nome, email: u.email, hash: bcryptCompat(u.senha_hash), telefone: u.telefone || null,
                      superAdmin: args.super ? String(args.super).toLowerCase() === String(u.email).toLowerCase() : false,
                      ativo: u.ativo === undefined ? true : bool(u.ativo), ultimo: u.ultimo_acesso || null, criado: u.criado_em }, t);
            }
            await q(`INSERT INTO ${S}.tb_membros (usuario_id, sitio_id, perfil) VALUES (:u, :s, :p)`,
                { u: pg.id, s: sitioId, p: u.perfil === 'operador' ? 'operador' : 'admin' }, t, QueryTypes.INSERT);
        }

        for (const c of configs) {
            await q(`INSERT INTO ${S}.tb_configuracoes (sitio_id, chave, valor) VALUES (:s, :k, :v)`,
                { s: sitioId, k: c.chave, v: c.valor }, t, QueryTypes.INSERT);
        }
        for (const r of regras) {
            await q(`INSERT INTO ${S}.tb_regras_minimo (sitio_id, data_inicio, data_fim, min_noites, descricao) VALUES (:s, :i, :f, :m, :d)`,
                { s: sitioId, i: ymd(r.data_inicio), f: ymd(r.data_fim), m: r.min_noites, d: r.descricao || null }, t, QueryTypes.INSERT);
        }
        for (const b of bloqueios) {
            await q(`INSERT INTO ${S}.tb_bloqueios (sitio_id, data_inicio, data_fim, motivo, criado_em) VALUES (:s, :i, :f, :m, :c)`,
                { s: sitioId, i: ymd(b.data_inicio), f: ymd(b.data_fim), m: b.motivo || null, c: b.criado_em }, t, QueryTypes.INSERT);
        }
        // Reservas mantêm o id (é o nº do pedido que o cliente recebeu por e-mail)
        for (const r of reservas) {
            await q(
                `INSERT INTO ${S}.tb_reservas (id, sitio_id, nome, email, telefone, checkin, checkout, hospedes, mensagem, status,
                    observacao_admin, pagamento_forma, pagamento_condicao, pagamento_parcelas, valor_total,
                    entrada_paga, entrada_paga_em, saldo_pago, saldo_pago_em, aprovada_em, criado_em, atualizado_em)
                 VALUES (:id, :s, :nome, :email, :telefone, :checkin, :checkout, :hospedes, :mensagem, :status,
                    :obs, :forma, :cond, :parcelas, :valor, :ep, :epEm, :sp, :spEm, :aprov, :criado, :atual)`,
                { id: r.id, s: sitioId, nome: r.nome, email: r.email, telefone: r.telefone, checkin: ymd(r.checkin), checkout: ymd(r.checkout),
                  hospedes: r.hospedes, mensagem: r.mensagem || null, status: r.status, obs: r.observacao_admin || null,
                  forma: r.pagamento_forma || null, cond: r.pagamento_condicao || null, parcelas: r.pagamento_parcelas || null,
                  valor: r.valor_total === undefined ? null : r.valor_total, ep: bool(r.entrada_paga), epEm: ymd(r.entrada_paga_em),
                  sp: bool(r.saldo_pago), spEm: ymd(r.saldo_pago_em), aprov: r.aprovada_em || null, criado: r.criado_em, atual: r.atualizado_em },
                t, QueryTypes.INSERT);
        }
        // A sequência continua depois do maior nº copiado (setval funciona na 9.2)
        await q(`SELECT setval(pg_get_serial_sequence('${S}.tb_reservas', 'id'), GREATEST((SELECT COALESCE(MAX(id), 0) FROM ${S}.tb_reservas), 1))`, {}, t);

        console.log(`Postgres: sítio id ${sitioId} (${SITIO.slug}) copiado.`);
    });
    await postgres.close();
}

main().catch(async (err) => {
    console.error('Falha na cópia (nada foi gravado):', err.message);
    try { await postgres.close(); } catch (e) { /* já fechado */ }
    process.exit(1);
});
