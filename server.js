'use strict'
const app = require('./src/app');
const postgres = require('./src/database/postgres');
const port = process.env.PORT || 3002;

postgres.authenticate()
    .then(() => {
        console.log('PostgreSQL conectado com sucesso.');
        app.listen(port, () => {
            console.log(`API plataforma-sitios na porta ${port}`);
        });
    })
    .catch((error) => {
        console.error('Falha ao conectar no PostgreSQL:', error.message);
        process.exit(1);
    });
