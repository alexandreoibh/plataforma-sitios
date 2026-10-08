// Configuração usada pelo sequelize-cli (.sequelizerc). A tabela de controle
// SequelizeMeta fica no próprio schema da plataforma, não no public do banco compartilhado.
const base = require('./config_postgres');

const schema = process.env.DB_SCHEMA || 's-sitios';
const cfg = { ...base, migrationStorageTableSchema: schema };

module.exports = { development: cfg, production: cfg };
