// Configuração usada pelo sequelize-cli (.sequelizerc). A tabela de controle
// SequelizeMeta fica no próprio schema da plataforma, não no public do banco compartilhado.
const base = require('./config_postgres');

// O Sequelize gera "CREATE SCHEMA IF NOT EXISTS" para Postgres >= 9.2, mas essa sintaxe só
// existe a partir da 9.3 — e o servidor é 9.2.24. Troca por um bloco DO compatível.
const PgQueryGenerator = require('sequelize/lib/dialects/postgres/query-generator');
PgQueryGenerator.prototype.createSchema = function createSchema(schema) {
    const nome = String(schema).replace(/'/g, "''");
    return `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = '${nome}') THEN `
        + `CREATE SCHEMA ${this.quoteIdentifier(schema)}; END IF; END $$;`;
};

const schema = process.env.DB_SCHEMA || 's-sitios';
const cfg = { ...base, migrationStorageTableSchema: schema };

module.exports = { development: cfg, production: cfg };
