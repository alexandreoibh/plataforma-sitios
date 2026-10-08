'use strict';

// Compatível com PostgreSQL 9.2: sem jsonb, sem ON CONFLICT, sem CREATE INDEX IF NOT EXISTS.
const { SCHEMA } = require('../postgres');

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      CREATE TABLE IF NOT EXISTS ${SCHEMA}.tb_sitios (
        id            SERIAL PRIMARY KEY,
        slug          VARCHAR(60)  NOT NULL UNIQUE,
        nome          VARCHAR(120) NOT NULL,
        dominios      TEXT[]       NOT NULL DEFAULT '{}',
        status        VARCHAR(20)  NOT NULL DEFAULT 'ativo' CHECK (status IN ('ativo', 'suspenso', 'inativo')),
        whatsapp      VARCHAR(20)  NULL,
        telefone      VARCHAR(30)  NULL,
        email_contato VARCHAR(150) NULL,
        endereco      VARCHAR(200) NULL,
        maps_query    VARCHAR(200) NULL,
        min_hospedes  SMALLINT     NOT NULL DEFAULT 1,
        max_hospedes  SMALLINT     NOT NULL DEFAULT 20,
        criado_em     TIMESTAMP    NOT NULL DEFAULT now()
      );
    `);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`DROP TABLE IF EXISTS ${SCHEMA}.tb_sitios`);
  }
};
