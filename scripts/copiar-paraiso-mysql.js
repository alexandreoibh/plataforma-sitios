'use strict';
// Copia o Paraíso na Serra do Cipó (site PHP antigo, MySQL) para o schema da plataforma no Postgres.
// - No MySQL só LÊ (tabelas com prefixo MYSQL_PREFIX, ex.: sc_).
// - No Postgres cria o sítio "paraiso-serra-do-cipo" e copia usuários, membros, configurações,
//   regras de mínimo, bloqueios e reservas, tudo numa transação. Os nº das reservas são mantidos.
// - Recusa rodar de novo se o sítio já tiver reservas (use --forcar para apagar e copiar outra vez).
// - Usuário que já existe na plataforma (e não é super-admin) é atualizado com os dados do MySQL
//   (nome, telefone, ativo e senha): na virada, o MySQL é a fonte.
// Uso:
//   node scripts/copiar-paraiso-mysql.js [--forcar] [--folga=20] [--super=email]
//       --folga: a numeração dos pedidos novos (API) continua em MAX(id)+folga, deixando espaço para
//                pedidos que ainda caírem no MySQL até o site novo subir (copiados depois com --complementar)
//   node scripts/copiar-paraiso-mysql.js --complementar
//       Depois do upload: copia reservas (id ainda não usado) e bloqueios (período ainda não existente)
//       que estão no MySQL e faltam no Postgres, e atualiza reservas alteradas no admin antigo depois
//       da última mudança no Postgres. Não apaga bloqueios nem reservas criadas pela API.
require('dotenv').config();
const mysql = require('mysql2/promise');
const { QueryTypes } = require('sequelize');
const postgres = require('../src/database/postgres');
const { garantirEspacoPrincipal } = require('../src/helpers/espacos');

const S = postgres.SCHEMA;
const P = process.env.MYSQL_PREFIX || 'sc_';
const args = Object.fromEntries(process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v === undefined ? true : v];
}));
const FOLGA = Math.max(0, parseInt(args.folga, 10) || 0);

const SITIO = require('./dados-paraiso');

// password_hash() do PHP gera $2y$; bcryptjs confere $2a$/$2b$ (mesmo algoritmo)
const bcryptCompat = (hash) => String(hash).replace(/^\$2y\$/, '$2b$');
const bool = (v) => Number(v) === 1;
const ymd = (d) => (d ? (d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10)) : null);

const q = (sql, replacements, t, type = QueryTypes.SELECT) => postgres.query(sql, { replacements, transaction: t, type });

async function inserirReserva(r, sitioId, espacoId, t) {
    await q(
        `INSERT INTO ${S}.tb_reservas (id, sitio_id, espaco_id, nome, email, telefone, checkin, checkout, hospedes, mensagem, status,
            observacao_admin, pagamento_forma, pagamento_condicao, pagamento_parcelas, valor_total,
            entrada_paga, entrada_paga_em, saldo_pago, saldo_pago_em, aprovada_em, criado_em, atualizado_em)
         VALUES (:id, :s, :e, :nome, :email, :telefone, :checkin, :checkout, :hospedes, :mensagem, :status,
            :obs, :forma, :cond, :parcelas, :valor, :ep, :epEm, :sp, :spEm, :aprov, :criado, :atual)`,
        { id: r.id, s: sitioId, e: espacoId, nome: r.nome, email: r.email, telefone: r.telefone, checkin: ymd(r.checkin), checkout: ymd(r.checkout),
          hospedes: r.hospedes, mensagem: r.mensagem || null, status: r.status, obs: r.observacao_admin || null,
          forma: r.pagamento_forma || null, cond: r.pagamento_condicao || null, parcelas: r.pagamento_parcelas || null,
          valor: r.valor_total === undefined ? null : r.valor_total, ep: bool(r.entrada_paga), epEm: ymd(r.entrada_paga_em),
          sp: bool(r.saldo_pago), spEm: ymd(r.saldo_pago_em), aprov: r.aprovada_em || null, criado: r.criado_em, atual: r.atualizado_em },
        t, QueryTypes.INSERT);
}

async function inserirBloqueio(b, sitioId, espacoId, t) {
    await q(`INSERT INTO ${S}.tb_bloqueios (sitio_id, espaco_id, data_inicio, data_fim, motivo, criado_em) VALUES (:s, :e, :i, :f, :m, :c)`,
        { s: sitioId, e: espacoId, i: ymd(b.data_inicio), f: ymd(b.data_fim), m: b.motivo || null, c: b.criado_em }, t, QueryTypes.INSERT);
}

async function lerMysql() {
    const my = await mysql.createConnection({
        host: process.env.MYSQL_HOST, port: process.env.MYSQL_PORT || 3306,
        user: process.env.MYSQL_USER, password: process.env.MYSQL_PASSWORD, database: process.env.MYSQL_DATABASE,
        dateStrings: true,
    });
    const read = async (table) => (await my.query(`SELECT * FROM \`${P}${table}\``))[0];
    const dados = {
        usuarios: await read('usuarios'),
        reservas: await read('reservas'),
        bloqueios: await read('bloqueios'),
        regras: await read('regras_minimo'),
        configs: (await read('configuracoes')).filter((c) => c.chave !== 'schema_versao'),
    };
    await my.end();
    console.log(`MySQL: ${dados.usuarios.length} usuários, ${dados.reservas.length} reservas, ${dados.bloqueios.length} bloqueios, `
        + `${dados.regras.length} regras, ${dados.configs.length} configurações`);
    return dados;
}

async function copiarTudo() {
    const { usuarios, reservas, bloqueios, regras, configs } = await lerMysql();

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
                `INSERT INTO ${S}.tb_sitios (slug, nome, slogan, dominios, whatsapp, telefone, email_contato, endereco, maps_query, instagram, facebook, min_hospedes, max_hospedes)
                 VALUES (:slug, :nome, :slogan, ARRAY[:dominios]::text[], :whatsapp, :telefone, :email_contato, :endereco, :maps_query, :instagram, :facebook, :min_hospedes, :max_hospedes)
                 RETURNING id`, SITIO, t, QueryTypes.SELECT);
        }
        const sitioId = sitio.id;
        // Tudo do Paraíso vai para o espaço principal do sítio
        const espacoId = await garantirEspacoPrincipal(sitioId, t);

        // Usuários: o e-mail é global na plataforma. Já existe → vincula e (se não for super-admin) atualiza com o MySQL.
        for (const u of usuarios) {
            const dados = { nome: u.nome, email: u.email, hash: bcryptCompat(u.senha_hash), telefone: u.telefone || null,
                ativo: u.ativo === undefined ? true : bool(u.ativo), ultimo: u.ultimo_acesso || null, criado: u.criado_em };
            let [pg] = await q(`SELECT id, super_admin FROM ${S}.tb_usuarios WHERE lower(email) = lower(:email)`, { email: u.email }, t);
            if (!pg) {
                [pg] = await q(
                    `INSERT INTO ${S}.tb_usuarios (nome, email, senha_hash, telefone, super_admin, ativo, ultimo_acesso, criado_em)
                     VALUES (:nome, lower(:email), :hash, :telefone, :superAdmin, :ativo, :ultimo, :criado) RETURNING id`,
                    { ...dados, superAdmin: args.super ? String(args.super).toLowerCase() === String(u.email).toLowerCase() : false }, t);
            } else if (!pg.super_admin) {
                await q(`UPDATE ${S}.tb_usuarios SET nome = :nome, telefone = :telefone, ativo = :ativo, senha_hash = :hash WHERE id = :id`,
                    { ...dados, id: pg.id }, t, QueryTypes.UPDATE);
            }
            await q(`INSERT INTO ${S}.tb_membros (usuario_id, sitio_id, perfil) VALUES (:u, :s, :p)`,
                { u: pg.id, s: sitioId, p: u.perfil === 'operador' ? 'operador' : 'admin' }, t, QueryTypes.INSERT);
        }

        for (const c of configs) {
            await q(`INSERT INTO ${S}.tb_configuracoes (sitio_id, chave, valor) VALUES (:s, :k, :v)`,
                { s: sitioId, k: c.chave, v: c.valor }, t, QueryTypes.INSERT);
        }
        for (const r of regras) {
            await q(`INSERT INTO ${S}.tb_regras_minimo (sitio_id, espaco_id, data_inicio, data_fim, min_noites, descricao) VALUES (:s, :e, :i, :f, :m, :d)`,
                { s: sitioId, e: espacoId, i: ymd(r.data_inicio), f: ymd(r.data_fim), m: r.min_noites, d: r.descricao || null }, t, QueryTypes.INSERT);
        }
        for (const b of bloqueios) await inserirBloqueio(b, sitioId, espacoId, t);
        // Reservas mantêm o id (é o nº do pedido que o cliente recebeu por e-mail)
        for (const r of reservas) await inserirReserva(r, sitioId, espacoId, t);

        // A sequência continua depois do maior nº (de qualquer sítio) + folga. setval funciona na 9.2.
        const [{ prox }] = await q(
            `SELECT setval(pg_get_serial_sequence('${S}.tb_reservas', 'id'),
                    GREATEST((SELECT COALESCE(MAX(id), 0) FROM ${S}.tb_reservas) + :folga, 1)) AS prox`, { folga: FOLGA }, t);
        console.log(`Postgres: sítio id ${sitioId} (${SITIO.slug}) copiado. Próximo pedido pela API: nº ${Number(prox) + 1}.`);
    });
}

async function complementar() {
    const { reservas, bloqueios } = await lerMysql();
    await postgres.transaction(async (t) => {
        const [sitio] = await q(`SELECT id FROM ${S}.tb_sitios WHERE slug = :slug`, { slug: SITIO.slug }, t);
        if (!sitio) throw new Error('Sítio do Paraíso não existe no Postgres: rode a cópia completa primeiro.');
        const espacoId = await garantirEspacoPrincipal(sitio.id, t);
        // id → última atualização no Postgres (texto 'YYYY-MM-DD HH:MM:SS', horário de Brasília, como no MySQL)
        const atualizadas = new Map((await q(`SELECT id, sitio_id, to_char(atualizado_em, 'YYYY-MM-DD HH24:MI:SS') AS em FROM ${S}.tb_reservas`, {}, t))
            .map((r) => [Number(r.id), r]));
        const ids = new Set(atualizadas.keys());
        const periodos = new Set((await q(`SELECT data_inicio::text AS i, data_fim::text AS f FROM ${S}.tb_bloqueios WHERE sitio_id = :s`,
            { s: sitio.id }, t)).map((b) => `${b.i}|${b.f}`));
        let nr = 0;
        let nb = 0;
        let nu = 0;
        for (const r of reservas) {
            const pg = atualizadas.get(Number(r.id));
            // Já existe: se mudou no admin antigo DEPOIS da última mudança no Postgres (aprovação, pagamento…), o MySQL vence
            if (pg && pg.sitio_id === sitio.id && String(r.atualizado_em).slice(0, 19) > pg.em) {
                await q(`DELETE FROM ${S}.tb_reservas WHERE id = :id AND sitio_id = :s`, { id: r.id, s: sitio.id }, t, QueryTypes.DELETE);
                await inserirReserva(r, sitio.id, espacoId, t);
                nu++;
                console.log(`  ~ reserva nº ${r.id} atualizada (${r.status}, alterada no admin antigo em ${r.atualizado_em})`);
                continue;
            }
            if (ids.has(Number(r.id))) continue;
            await inserirReserva(r, sitio.id, espacoId, t);
            nr++;
            console.log(`  + reserva nº ${r.id} (${r.nome}, ${ymd(r.checkin)} a ${ymd(r.checkout)}, ${r.status})`);
        }
        for (const b of bloqueios) {
            if (periodos.has(`${ymd(b.data_inicio)}|${ymd(b.data_fim)}`)) continue;
            await inserirBloqueio(b, sitio.id, espacoId, t);
            nb++;
            console.log(`  + bloqueio ${ymd(b.data_inicio)} a ${ymd(b.data_fim)}`);
        }
        const [pg] = await q(
            `SELECT (SELECT count(*)::int FROM ${S}.tb_reservas WHERE sitio_id = :s) AS reservas,
                    (SELECT count(*)::int FROM ${S}.tb_bloqueios WHERE sitio_id = :s) AS bloqueios`, { s: sitio.id }, t);
        console.log(`Complemento: ${nr} reserva(s) nova(s), ${nu} atualizada(s) e ${nb} bloqueio(s) copiados. Postgres agora: ${pg.reservas} reservas, ${pg.bloqueios} bloqueios `
            + `(MySQL: ${reservas.length} reservas, ${bloqueios.length} bloqueios — o Postgres pode ter mais: pedidos novos pela API).`);
    });
}

(args.complementar ? complementar : copiarTudo)()
    .then(() => postgres.close())
    .catch(async (err) => {
        console.error('Falha na cópia (nada foi gravado):', err.message);
        try { await postgres.close(); } catch (e) { /* já fechado */ }
        process.exit(1);
    });
