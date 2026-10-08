require('dotenv').config();

const useSSL = process.env.DB_SSL === 'true';

module.exports = {
    dialect: 'postgres',
    dialectModule: require('pg'),
    host: process.env.DB_HOST_SQL_POSTGRE,
    port: process.env.PORTA_SQL_POSTGRE,
    username: process.env.USER_SQL_POSTGRE,
    password: process.env.PASSWORD_SQL_POSTGRE,
    database: process.env.DATABASE_POSTGRE,
    logging: false,
    dialectOptions: useSSL
        ? { ssl: { require: true, rejectUnauthorized: false } }
        : {},
    define: {
        timestamp: true,
        underscored: true,
    },
};
