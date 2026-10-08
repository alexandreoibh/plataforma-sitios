const { QueryTypes } = require('sequelize');
const postgres = require('../database/postgres');

// Rotas públicas, consumidas pelos fronts PHP de cada sítio (sem login).
class PublicController {
    // Identidade do sítio exibida no site: nome, contatos, endereço, mapa e redes
    async sitio(req, res) {
        try {
            const [sitio] = await postgres.query(
                `SELECT slug, nome, slogan, telefone, whatsapp, email_contato, endereco, maps_query,
                        instagram, facebook, min_hospedes, max_hospedes
                   FROM ${postgres.SCHEMA}.tb_sitios
                  WHERE slug = :slug AND status = 'ativo'`,
                { replacements: { slug: req.params.slug }, type: QueryTypes.SELECT }
            );
            if (!sitio) {
                return res.status(404).json({ message: 'Sítio não encontrado.' });
            }
            res.set('Cache-Control', 'public, max-age=300');
            return res.status(200).json(sitio);
        } catch (error) {
            console.error('[public.sitio]', error.message);
            return res.status(500).json({ message: 'Erro ao buscar o sítio.' });
        }
    }
}

module.exports = PublicController;
