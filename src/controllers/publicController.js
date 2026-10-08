const { QueryTypes } = require('sequelize');
const postgres = require('../database/postgres');
const { occupiedNights, setting, maxBookingDate, validatePeriod } = require('../helpers/regras');
const { addMonths, hojeBR } = require('../helpers/datas');

const S = postgres.SCHEMA;
const sel = (sql, replacements, transaction) => postgres.query(sql, { replacements, type: QueryTypes.SELECT, transaction });

// Mesmas colunas que o painel recebe (datas como texto), para o front montar os e-mails com o mailer dele
const COLUNAS_RESERVA = `id, nome, email, telefone, checkin::text AS checkin, checkout::text AS checkout, hospedes, mensagem, status,
    pagamento_forma, pagamento_condicao, pagamento_parcelas, valor_total, entrada_paga, saldo_pago, criado_em, atualizado_em`;
// Anti-spam: pedidos pendentes do mesmo e-mail no mesmo sítio nas últimas 24h
const LIMITE_PEDIDOS_DIA = 5;

// Rotas públicas, consumidas pelos fronts PHP de cada sítio (sem login).
class PublicController {
    // Identidade do sítio exibida no site: nome, contatos, endereço, mapa e redes
    async sitio(req, res) {
        try {
            const sitio = await this._sitio(req.params.slug, true);
            if (!sitio) return res.status(404).json({ message: 'Sítio não encontrado.' });
            res.set('Cache-Control', 'public, max-age=300');
            return res.status(200).json(sitio);
        } catch (error) {
            console.error('[public.sitio]', error.message);
            return res.status(500).json({ message: 'Erro ao buscar o sítio.' });
        }
    }

    // GET /api/public/sitios/:slug/disponibilidade?inicio=YYYY-MM&meses=2
    // Mesmo formato do api/disponibilidade.php do front: noites ocupadas e regras de mínimo para o calendário
    async disponibilidade(req, res) {
        try {
            const sitio = await this._sitio(req.params.slug);
            if (!sitio) return res.status(404).json({ erro: 'Sítio não encontrado.' });
            const hoje = hojeBR();
            const inicio = /^\d{4}-(0[1-9]|1[0-2])$/.test(String(req.query.inicio || '')) ? `${req.query.inicio}-01` : `${hoje.slice(0, 7)}-01`;
            const meses = Math.max(1, Math.min(13, parseInt(req.query.meses, 10) || 2));
            const fim = addMonths(inicio, meses);
            const regras = await sel(
                `SELECT data_inicio::text AS inicio, data_fim::text AS fim, min_noites AS min
                   FROM ${S}.tb_regras_minimo WHERE sitio_id = :s ORDER BY data_inicio`, { s: sitio.id });
            res.set('Cache-Control', 'no-store');
            return res.status(200).json({
                ocupadas: [...await occupiedNights(sitio.id, inicio, fim)].sort(),
                hoje,
                maxData: await maxBookingDate(sitio.id),
                minPadrao: Number(await setting(sitio.id, 'min_noites_padrao')) || 1,
                regras,
            });
        } catch (error) {
            console.error('[public.disponibilidade]', error.message);
            return res.status(500).json({ erro: 'Sistema de reservas temporariamente indisponível.' });
        }
    }

    // POST /api/public/sitios/:slug/reservas — pedido do site (status pendente). Exige X-Front-Key (só os fronts PHP).
    // Validações iguais às do reservar.php; devolve todos os erros de uma vez em `erros` (o front mostra a lista).
    async criarReserva(req, res) {
        try {
            const sitio = await this._sitio(req.params.slug);
            if (!sitio) return res.status(404).json({ message: 'Sítio não encontrado.' });
            const b = req.body;
            const f = {
                checkin: String(b.checkin || ''),
                checkout: String(b.checkout || ''),
                hospedes: parseInt(b.hospedes, 10) || 0,
                nome: String(b.nome || '').trim(),
                email: String(b.email || '').trim(),
                telefone: String(b.telefone || '').trim(),
                mensagem: String(b.mensagem || '').trim(),
            };
            const erros = [];
            const errPeriodo = await validatePeriod(sitio.id, f.checkin, f.checkout);
            if (errPeriodo) erros.push(errPeriodo);
            if ([...f.nome].length < 3 || [...f.nome].length > 100) erros.push('Informe seu nome completo.');
            if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email) || f.email.length > 150) erros.push('Informe um e-mail válido.');
            const digitos = f.telefone.replace(/\D/g, '');
            if (digitos.length < 10 || digitos.length > 13 || f.telefone.length > 30) erros.push('Informe um telefone/WhatsApp com DDD.');
            if (f.hospedes < sitio.min_hospedes || f.hospedes > sitio.max_hospedes) {
                erros.push(`O número de hóspedes deve ser entre ${sitio.min_hospedes} e ${sitio.max_hospedes}.`);
            }
            if ([...f.mensagem].length > 1000) erros.push('A mensagem pode ter no máximo 1000 caracteres.');
            if (erros.length) return res.status(422).json({ message: erros[0], erros });

            const [{ n }] = await sel(
                `SELECT count(*)::int AS n FROM ${S}.tb_reservas
                  WHERE sitio_id = :s AND lower(email) = lower(:email) AND status = 'pendente' AND criado_em > now() - interval '1 day'`,
                { s: sitio.id, email: f.email });
            if (n >= LIMITE_PEDIDOS_DIA) {
                return res.status(429).json({ message: 'Você já enviou vários pedidos hoje. Aguarde o contato do proprietário ou fale pelo WhatsApp.' });
            }

            const [nova] = await sel(
                `INSERT INTO ${S}.tb_reservas (sitio_id, nome, email, telefone, checkin, checkout, hospedes, mensagem, status)
                 VALUES (:s, :nome, :email, :telefone, :checkin, :checkout, :hospedes, :mensagem, 'pendente')
                 RETURNING ${COLUNAS_RESERVA}`,
                { s: sitio.id, ...f, mensagem: f.mensagem || null });
            // O site manda os e-mails de "pedido recebido" (cliente e dono) com o mailer dele: precisa do remetente
            // e do destino configurados no sítio (rota só para os fronts, X-Front-Key)
            const configs = await sel(
                `SELECT chave, valor FROM ${S}.tb_configuracoes
                  WHERE sitio_id = :s AND chave IN ('email_remetente', 'email_notificacao', 'site_url')`, { s: sitio.id });
            const configuracoes = Object.fromEntries(configs.map((c) => [c.chave, c.valor]));
            return res.status(201).json({ reserva: nova, configuracoes });
        } catch (error) {
            console.error('[public.criarReserva]', error.message);
            return res.status(500).json({ message: 'Não foi possível registrar o pedido agora. Tente de novo ou fale pelo WhatsApp.' });
        }
    }

    // Só sítios ativos aparecem para o público
    async _sitio(slug, identidade = false) {
        const campos = identidade
            ? `slug, nome, slogan, telefone, whatsapp, email_contato, endereco, maps_query, instagram, facebook, min_hospedes, max_hospedes`
            : 'id, min_hospedes, max_hospedes';
        const [s] = await sel(`SELECT ${campos} FROM ${S}.tb_sitios WHERE slug = :slug AND status = 'ativo'`, { slug });
        return s || null;
    }
}

module.exports = PublicController;
