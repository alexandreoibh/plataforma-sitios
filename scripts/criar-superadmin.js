'use strict';
// Cria (ou atualiza) um usuário super-admin da plataforma em tb_usuarios.
// Uso interativo: npm run superadmin   (pergunta nome, e-mail e senha; a senha não aparece na tela)
// Uso sem perguntas (scripts/testes): SA_NOME=... SA_EMAIL=... SA_SENHA=... npm run superadmin
require('dotenv').config();
const readline = require('readline');
const bcrypt = require('bcryptjs');
const { QueryTypes } = require('sequelize');
const postgres = require('../src/database/postgres');

const S = postgres.SCHEMA;

function perguntar(texto, oculto = false) {
    return new Promise((resolve) => {
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
        if (oculto) {
            // Não ecoa o que é digitado (mostra só a pergunta)
            rl._writeToOutput = function (s) { if (s.includes(texto)) rl.output.write(s); };
        }
        rl.question(texto, (resposta) => {
            if (oculto) process.stdout.write('\n');
            rl.close();
            resolve(resposta.trim());
        });
    });
}

async function main() {
    const nome = process.env.SA_NOME || await perguntar('Nome: ');
    const email = (process.env.SA_EMAIL || await perguntar('E-mail: ')).toLowerCase();
    let senha = process.env.SA_SENHA;
    if (!senha) {
        senha = await perguntar('Senha (mín. 8 caracteres): ', true);
        const confirma = await perguntar('Repita a senha: ', true);
        if (senha !== confirma) throw new Error('As senhas não conferem.');
    }
    if (nome.length < 2) throw new Error('Informe o nome.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('E-mail inválido.');
    if (senha.length < 8) throw new Error('A senha precisa ter 8 ou mais caracteres.');

    const hash = bcrypt.hashSync(senha, 10);
    await postgres.transaction(async (t) => {
        const q = (sql, replacements, type = QueryTypes.SELECT) => postgres.query(sql, { replacements, transaction: t, type });
        const [existe] = await q(`SELECT id FROM ${S}.tb_usuarios WHERE lower(email) = :email`, { email });
        if (existe) {
            await q(`UPDATE ${S}.tb_usuarios SET nome = :nome, senha_hash = :hash, super_admin = true, ativo = true WHERE id = :id`,
                { nome, hash, id: existe.id }, QueryTypes.UPDATE);
            console.log(`Super-admin ${email} atualizado (id ${existe.id}).`);
        } else {
            const [novo] = await q(`INSERT INTO ${S}.tb_usuarios (nome, email, senha_hash, super_admin, ativo)
                                    VALUES (:nome, :email, :hash, true, true) RETURNING id`, { nome, email, hash });
            console.log(`Super-admin ${email} criado (id ${novo.id}).`);
        }
    });
    await postgres.close();
}

main().catch(async (err) => {
    console.error('Não foi possível criar o super-admin:', err.message);
    try { await postgres.close(); } catch (e) { /* já fechado */ }
    process.exit(1);
});
