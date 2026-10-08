'use strict';

// Compatível com PostgreSQL 9.2: sem jsonb, sem ON CONFLICT, sem CREATE INDEX IF NOT EXISTS.
const { SCHEMA } = require('../postgres');

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      CREATE TABLE IF NOT EXISTS ${SCHEMA}.tb_reservas (
        id                 SERIAL PRIMARY KEY,
        sitio_id           INTEGER       NOT NULL REFERENCES ${SCHEMA}.tb_sitios (id),
        nome               VARCHAR(100)  NOT NULL,
        email              VARCHAR(150)  NOT NULL,
        telefone           VARCHAR(30)   NOT NULL,
        checkin            DATE          NOT NULL,
        checkout           DATE          NOT NULL,
        hospedes           SMALLINT      NOT NULL,
        mensagem           TEXT          NULL,
        status             VARCHAR(20)   NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente', 'aprovada', 'recusada', 'cancelada')),
        observacao_admin   TEXT          NULL,
        pagamento_forma    VARCHAR(20)   NULL CHECK (pagamento_forma IN ('pix', 'credito', 'debito')),
        pagamento_condicao VARCHAR(20)   NULL CHECK (pagamento_condicao IN ('avista', '50_50')),
        pagamento_parcelas SMALLINT      NULL,
        valor_total        NUMERIC(10,2) NULL,
        entrada_paga       BOOLEAN       NOT NULL DEFAULT false,
        entrada_paga_em    DATE          NULL,
        saldo_pago         BOOLEAN       NOT NULL DEFAULT false,
        saldo_pago_em      DATE          NULL,
        aprovada_em        TIMESTAMP     NULL,
        criado_em          TIMESTAMP     NOT NULL DEFAULT now(),
        atualizado_em      TIMESTAMP     NOT NULL DEFAULT now(),
        CHECK (checkout > checkin)
      );
    `);
    await queryInterface.sequelize.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE c.relname = 'ix_reservas_periodo' AND n.nspname = '${SCHEMA.replace(/"/g, '')}'
        ) THEN
          CREATE INDEX ix_reservas_periodo ON ${SCHEMA}.tb_reservas (sitio_id, status, checkin, checkout);
        END IF;
      END $$;
    `);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`DROP TABLE IF EXISTS ${SCHEMA}.tb_reservas`);
  }
};
