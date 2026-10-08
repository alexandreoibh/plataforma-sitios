const express = require('express');
const router = express.Router();
const HealthController = require('../controllers/healthController');
const cronQueueKeyGuard = require('../helpers/cronQueueKeyGuard');

const health = new HealthController();

router.get('/', health.status.bind(health));
// Diagnóstico do banco (versão e tabelas): não fica público
router.get('/db', cronQueueKeyGuard, health.database.bind(health));

module.exports = router;
