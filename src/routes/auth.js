const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const AuthController = require('../controllers/authController');
const validate = require('../helpers/validate');
const auth = require('../helpers/auth');
const frontKeyGuard = require('../helpers/frontKeyGuard');

const controller = new AuthController();

// POST /api/auth/login
router.post(
    '/login',
    [
        body('email').isEmail().withMessage('Informe um e-mail válido.'),
        body('senha').isString().notEmpty().withMessage('Informe a senha.'),
    ],
    validate,
    controller.login.bind(controller)
);

// POST /api/auth/sitio — troca o sítio ativo (devolve token novo)
router.post(
    '/sitio',
    auth,
    [body('sitio_id').isInt({ min: 1 }).withMessage('Sítio inválido.')],
    validate,
    controller.escolherSitio.bind(controller)
);

// Esqueci minha senha: só os servidores PHP (o painel gera o e-mail com o link)
router.post('/senha/esqueci', frontKeyGuard, [
    body('email').isEmail().withMessage('Informe um e-mail válido.'),
    body('slug').matches(/^[a-z0-9-]{2,60}$/).withMessage('Slug inválido.'),
], validate, controller.esqueciSenha.bind(controller));
router.post('/senha/validar', frontKeyGuard, [body('token').isString()], validate, controller.validarToken.bind(controller));
router.post('/senha/redefinir', frontKeyGuard, [
    body('token').isString(),
    body('senha').isString().isLength({ min: 8, max: 72 }).withMessage('A nova senha precisa ter 8 ou mais caracteres.'),
], validate, controller.redefinirSenha.bind(controller));

module.exports = router;
