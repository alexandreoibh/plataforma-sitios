'use strict';

// Espaços alugáveis de um sítio (o sítio em si, chalés, casas...). Cada reserva, bloqueio e regra de mínimo
// passa a pertencer a um espaço; espaços são independentes (ocupar um não afeta os outros).
// Os dados existentes vão para um espaço "principal" (slug 'sitio') criado para cada sítio.
// Compatível com PostgreSQL 9.2: sem ON CONFLICT nem CREATE INDEX IF NOT EXISTS (guardas com DO $$).
const { SCHEMA } = require('../postgres');

const NS = SCHEMA.replace(/"/g, '');
const TABELAS = ['tb_reservas', 'tb_bloqueios', 'tb_regras_minimo'];
const INDICES = {
  tb_reservas: ['ix_reservas_espaco_periodo', '(espaco_id, status, checkin, checkout)'],
  tb_bloqueios: ['ix_bloqueios_espaco_periodo', '(espaco_id, data_inicio, data_fim)'],
  tb_regras_minimo: ['ix_regras_minimo_espaco', '(espaco_id, data_inicio)'],
};

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    const q = (sql) => queryInterface.sequelize.query(sql);

    await q(`
      CREATE TABLE IF NOT EXISTS ${SCHEMA}.tb_espacos (
        id                SERIAL PRIMARY KEY,
        sitio_id          INTEGER      NOT NULL REFERENCES ${SCHEMA}.tb_sitios (id) ON DELETE CASCADE,
        slug              VARCHAR(60)  NOT NULL,
        nome              VARCHAR(120) NOT NULL,
        tipo              VARCHAR(20)  NOT NULL DEFAULT 'sitio' CHECK (tipo IN ('sitio', 'chale', 'casa', 'suite', 'outro')),
        descricao_curta   VARCHAR(255) NULL,
        endereco          VARCHAR(200) NULL,
        maps_query        VARCHAR(200) NULL,
        min_hospedes      SMALLINT     NOT NULL DEFAULT 1,
        max_hospedes      SMALLINT     NOT NULL DEFAULT 20,
        min_noites_padrao SMALLINT     NULL CHECK (min_noites_padrao BETWEEN 1 AND 30),
        ativo             BOOLEAN      NOT NULL DEFAULT true,
        ordem             SMALLINT     NOT NULL DEFAULT 0,
        criado_em         TIMESTAMP    NOT NULL DEFAULT now(),
        CHECK (max_hospedes >= min_hospedes),
        UNIQUE (sitio_id, slug),
        UNIQUE (id, sitio_id)
      );
    `);

    // Espaço principal de cada sítio que ainda não tem nenhum
    await q(`
      INSERT INTO ${SCHEMA}.tb_espacos (sitio_id, slug, nome, tipo, min_hospedes, max_hospedes, ordem)
      SELECT s.id, 'sitio', s.nome, 'sitio', s.min_hospedes, GREATEST(s.max_hospedes, s.min_hospedes), 0
        FROM ${SCHEMA}.tb_sitios s
       WHERE NOT EXISTS (SELECT 1 FROM ${SCHEMA}.tb_espacos e WHERE e.sitio_id = s.id);
    `);

    for (const t of TABELAS) {
      await q(`
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
             WHERE table_schema = '${NS}' AND table_name = '${t}' AND column_name = 'espaco_id'
          ) THEN
            ALTER TABLE ${SCHEMA}.${t} ADD COLUMN espaco_id INTEGER NULL;
          END IF;
        END $$;
      `);
      // Tudo o que já existe vai para o espaço principal (o de menor ordem/id) do sítio
      await q(`
        UPDATE ${SCHEMA}.${t} x SET espaco_id = (
          SELECT e.id FROM ${SCHEMA}.tb_espacos e WHERE e.sitio_id = x.sitio_id ORDER BY e.ordem, e.id LIMIT 1
        ) WHERE x.espaco_id IS NULL;
      `);
      await q(`ALTER TABLE ${SCHEMA}.${t} ALTER COLUMN espaco_id SET NOT NULL`);
      // FK composta: o espaço tem de ser do mesmo sítio do registro
      await q(`
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace
             WHERE c.conname = 'fk_${t}_espaco' AND n.nspname = '${NS}'
          ) THEN
            ALTER TABLE ${SCHEMA}.${t} ADD CONSTRAINT fk_${t}_espaco
              FOREIGN KEY (espaco_id, sitio_id) REFERENCES ${SCHEMA}.tb_espacos (id, sitio_id);
          END IF;
        END $$;
      `);
      const [nome, colunas] = INDICES[t];
      await q(`
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
             WHERE c.relname = '${nome}' AND n.nspname = '${NS}'
          ) THEN
            CREATE INDEX ${nome} ON ${SCHEMA}.${t} ${colunas};
          END IF;
        END $$;
      `);
    }
  },

  async down(queryInterface) {
    const q = (sql) => queryInterface.sequelize.query(sql);
    for (const t of TABELAS) {
      await q(`ALTER TABLE ${SCHEMA}.${t} DROP CONSTRAINT IF EXISTS fk_${t}_espaco`);
      await q(`DROP INDEX IF EXISTS ${SCHEMA}.${INDICES[t][0]}`);
      await q(`ALTER TABLE ${SCHEMA}.${t} DROP COLUMN IF EXISTS espaco_id`);
    }
    await q(`DROP TABLE IF EXISTS ${SCHEMA}.tb_espacos`);
  }
};
