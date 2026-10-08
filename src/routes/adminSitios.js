const express = require('express');
const router = express.Router();
const { body, param } = require('express-validator');
const SitioAdminController = require('../controllers/sitioAdminController');
const validate = require('../helpers/validate');
const auth = require('../helpers/auth');
const { requireSuperAdmin } = require('../helpers/auth');

const controller = new SitioAdminController();

const URL_RE = /^https?:\/\/\S+$/i;
const opcional = (campo) => body(campo).optional({ nullable: true, checkFalsy: true });

// Regras do cadastro (criar e atualizar)
const regrasSitio = [
    body('slug').isString().trim().toLowerCase().matches(/^[a-z0-9-]{2,60}$/)
        .withMessage('Slug: só letras minúsculas, números e hífen (2 a 60).'),
    body('nome').isString().trim().isLength({ min: 2, max: 120 }).withMessage('Informe o nome (2 a 120 caracteres).'),
    opcional('slogan').isString().isLength({ max: 150 }).withMessage('Slogan: até 150 caracteres.'),
    opcional('telefone').isString().isLength({ max: 30 }).withMessage('Telefone: até 30 caracteres.'),
    opcional('whatsapp').custom((v) => /^\d{10,15}$/.test(String(v).replace(/\D/g, '')))
        .withMessage('WhatsApp: 10 a 15 dígitos com DDI e DDD (ex.: 5531999999999).'),
    opcional('email_contato').isEmail().withMessage('E-mail de contato inválido.'),
    opcional('endereco').isString().isLength({ max: 200 }).withMessage('Endereço: até 200 caracteres.'),
    opcional('maps_query').isString().isLength({ max: 200 }).withMessage('Ponto do mapa: até 200 caracteres.'),
    opcional('instagram').matches(URL_RE).withMessage('Instagram: informe o link completo (https://...).'),
    opcional('facebook').matches(URL_RE).withMessage('Facebook: informe o link completo (https://...).'),
    body('dominios').optional().isArray({ max: 10 }).withMessage('Domínios: lista de até 10.'),
    body('dominios.*').optional().matches(/^[a-z0-9.-]+\.[a-z]{2,}$/i).withMessage('Domínio inválido (ex.: meusitio.com.br).'),
    body('min_hospedes').isInt({ min: 1, max: 200 }).withMessage('Mínimo de hóspedes: 1 a 200.'),
    body('max_hospedes').isInt({ min: 1, max: 200 }).withMessage('Máximo de hóspedes: 1 a 200.')
        .custom((v, { req }) => Number(v) >= Number(req.body.min_hospedes)).withMessage('O máximo não pode ser menor que o mínimo.'),
    body('status').optional().isIn(['ativo', 'suspenso', 'inativo']).withMessage('Status inválido.'),
];
const regraId = [param('id').isInt({ min: 1 }).withMessage('Id inválido.')];

router.get('/', auth, requireSuperAdmin, controller.listar.bind(controller));
router.get('/:id', auth, requireSuperAdmin, regraId, validate, controller.buscar.bind(controller));
router.post('/', auth, requireSuperAdmin, regrasSitio, validate, controller.criar.bind(controller));
router.put('/:id', auth, requireSuperAdmin, [...regraId, ...regrasSitio], validate, controller.atualizar.bind(controller));

module.exports = router;
