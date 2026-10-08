const Sequelize = require('sequelize');
const config = require('./config_postgres');

const postgres = new Sequelize(config);

// Schema das tabelas da plataforma. O mesmo banco tem os schemas do e-Morador:
// toda SQL usa o nome qualificado (ex.: `${SCHEMA}.tb_reservas`), nunca o search_path.
postgres.SCHEMA = '"' + String(process.env.DB_SCHEMA || 's-sitios').replace(/"/g, '') + '"';

module.exports = postgres;
