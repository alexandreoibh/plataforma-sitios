// Datas como texto 'YYYY-MM-DD' (como o PHP e as colunas DATE). Contas em UTC puro para não sofrer com fuso.
const YMD = /^\d{4}-\d{2}-\d{2}$/;

const toUtc = (ymd) => {
    const [y, m, d] = ymd.split('-').map(Number);
    return Date.UTC(y, m - 1, d);
};
const fromUtc = (ms) => new Date(ms).toISOString().slice(0, 10);

// Data válida de verdade (rejeita 2026-02-30)
const isYmd = (s) => typeof s === 'string' && YMD.test(s) && fromUtc(toUtc(s)) === s;

const addDays = (ymd, n) => fromUtc(toUtc(ymd) + n * 86400000);
const addMonths = (ymd, n) => {
    const [y, m, d] = ymd.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1 + n, 1));
    const last = new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() + 1, 0)).getUTCDate();
    dt.setUTCDate(Math.min(d, last));
    return fromUtc(dt.getTime());
};
const nightsBetween = (a, b) => Math.round((toUtc(b) - toUtc(a)) / 86400000);

// "Hoje" no horário de Brasília (UTC-3, sem horário de verão)
const hojeBR = () => fromUtc(Date.now() - 3 * 3600000);

const formatBR = (ymd) => ymd.split('-').reverse().join('/');

module.exports = { isYmd, addDays, addMonths, nightsBetween, hojeBR, formatBR };
