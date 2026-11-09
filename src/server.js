require('dotenv').config();
const express = require('express');
const path = require('path');
const routes = require('./routes/apiRoutes'); 
const { initMqtt } = require('./services/mqttService');
const { notificarSistema } = require('./services/notificationService');

const app = express();
const PORT = process.env.PORT || 3000;

// Trust Proxy é necessário se o servidor estiver atrás de Nginx (comum na Hostinger) para o rate limit pegar o IP real
app.set('trust proxy', 1);

app.use(express.json());
app.use(express.static(path.join(__dirname, '../public'))); 

app.use('/', routes);

initMqtt();

app.listen(PORT, () => {
    console.log(`🚀 Smart Home Hub rodando na porta ${PORT}`);
    notificarSistema(
        "Servidor Online 🚀", 
        `O Smart Home Hub acabou de ser reiniciado. Refaça sua sessão no sistema`, 
        ["rocket", "computer"]
    );
});