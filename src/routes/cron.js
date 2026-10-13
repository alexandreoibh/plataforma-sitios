const express = require('express');
const router = express.Router();
const CronController = require('../controllers/cronController');
const cronQueueKeyGuard = require('../helpers/cronQueueKeyGuard');

const cron = new CronController();

// Tarefas agendadas (Vercel Cron em vercel.json, ou manual com X-Cron-Queue-Key)
// ?sitio=<slug> só um sítio; ?forcar=1 ignora o "já lembrado hoje" (testes)
router.get('/lembrete-pendentes', cronQueueKeyGuard, cron.lembretePendentes.bind(cron));

module.exports = router;
