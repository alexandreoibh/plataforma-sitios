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
- **Fuso:** a sessão roda em `-03:00` (Brasília, `src/database/postgres.js`), então `now()` e `current_date` já são o "hoje" das regras. `TIMESTAMP` volta como texto `'YYYY-MM-DD HH:MM:SS'` (parser 1114) e `DATE` deve ser selecionado com `::text`. No JS, use `helpers/datas.js` (`hojeBR`, `addDays`…), nunca `new Date()` para datas de negócio.
- Regras de disponibilidade (noites ocupadas, mínimo de noites, validação de período) ficam em `helpers/regras.js`, portadas de `includes/availability.php`.
- Queries: `postgres.query(sql, { replacements, type: QueryTypes.SELECT, transaction })`.

## Multi-sítio (isolamento)

- Toda tabela de dados tem `sitio_id`. **Toda** query do painel filtra por `req.sitio_id`, que vem **sempre do token** (`helpers/auth.js`), nunca do body/query.
- Super-admin (`tb_usuarios.super_admin`) pode operar em outro sítio pelo header `X-Sitio-Id`.
- Perfis por sítio em `tb_membros` (`admin` | `operador`, `ativo` por vínculo); `requireAdmin` protege financeiro, usuários e configurações.
- Rotas do painel usam `auth` + `requireSitio`, que confere o vínculo **no banco** a cada chamada (acesso removido/desativado ou sítio suspenso valem na hora, sem esperar o token expirar) e pega o perfil de lá.
- Usuário em mais de um sítio: o admin de um sítio só altera nome/e-mail/senha de quem é **exclusivo** dele (`services/membros.js`); o resto a própria pessoa troca.
- Rotas públicas (site) identificam o sítio pelo `slug`.

## Espaços (unidades alugáveis)

- Um sítio tem 1..N espaços (`tb_espacos`: o sítio em si, chalés, casas...). **Cada reserva, bloqueio e regra de mínimo é de um espaço** (`espaco_id` NOT NULL, FK composta `(espaco_id, sitio_id)` → `tb_espacos(id, sitio_id)`: o espaço é sempre do mesmo sítio).
- Espaços são **independentes**: ocupação, conflito e mínimo de noites são calculados por espaço (`helpers/regras.js`). 1 espaço por reserva.
- Compatibilidade (`helpers/espacos.js` → `resolverEspaco`): sem `espaco` informado, usa o único espaço ativo; com mais de um ativo, 422 `ESPACO_OBRIGATORIO`.
- Mínimo de noites: regra do espaço → `tb_espacos.min_noites_padrao` → configuração `min_noites_padrao` do sítio → 1. Capacidade (hóspedes) é do espaço; `tb_sitios.min/max_hospedes` ficou como legado.
- Espaço não se apaga (tem histórico): desativa. O sítio precisa de ao menos um ativo. Sítio novo nasce com o espaço principal (`garantirEspacoPrincipal`).

## Tabelas (schema "s-sitios")

`tb_sitios`, `tb_usuarios` (e-mail único global, índice em `lower(email)`), `tb_membros`, `tb_reservas` (mesmas colunas do PHP + `sitio_id`; entrada/saldo como boolean + datas), `tb_bloqueios`, `tb_regras_minimo`, `tb_configuracoes` (sitio_id, chave, valor), `tb_espacos` (slug único no sítio, nome, tipo sitio|chale|casa|suite|outro, descricao_curta, endereco/maps_query, min/max_hospedes, min_noites_padrao, ativo, ordem). `tb_reservas`, `tb_bloqueios` e `tb_regras_minimo` têm `espaco_id`.
Recebíveis do financeiro são **calculados** a partir de `tb_reservas`, como no PHP (`includes/finance.php` do front é a referência).

## Padrões (iguais ao e-Morador)

- Rotas: `router.post('/x', auth, [validações express-validator], validate, controller.metodo.bind(controller))`.
- Controllers são classes; auxiliares privados começam com `_`.
- Efeitos colaterais (e-mail) via `waitUntil` de `@vercel/functions` depois da resposta.
- Cron: a Vercel não roda `node-cron`; tarefas são rotas protegidas por `cronQueueKeyGuard` (header `X-Cron-Queue-Key`) chamadas por um agendador externo.
- E-mails: enviados por um endpoint PHP (`EMAIL_DISPATCH_URL` + `PUBLIC_EMAIL_DISPATCH_KEY`), como no e-Morador.

## Rotas

| Rota | Acesso | O que faz |
|---|---|---|
| `GET /api/health` | público | Healthcheck |
| `GET /api/health/db` | `X-Cron-Queue-Key` | Versão do Postgres e tabelas do schema |
| `GET /api/public/sitios/:slug` | público | Identidade do sítio para o front (cache 5 min) + `espacos[]` ativos; 404 se não estiver `ativo` |
| `GET /api/public/sitios/:slug/disponibilidade` | público | `?espaco=<slug>&inicio=YYYY-MM&meses=2` → `{ espaco, ocupadas, hoje, maxData, minPadrao, regras }` do espaço (mesmo formato do `api/disponibilidade.php` do front) |
| `POST /api/public/sitios/:slug/reservas` | `X-Front-Key` (env `FRONT_KEY`) | Pedido do site (pendente) para o `espaco` (slug), validações do `reservar.php` (hóspedes pela capacidade do espaço); 422 com `erros[]`; 429 após 5 pedidos pendentes do mesmo e-mail em 24h. O front envia os e-mails com o mailer dele |
| `POST /api/auth/login` | público | `{ email, senha }` → `{ token, usuario, sitios, sitio }`. Com um sítio só, o token já vem nele (`sitio_id`, `perfil`); com vários (ou super-admin), `sitio` = null |
| `POST /api/auth/sitio` | `auth` | `{ sitio_id }` → token novo no sítio escolhido |
| `POST /api/auth/senha/esqueci\|validar\|redefinir` | `X-Front-Key` | Esqueci minha senha: `esqueci {email, slug}` gera o token (só para quem tem acesso ao sítio; 1h; não repete em 2 min) e devolve `{nome, email, token, configuracoes}` para o painel enviar o e-mail; `validar {token}`; `redefinir {token, senha}` |
| `GET/POST /api/admin/sitios`, `GET/PUT /api/admin/sitios/:id` | `auth` + `requireSuperAdmin` | Cadastro de sítios (tela `admin/sitios.php` do painel PHP) |
| `GET/POST /api/admin/sitios/:id/membros`, `PUT/DELETE /api/admin/sitios/:id/membros/:usuarioId` | `auth` + `requireSuperAdmin` | Usuários do sítio (vínculo `tb_membros`). POST com e-mail novo cria o usuário (nome + senha). DELETE remove só o vínculo; nunca deixa o sítio sem admin (409) |
| `GET /api/painel/contexto` | painel | Usuário, identidade do sítio ativo, perfil, nº de pendentes e `espacos[]` ativos |
| `PUT /api/painel/perfil`, `PUT /api/painel/perfil/senha` | painel | Meus dados |
| `GET /api/painel/reservas` | painel | `?espaco_id=&status=a,b&q=&de=&ate=&checkout_apos=&ordem=checkin\|checkin_desc&conflito=1&contagem=1` → `{ reservas, contagem? }` (conflitos calculados em lote) |
| `GET /api/painel/reservas/:id` | painel | `{ reserva, conflito, outros_pendentes }` |
| `POST /api/painel/reservas/:id/aprovar\|recusar\|cancelar` | painel | Transição de status (aprovar exige pagamento e trava o sítio) |
| `PUT /api/painel/reservas/:id/espaco` | painel | `{ espaco_id }` troca o espaço (pendente/aprovada; aprovada só se o período estiver livre no espaço novo) |
| `PUT /api/painel/reservas/:id/pagamento` | painel | Pagamento de reserva aprovada |
| `POST /api/painel/reservas/:id/recebimento` | painel + admin | `{ tipo: entrada\|saldo, data? }` (financeiro) |
| `GET/POST /api/painel/bloqueios`, `DELETE /api/painel/bloqueios/:id` | painel | `?espaco_id=` + `?passados=1` ou `?de=&ate=`; cada item traz o espaço e `reservas_no_periodo` (mesmo espaço). POST `{ espaco_ids[], data_inicio, data_fim, motivo? }` cria um bloqueio por espaço |
| `GET /api/painel/configuracoes`, `PUT …/configuracoes/gerais\|email` | painel (PUT: admin) | Chaves com os padrões do PHP; e-mail confere o DNS do remetente |
| `GET/POST /api/painel/regras-minimo`, `DELETE …/:id` | painel (escrita: admin) | Mínimo de noites por período e espaço (POST `{ espaco_ids[], ... }` cria uma regra por espaço) |
| `GET /api/painel/espacos`, `POST …/espacos`, `PUT …/espacos/:id` | painel (escrita: admin) | Espaços do sítio (lista traz inativos e `reservas_futuras`); sem DELETE |
| `GET/POST /api/painel/usuarios`, `PUT/DELETE …/:usuarioId`, `POST …/:usuarioId/senha` | painel + admin | Usuários do sítio (`services/membros.js`) |

"painel" = `auth` + `requireSitio`. Consumidor: `C:\xampp8\painel-sitios` (painel PHP único). O banco é remoto (~250 ms por consulta): junte consultas e calcule em lote. O painel recebe as reservas com as mesmas colunas do MySQL do PHP; os recebíveis do financeiro continuam calculados pelo painel (`includes/finance.php`).

Scripts: `npm run superadmin` (cria/atualiza super-admin, pergunta a senha sem mostrar; `SA_NOME`/`SA_EMAIL`/`SA_SENHA` para uso não interativo), `npm run sitio -- <nome>` (cadastra/atualiza o sítio de `scripts/dados-<nome>.js`, ex.: `paraiso`, `kaxaprego`; configurações iniciais só se ainda não existirem).

## Variáveis de ambiente

Ver `.env.example`. Nunca commitar `.env`.
