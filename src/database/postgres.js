const Sequelize = require('sequelize');
const pgLib = require('pg');
const config = require('./config_postgres');

// TIMESTAMP (sem fuso) volta como texto 'YYYY-MM-DD HH:MM:SS', igual ao MySQL do PHP.
// Sem isso o driver cria um Date no fuso do Node (Vercel = UTC) e desloca 3h.
pgLib.types.setTypeParser(1114, (v) => v);

// Sessão no horário de Brasília (sem horário de verão desde 2019): now() e current_date
// valem para o "hoje" das regras (vencimentos, atrasos, check-in no passado).
const postgres = new Sequelize({ ...config, timezone: '-03:00' });

// Schema das tabelas da plataforma. O mesmo banco tem os schemas do e-Morador:
// toda SQL usa o nome qualificado (ex.: `${SCHEMA}.tb_reservas`), nunca o search_path.
postgres.SCHEMA = '"' + String(process.env.DB_SCHEMA || 's-sitios').replace(/"/g, '') + '"';

module.exports = postgres;
