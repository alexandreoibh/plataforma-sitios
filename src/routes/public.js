const express = require('express');
const router = express.Router();
const { param } = require('express-validator');
const PublicController = require('../controllers/publicController');
const validate = require('../helpers/validate');

const controller = new PublicController();

// GET /api/public/sitios/:slug — dados do sítio para o front (sem login)
router.get(
    '/sitios/:slug',
    [
        param('slug')
            .matches(/^[a-z0-9-]{2,60}$/)
            .withMessage('Slug inválido.'),
    ],
    validate,
    controller.sitio.bind(controller)
);

module.exports = router;
