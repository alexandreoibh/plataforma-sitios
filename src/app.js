const express = require('express');
const bodyparser = require('body-parser');
const cors = require('cors');
const app = express();

require('dotenv').config();

// Quem chama a API são os fronts PHP (servidor → servidor) e o navegador nas telas públicas
app.use(cors({
    origin: '*',
    optionsSuccessStatus: 204,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
}));

const healthRoute = require('./routes/health');
const publicRoute = require('./routes/public');
const authRoute = require('./routes/auth');
const adminSitiosRoute = require('./routes/adminSitios');

app.use(bodyparser.json());
app.use(bodyparser.urlencoded({ extended: false }));

app.use('/api/health', healthRoute);
app.use('/api/public', publicRoute);
app.use('/api/auth', authRoute);
app.use('/api/admin/sitios', adminSitiosRoute);

app.use((error, req, res, next) => {
    res.status(error.status || 500);
    res.json({ error: error.message });
});

module.exports = app;
