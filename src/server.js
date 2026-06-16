require('dotenv').config();
const express = require('express');
const path = require('path');

// Corrija os caminhos tirando o "/src" se necessário
const routes = require('./routes/apiRoutes'); 
const { initMqtt } = require('./services/mqttService');
// Importando a nova função!
const { verificarENotificar, notificarSistema } = require('./services/notificationService');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, '../public'))); 

app.use('/', routes);

initMqtt();

app.listen(PORT, () => {
    console.log(`🚀 Smart Home Hub rodando na porta ${PORT}`);
    
    // Dispara a notificação de servidor online!
    notificarSistema(
        "Servidor Online 🚀", 
        `O Smart Home Hub acabou de ser reiniciado. Refaça sua sessão no sistema`, 
        ["rocket", "computer"]
    );
});