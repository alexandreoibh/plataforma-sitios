# CLAUDE.md

Guia para o Claude Code trabalhar neste repositório.

## Visão geral

API REST única em **Node.js + Express + PostgreSQL (Sequelize)** para a plataforma de sítios de aluguel (SaaS: vários sítios, cada proprietário vê só os seus).
Os **fronts continuam em PHP** (site público e painel de cada sítio) e fazem requisições a esta API. O primeiro front é o Paraíso na Serra do Cipó (`C:\xampp8\htdocs-serracipo`), que hoje ainda acessa o MySQL direto e é a especificação viva das regras.

Padrão de código copiado do back do e-Morador (`D:\09_Dev\28_ProjetoBackCondominio`).
Porta padrão: `3002`. Prefixo de todas as rotas: `/api`. Deploy na **Vercel** (`vercel.json` aponta `server.js`).

## Comandos

```bash
npm install
npm start                 # nodemon server.js
npm run migration         # sequelize-cli db:migrate (tabela SequelizeMeta fica no schema da plataforma)
npm run migration:status
npm run copiar-paraiso -- --super=email@do.dono   # copia o Paraíso do MySQL (só leitura lá) para o Postgres
```

Healthcheck: `GET /api/health`. Diagnóstico do banco (versão + tabelas): `GET /api/health/db` com header `X-Cron-Queue-Key`.

## Banco de dados — LEIA ANTES DE ESCREVER SQL

- Servidor **PostgreSQL 9.2.24** (o mesmo do e-Morador), database `alexandreoibh_sisvenda2025_postgres`, **schema `"s-sitios"`** (com hífen: sempre entre aspas).
- O mesmo banco tem os schemas do e-Morador (`"condominio-bh"`, `sgw`…): **nunca** criar, alterar ou apagar nada fora do schema da plataforma.
- Toda SQL usa o nome qualificado via `postgres.SCHEMA` (ex.: `` `${SCHEMA}.tb_reservas` ``), nunca o `search_path`.
- Recursos que **não existem** na 9.2: `jsonb`, operadores `->`/`->>` em `json`, `json_build_object`, `ON CONFLICT` (upsert), `CREATE INDEX IF NOT EXISTS`, Row Level Security. Upsert = SELECT + INSERT/UPDATE na mesma transação; índice condicional = bloco `DO $$ … IF NOT EXISTS (pg_class) …`.
- Colunas do `information_schema` (tipo `sql_identifier`) voltam num formato que o driver não mapeia por nome na 9.2: sempre castar (`table_name::text AS table_name`).
- O Sequelize gera `CREATE SCHEMA IF NOT EXISTS` (só existe na 9.3+) ao preparar a `SequelizeMeta`; `src/database/config_migrations.js` substitui isso por um bloco `DO` compatível. Não remover.
- Concorrência (ex.: duas aprovações para as mesmas datas): `pg_advisory_xact_lock(sitio_id)` dentro da transação, depois conferir conflito e gravar.
- Queries: `postgres.query(sql, { replacements, type: QueryTypes.SELECT, transaction })`.

## Multi-sítio (isolamento)

- Toda tabela de dados tem `sitio_id`. **Toda** query do painel filtra por `req.sitio_id`, que vem **sempre do token** (`helpers/auth.js`), nunca do body/query.
- Super-admin (`tb_usuarios.super_admin`) pode operar em outro sítio pelo header `X-Sitio-Id`.
- Perfis por sítio em `tb_membros` (`admin` | `operador`); `requireAdmin` protege financeiro, usuários e configurações.
- Rotas públicas (site) identificam o sítio pelo `slug`.

## Tabelas (schema "s-sitios")

`tb_sitios`, `tb_usuarios` (e-mail único global, índice em `lower(email)`), `tb_membros`, `tb_reservas` (mesmas colunas do PHP + `sitio_id`; entrada/saldo como boolean + datas), `tb_bloqueios`, `tb_regras_minimo`, `tb_configuracoes` (sitio_id, chave, valor).
Recebíveis do financeiro são **calculados** a partir de `tb_reservas`, como no PHP (`includes/finance.php` do front é a referência).

## Padrões (iguais ao e-Morador)

- Rotas: `router.post('/x', auth, [validações express-validator], validate, controller.metodo.bind(controller))`.
- Controllers são classes; auxiliares privados começam com `_`.
- Efeitos colaterais (e-mail) via `waitUntil` de `@vercel/functions` depois da resposta.
- Cron: a Vercel não roda `node-cron`; tarefas são rotas protegidas por `cronQueueKeyGuard` (header `X-Cron-Queue-Key`) chamadas por um agendador externo.
- E-mails: enviados por um endpoint PHP (`EMAIL_DISPATCH_URL` + `PUBLIC_EMAIL_DISPATCH_KEY`), como no e-Morador.

## Variáveis de ambiente

Ver `.env.example`. Nunca commitar `.env`.
