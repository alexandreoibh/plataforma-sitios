const express = require('express');
const router = express.Router();
const { param } = require('express-validator');
const PublicController = require('../controllers/publicController');
const validate = require('../helpers/validate');
const frontKeyGuard = require('../helpers/frontKeyGuard');

const controller = new PublicController();
const slug = param('slug').matches(/^[a-z0-9-]{2,60}$/).withMessage('Slug inválido.');

// GET /api/public/sitios/:slug — dados do sítio para o front (sem login)
router.get('/sitios/:slug', [slug], validate, controller.sitio.bind(controller));

// GET /api/public/sitios/:slug/disponibilidade?inicio=YYYY-MM&meses=2 — calendário do site
router.get('/sitios/:slug/disponibilidade', [slug], validate, controller.disponibilidade.bind(controller));

// POST /api/public/sitios/:slug/reservas — pedido de reserva. Grava sem login: só os fronts PHP (X-Front-Key)
router.post('/sitios/:slug/reservas', frontKeyGuard, [slug], validate, controller.criarReserva.bind(controller));

module.exports = router;
