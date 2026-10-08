const bcrypt = require('bcryptjs');
const { QueryTypes } = require('sequelize');
const postgres = require('../database/postgres');
const { signToken } = require('../helpers/auth');

class AuthController {
    // POST /api/auth/login — { email, senha } → { token, usuario }
    async login(req, res) {
        try {
            const email = String(req.body.email).trim().toLowerCase();
            const [u] = await postgres.query(
                `SELECT id, nome, email, senha_hash, super_admin, ativo FROM ${postgres.SCHEMA}.tb_usuarios WHERE lower(email) = :email`,
                { replacements: { email }, type: QueryTypes.SELECT }
            );
            if (!u || !u.ativo || !bcrypt.compareSync(String(req.body.senha), u.senha_hash)) {
                await new Promise((r) => setTimeout(r, 1000)); // freia tentativas em sequência
                return res.status(401).json({ message: 'E-mail ou senha incorretos.' });
            }
            await postgres.query(`UPDATE ${postgres.SCHEMA}.tb_usuarios SET ultimo_acesso = now() WHERE id = :id`,
                { replacements: { id: u.id }, type: QueryTypes.UPDATE });

            const token = signToken({ id: u.id, email: u.email, super_admin: u.super_admin === true });
            return res.status(200).json({
                token,
                usuario: { id: u.id, nome: u.nome, email: u.email, super_admin: u.super_admin === true },
            });
        } catch (error) {
            console.error('[auth.login]', error.message);
            return res.status(error.status || 500).json({ message: error.status ? error.message : 'Erro ao entrar.' });
        }
    }
}

module.exports = AuthController;
