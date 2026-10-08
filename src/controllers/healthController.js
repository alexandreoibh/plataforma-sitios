const { QueryTypes } = require('sequelize');
const postgres = require('../database/postgres');

class HealthController {
    async status(req, res) {
        return res.status(200).json({ status: 'ok', service: 'plataforma-sitios' });
    }

    // Confere conexão, versão do Postgres e as tabelas do schema da plataforma
    async database(req, res) {
        try {
            const [versao] = await postgres.query('SELECT version() AS versao', { type: QueryTypes.SELECT });
            const tabelas = await postgres.query(
                `SELECT table_name FROM information_schema.tables WHERE table_schema = :schema ORDER BY table_name`,
                { replacements: { schema: postgres.SCHEMA.replace(/"/g, '') }, type: QueryTypes.SELECT }
            );
            return res.status(200).json({
                status: 'ok',
                versao: versao.versao,
                schema: postgres.SCHEMA,
                tabelas: tabelas.map((t) => t.table_name),
            });
        } catch (error) {
            return res.status(500).json({ status: 'erro', message: error.message });
        }
    }
}

module.exports = HealthController;
