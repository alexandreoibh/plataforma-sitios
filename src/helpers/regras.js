// Regras de disponibilidade, portadas de includes/availability.php do front PHP (a especificação).
// Uma reserva de A a B ocupa as noites A .. B-1; "noite ocupada" = reserva aprovada ou período bloqueado.
// Todas as funções recebem o sitio_id: nada aqui enxerga outro sítio.
const { QueryTypes } = require('sequelize');
const postgres = require('../database/postgres');
const { isYmd, addDays, addMonths, nightsBetween, hojeBR } = require('./datas');

const S = postgres.SCHEMA;
const sel = (sql, replacements, transaction) => postgres.query(sql, { replacements, type: QueryTypes.SELECT, transaction });

// Padrões iguais aos do PHP (setting('x', padrão))
const CONFIG_PADRAO = { min_noites_padrao: '1', meses_antecedencia: '12' };

async function setting(sitioId, chave, padrao = CONFIG_PADRAO[chave] ?? '', transaction) {
    const [r] = await sel(`SELECT valor FROM ${S}.tb_configuracoes WHERE sitio_id = :s AND chave = :c`, { s: sitioId, c: chave }, transaction);
    return r ? r.valor : padrao;
}

// Intervalos que ocupam noites no sítio e tocam [de, ate): reservas aprovadas [checkin, checkout) e
// bloqueios [data_inicio, data_fim + 1). Uma consulta só (o banco é remoto: cada ida custa caro).
async function intervalosOcupados(sitioId, de, ate, transaction) {
    return sel(
        `SELECT id AS reserva_id, checkin::text AS ini, checkout::text AS fim FROM ${S}.tb_reservas
          WHERE sitio_id = :s AND status = 'aprovada' AND checkin < :ate AND checkout > :de
         UNION ALL
         SELECT NULL, data_inicio::text, (data_fim + 1)::text FROM ${S}.tb_bloqueios
          WHERE sitio_id = :s AND data_inicio < :ate AND data_fim >= :de`,
        { s: sitioId, de, ate }, transaction
    );
}

/** Noites ocupadas em [de, ate), como Set de 'YYYY-MM-DD'. */
async function occupiedNights(sitioId, de, ate, ignorarReservaId = null, transaction) {
    const noites = new Set();
    for (const i of await intervalosOcupados(sitioId, de, ate, transaction)) {
        if (ignorarReservaId && Number(i.reserva_id) === Number(ignorarReservaId)) continue;
        let d = i.ini > de ? i.ini : de;
        const end = i.fim < ate ? i.fim : ate;
        while (d < end) { noites.add(d); d = addDays(d, 1); }
    }
    return noites;
}

async function periodHasConflict(sitioId, checkin, checkout, ignorarReservaId = null, transaction) {
    return (await intervalosOcupados(sitioId, checkin, checkout, transaction))
        .some((i) => !(ignorarReservaId && Number(i.reserva_id) === Number(ignorarReservaId)));
}

/**
 * Marca `conflito` em várias reservas com UMA consulta: conflita quem tem noite ocupada por outra
 * reserva aprovada ou por bloqueio (a própria reserva aprovada não conta).
 */
async function marcarConflitos(sitioId, reservas, transaction) {
    const alvo = reservas.filter((r) => ['pendente', 'aprovada'].includes(r.status));
    reservas.forEach((r) => { r.conflito = false; });
    if (!alvo.length) return reservas;
    const de = alvo.reduce((m, r) => (r.checkin < m ? r.checkin : m), alvo[0].checkin);
    const ate = alvo.reduce((m, r) => (r.checkout > m ? r.checkout : m), alvo[0].checkout);
    const ocupados = await intervalosOcupados(sitioId, de, ate, transaction);
    for (const r of alvo) {
        r.conflito = ocupados.some((i) => Number(i.reserva_id) !== Number(r.id) && i.ini < r.checkout && i.fim > r.checkin);
    }
    return reservas;
}

async function minNightsFor(sitioId, checkin, transaction) {
    const [r] = await sel(
        `SELECT MAX(min_noites) AS m FROM ${S}.tb_regras_minimo WHERE sitio_id = :s AND :d BETWEEN data_inicio AND data_fim`,
        { s: sitioId, d: checkin }, transaction
    );
    return Number(r && r.m) || Number(await setting(sitioId, 'min_noites_padrao', undefined, transaction)) || 1;
}

async function maxBookingDate(sitioId, transaction) {
    return addMonths(hojeBR(), Number(await setting(sitioId, 'meses_antecedencia', undefined, transaction)) || 12);
}

/** Validação completa de um pedido do site. Devolve a mensagem de erro ou null (mesmos textos do PHP). */
async function validatePeriod(sitioId, checkin, checkout, transaction) {
    if (!isYmd(checkin) || !isYmd(checkout)) return 'Selecione as datas de check-in e check-out no calendário.';
    if (checkin < hojeBR()) return 'A data de check-in já passou.';
    if (checkout <= checkin) return 'O check-out deve ser depois do check-in.';
    if (checkout > await maxBookingDate(sitioId, transaction)) return 'Ainda não abrimos reservas para esse período.';
    const min = await minNightsFor(sitioId, checkin, transaction);
    if (nightsBetween(checkin, checkout) < min) return `Para esse check-in o mínimo é de ${min} noites.`;
    if (await periodHasConflict(sitioId, checkin, checkout, null, transaction)) return 'O período escolhido não está mais disponível. Escolha outras datas.';
    return null;
}

module.exports = { setting, occupiedNights, periodHasConflict, marcarConflitos, minNightsFor, maxBookingDate, validatePeriod, CONFIG_PADRAO };
