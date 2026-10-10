'use strict';

// FASE 2 dos espaços (rodar DEPOIS de publicar a API que grava espaco_id): preenche com o espaço principal
// o que a API antiga tiver gravado sem espaço no intervalo e torna espaco_id obrigatório.
// Só UPDATE de NULLs e SET NOT NULL; nunca apaga nada (o down não desfaz).
const { SCHEMA } = require('../postgres');

const TABELAS = ['tb_reservas', 'tb_bloqueios', 'tb_regras_minimo'];

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    const q = (sql) => queryInterface.sequelize.query(sql);
    for (const t of TABELAS) {
      await q(`
        UPDATE ${SCHEMA}.${t} x SET espaco_id = (
          SELECT e.id FROM ${SCHEMA}.tb_espacos e WHERE e.sitio_id = x.sitio_id ORDER BY e.ordem, e.id LIMIT 1
        ) WHERE x.espaco_id IS NULL;
      `);
      await q(`ALTER TABLE ${SCHEMA}.${t} ALTER COLUMN espaco_id SET NOT NULL`);
    }
  },

  async down() {
    throw new Error('Não se desfaz automaticamente. Se precisar, rode manualmente: ALTER TABLE ... ALTER COLUMN espaco_id DROP NOT NULL.');
  }
};
