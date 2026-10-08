'use strict';

// Compatível com PostgreSQL 9.2: sem jsonb, sem ON CONFLICT, sem CREATE INDEX IF NOT EXISTS.
const { SCHEMA } = require('../postgres');

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      CREATE TABLE IF NOT EXISTS ${SCHEMA}.tb_membros (
        usuario_id INTEGER     NOT NULL REFERENCES ${SCHEMA}.tb_usuarios (id) ON DELETE CASCADE,
        sitio_id   INTEGER     NOT NULL REFERENCES ${SCHEMA}.tb_sitios (id) ON DELETE CASCADE,
        perfil     VARCHAR(20) NOT NULL DEFAULT 'operador' CHECK (perfil IN ('admin', 'operador')),
        criado_em  TIMESTAMP   NOT NULL DEFAULT now(),
        PRIMARY KEY (usuario_id, sitio_id)
      );
    `);
    await queryInterface.sequelize.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE c.relname = 'ix_membros_sitio' AND n.nspname = '${SCHEMA.replace(/"/g, '')}'
        ) THEN
          CREATE INDEX ix_membros_sitio ON ${SCHEMA}.tb_membros (sitio_id);
        END IF;
      END $$;
    `);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`DROP TABLE IF EXISTS ${SCHEMA}.tb_membros`);
  }
};
