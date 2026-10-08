'use strict';

// Compatível com PostgreSQL 9.2: sem jsonb, sem ON CONFLICT, sem CREATE INDEX IF NOT EXISTS.
const { SCHEMA } = require('../postgres');

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      CREATE TABLE IF NOT EXISTS ${SCHEMA}.tb_configuracoes (
        sitio_id INTEGER      NOT NULL REFERENCES ${SCHEMA}.tb_sitios (id) ON DELETE CASCADE,
        chave    VARCHAR(50)  NOT NULL,
        valor    VARCHAR(255) NOT NULL,
        PRIMARY KEY (sitio_id, chave)
      );
    `);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`DROP TABLE IF EXISTS ${SCHEMA}.tb_configuracoes`);
  }
};
