const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const AuthController = require('../controllers/authController');
const validate = require('../helpers/validate');

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

module.exports = router;
