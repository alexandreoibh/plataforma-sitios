'use strict';

// Compatível com PostgreSQL 9.2: sem jsonb, sem ON CONFLICT, sem CREATE INDEX IF NOT EXISTS.
const { SCHEMA } = require('../postgres');

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      CREATE TABLE IF NOT EXISTS ${SCHEMA}.tb_regras_minimo (
        id          SERIAL PRIMARY KEY,
        sitio_id    INTEGER     NOT NULL REFERENCES ${SCHEMA}.tb_sitios (id),
        data_inicio DATE        NOT NULL,
        data_fim    DATE        NOT NULL,
        min_noites  SMALLINT    NOT NULL CHECK (min_noites BETWEEN 1 AND 30),
        descricao   VARCHAR(80) NULL,
        CHECK (data_fim >= data_inicio)
      );
    `);
    await queryInterface.sequelize.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE c.relname = 'ix_regras_minimo_sitio' AND n.nspname = '${SCHEMA.replace(/"/g, '')}'
        ) THEN
          CREATE INDEX ix_regras_minimo_sitio ON ${SCHEMA}.tb_regras_minimo (sitio_id, data_inicio);
        END IF;
      END $$;
    `);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`DROP TABLE IF EXISTS ${SCHEMA}.tb_regras_minimo`);
  }
};
