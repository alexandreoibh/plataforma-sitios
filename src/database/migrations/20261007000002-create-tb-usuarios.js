'use strict';

// Compatível com PostgreSQL 9.2: sem jsonb, sem ON CONFLICT, sem CREATE INDEX IF NOT EXISTS.
const { SCHEMA } = require('../postgres');

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      CREATE TABLE IF NOT EXISTS ${SCHEMA}.tb_usuarios (
        id               SERIAL PRIMARY KEY,
        nome             VARCHAR(100) NOT NULL,
        email            VARCHAR(150) NOT NULL,
        senha_hash       VARCHAR(255) NOT NULL,
        telefone         VARCHAR(30)  NULL,
        super_admin      BOOLEAN      NOT NULL DEFAULT false,
        ativo            BOOLEAN      NOT NULL DEFAULT true,
        ultimo_acesso    TIMESTAMP    NULL,
        reset_token_hash VARCHAR(64)  NULL,
        reset_expira     TIMESTAMP    NULL,
        criado_em        TIMESTAMP    NOT NULL DEFAULT now()
      );
    `);
    await queryInterface.sequelize.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE c.relname = 'uq_usuarios_email_lower' AND n.nspname = '${SCHEMA.replace(/"/g, '')}'
        ) THEN
          CREATE UNIQUE INDEX uq_usuarios_email_lower ON ${SCHEMA}.tb_usuarios (lower(email));
        END IF;
      END $$;
    `);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`DROP TABLE IF EXISTS ${SCHEMA}.tb_usuarios`);
  }
};
