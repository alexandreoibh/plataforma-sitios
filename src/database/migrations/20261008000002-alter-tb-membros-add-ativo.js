'use strict';

// Acesso ativo/desativado é do VÍNCULO com o sítio (o mesmo usuário pode estar em vários sítios):
// o admin de um sítio desativa a pessoa ali sem bloquear o acesso dela aos outros.
// tb_usuarios.ativo continua valendo para a plataforma inteira (só o super-admin mexe).
const { SCHEMA } = require('../postgres');

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
           WHERE table_schema = '${SCHEMA.replace(/"/g, '')}' AND table_name = 'tb_membros' AND column_name = 'ativo'
        ) THEN
          ALTER TABLE ${SCHEMA}.tb_membros ADD COLUMN ativo BOOLEAN NOT NULL DEFAULT true;
        END IF;
      END $$;
    `);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`ALTER TABLE ${SCHEMA}.tb_membros DROP COLUMN IF EXISTS ativo`);
  }
};
