// Rotas do painel de um sítio. Todas: token (auth) + sítio ativo com vínculo conferido no banco (requireSitio).
// O sitio_id vem SEMPRE do token — nenhuma rota aceita sitio_id no body/query.
const express = require('express');
const router = express.Router();
const { body, param, query } = require('express-validator');
const validate = require('../helpers/validate');
const auth = require('../helpers/auth');
const { requireSitio, requireAdmin } = require('../helpers/auth');
const { isYmd } = require('../helpers/datas');
const ReservaController = require('../controllers/reservaController');
const BloqueioController = require('../controllers/bloqueioController');
const ConfiguracaoController = require('../controllers/configuracaoController');
const PainelController = require('../controllers/painelController');

const reservas = new ReservaController();
const bloqueios = new BloqueioController();
const configs = new ConfiguracaoController();
const painel = new PainelController();

router.use(auth, requireSitio);

const id = (nome = 'id') => param(nome).isInt({ min: 1, max: 2147483647 }).withMessage('Id inválido.');
const data = (campo, msg) => body(campo).custom(isYmd).withMessage(msg);
const dataQuery = (campo) => query(campo).optional().custom(isYmd).withMessage(`${campo}: data inválida (AAAA-MM-DD).`);
const opcional = (campo) => body(campo).optional({ nullable: true, checkFalsy: true });
const perfil = (opt) => (opt ? body('perfil').optional() : body('perfil')).isIn(['admin', 'operador']).withMessage('Perfil: admin ou operador.');

// Contexto e Meus dados
router.get('/contexto', painel.contexto.bind(painel));
router.put('/perfil', [
    body('nome').isString().trim().isLength({ min: 2, max: 100 }).withMessage('Informe seu nome.'),
    body('email').isString().trim().isEmail().withMessage('Informe um e-mail válido.'),
    opcional('telefone').isString().isLength({ max: 30 }).withMessage('Telefone: até 30 caracteres.'),
], validate, painel.salvarPerfil.bind(painel));
router.put('/perfil/senha', [
    body('atual').isString().notEmpty().withMessage('Informe a senha atual.'),
    body('nova').isString().isLength({ min: 8, max: 72 }).withMessage('A nova senha precisa ter 8 ou mais caracteres.'),
], validate, painel.trocarSenha.bind(painel));

// Reservas
router.get('/reservas', [dataQuery('de'), dataQuery('ate'), dataQuery('checkout_apos')], validate, reservas.listar.bind(reservas));
router.get('/reservas/:id', [id()], validate, reservas.buscar.bind(reservas));
router.post('/reservas/:id/:acao(aprovar|recusar|cancelar)', [
    id(),
    opcional('observacao').isString().isLength({ max: 2000 }).withMessage('Observação: até 2000 caracteres.'),
], validate, reservas.mudarStatus.bind(reservas));
router.put('/reservas/:id/pagamento', [id()], validate, reservas.atualizarPagamento.bind(reservas));
router.post('/reservas/:id/recebimento', [
    id(),
    body('tipo').isIn(['entrada', 'saldo']).withMessage('Tipo: entrada ou saldo.'),
    body('data').optional().custom(isYmd).withMessage('Data inválida.'),
], validate, requireAdmin, reservas.marcarRecebido.bind(reservas));

// Bloqueios
router.get('/bloqueios', [dataQuery('de'), dataQuery('ate')], validate, bloqueios.listar.bind(bloqueios));
router.post('/bloqueios', [
    data('data_inicio', 'Informe a data inicial.'),
    data('data_fim', 'Informe a data final.'),
    opcional('motivo').isString().isLength({ max: 120 }).withMessage('Motivo: até 120 caracteres.'),
], validate, bloqueios.criar.bind(bloqueios));
router.delete('/bloqueios/:id', [id()], validate, bloqueios.remover.bind(bloqueios));

// Configurações e regras de mínimo (admin)
router.get('/configuracoes', configs.listar.bind(configs));
router.put('/configuracoes/gerais', requireAdmin, [
    body('min_noites_padrao').isInt({ min: 1, max: 30 }).withMessage('Mínimo de noites: 1 a 30.'),
    body('meses_antecedencia').isInt({ min: 1, max: 24 }).withMessage('Antecedência: 1 a 24 meses.'),
], validate, configs.salvarGerais.bind(configs));
router.put('/configuracoes/email', requireAdmin, [
    body('email_remetente').isString().trim().isEmail().withMessage('E-mail remetente inválido.'),
    body('email_notificacao').isString().trim().isEmail().withMessage('E-mail de notificação inválido.'),
    opcional('site_url').matches(/^https?:\/\/\S+$/i).withMessage('O endereço do site deve começar com http:// ou https://.'),
], validate, configs.salvarEmail.bind(configs));
router.get('/regras-minimo', configs.listarRegras.bind(configs));
router.post('/regras-minimo', requireAdmin, [
    data('data_inicio', 'Informe a data inicial.'),
    data('data_fim', 'Informe a data final.'),
    body('min_noites').isInt({ min: 1, max: 30 }).withMessage('Mínimo entre 1 e 30 noites.'),
    opcional('descricao').isString().isLength({ max: 80 }).withMessage('Descrição: até 80 caracteres.'),
], validate, configs.criarRegra.bind(configs));
router.delete('/regras-minimo/:id', requireAdmin, [id()], validate, configs.removerRegra.bind(configs));

// Usuários do sítio (admin)
router.get('/usuarios', requireAdmin, painel.listarUsuarios.bind(painel));
router.post('/usuarios', requireAdmin, [
    body('email').isString().trim().isEmail().withMessage('Informe um e-mail válido.'),
    perfil(false),
    opcional('nome').isString().trim().isLength({ max: 100 }).withMessage('Nome: até 100 caracteres.'),
    opcional('senha').isString().isLength({ max: 72 }).withMessage('Senha: até 72 caracteres.'),
], validate, painel.adicionarUsuario.bind(painel));
router.put('/usuarios/:usuarioId', requireAdmin, [
    id('usuarioId'),
    perfil(true),
    body('ativo').optional().isBoolean().withMessage('Ativo: true ou false.').toBoolean(),
    body('nome').optional().isString().trim().isLength({ min: 2, max: 100 }).withMessage('Informe o nome.'),
    body('email').optional().isString().trim().isEmail().withMessage('Informe um e-mail válido.'),
], validate, painel.alterarUsuario.bind(painel));
router.delete('/usuarios/:usuarioId', requireAdmin, [id('usuarioId')], validate, painel.removerUsuario.bind(painel));
router.post('/usuarios/:usuarioId/senha', requireAdmin, [id('usuarioId')], validate, painel.redefinirSenhaUsuario.bind(painel));

module.exports = router;
