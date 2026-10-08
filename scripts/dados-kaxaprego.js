// Dados do 2º sítio (Sítio Kaxaprego) — vieram do config.php e do data/property.php do front PHP.
// E-mail, Instagram e Facebook ainda não existem: ficam vazios (o site esconde) até o super-admin preencher em Sítios.
// Usado por cadastrar-sitio.js (npm run sitio -- kaxaprego).
module.exports = {
    slug: 'kaxaprego',
    nome: 'Sítio Kaxaprego',
    slogan: 'Sítio com piscina aquecida para até 15 pessoas',
    dominios: ['sitiokaxaprego-serradocipo.com.br', 'www.sitiokaxaprego-serradocipo.com.br'],
    telefone: '(31) 8990-6973',
    whatsapp: '553189906973',
    email_contato: null,
    endereco: 'São José da Serra — Jaboticatubas/MG',
    maps_query: 'São José da Serra, estrada principal, condomínio Zé Pedro, Jaboticatubas - MG',
    instagram: null,
    facebook: null,
    min_hospedes: 5,
    max_hospedes: 15,
    // Configurações iniciais (só gravadas se o sítio ainda não tiver); o remetente de e-mail o dono define no painel
    configuracoes: {
        min_noites_padrao: '2',
        meses_antecedencia: '12',
        site_url: 'https://sitiokaxaprego-serradocipo.com.br',
    },
};
