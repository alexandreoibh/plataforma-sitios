'use strict';

// Identidade do sítio exibida no front: slogan e redes sociais.
// Na 9.2 não existe ADD COLUMN IF NOT EXISTS: checa o information_schema num bloco DO.
const { SCHEMA } = require('../postgres');

const COLUNAS = {
  slogan: 'VARCHAR(150) NULL',
  instagram: 'VARCHAR(200) NULL',
  facebook: 'VARCHAR(200) NULL',
};

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    for (const [coluna, tipo] of Object.entries(COLUNAS)) {
      await queryInterface.sequelize.query(`
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
             WHERE table_schema = '${SCHEMA.replace(/"/g, '')}' AND table_name = 'tb_sitios' AND column_name = '${coluna}'
          ) THEN
            ALTER TABLE ${SCHEMA}.tb_sitios ADD COLUMN ${coluna} ${tipo};
          END IF;
        END $$;
      `);
    }
  },

  async down(queryInterface) {
    for (const coluna of Object.keys(COLUNAS)) {
      await queryInterface.sequelize.query(`ALTER TABLE ${SCHEMA}.tb_sitios DROP COLUMN IF EXISTS ${coluna}`);
    }
  }
};
