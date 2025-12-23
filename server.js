const express = require('express');
const mqtt = require('mqtt');
const crypto = require('crypto');
const app = express();

app.use(express.json());
app.use(express.static('public'));

const PORT = process.env.PORT || 3000;

// Variáveis de Ambiente (Configure no seu .env ou sistema)
const MQTT_URL = process.env.MQTT_URL;
const MQTT_USER = process.env.MQTT_USER;
const MQTT_PASS = process.env.MQTT_PASS;
const APP_PASSWORD = process.env.APP_PASSWORD; 

const TOPIC_COMMAND = "projeto_LG/casa/portao";
const TOPIC_STATUS = "projeto_LG/casa/portao/status";

let activeTokens = [];
// MEMÓRIA DE ESTADO: Começa assumindo fechado até receber info real
let lastStatus = "ESTADO_REAL_FECHADO"; 

// --- CONEXÃO MQTT ---
const client = mqtt.connect(MQTT_URL, {
    username: MQTT_USER,
    password: MQTT_PASS,
    protocol: 'mqtts',
    rejectUnauthorized: false
});

client.on('connect', () => {
    console.log("✅ MQTT Conectado!");
    client.subscribe(TOPIC_STATUS);
});

// Lista de clientes conectados no site (SSE)
let sseClients = [];

client.on('message', (topic, message) => {
    if (topic === TOPIC_STATUS) {
        const msg = message.toString();
        lastStatus = msg; // Atualiza a memória do servidor
        
        // Espalha a fofoca para todos os celulares conectados
        sseClients.forEach(c => c.res.write(`data: ${msg}\n\n`));
    }
});

// --- ROTA DE EVENTOS (SSE) ---
app.get('/events', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();
    
    // O PULO DO GATO: Envia o status atual IMEDIATAMENTE ao conectar
    res.write(`data: ${lastStatus}\n\n`);

    const id = Date.now();
    sseClients.push({ id, res });

    req.on('close', () => {
        sseClients = sseClients.filter(c => c.id !== id);
    });
});

// --- ROTA DE LOGIN ---
app.post('/api/login', (req, res) => {
    const { password } = req.body;
    if (password === APP_PASSWORD) {
        const token = crypto.randomBytes(16).toString('hex');
        activeTokens.push(token);
        res.json({ success: true, token });
    } else {
        res.status(401).json({ success: false, error: "Senha Incorreta" });
    }
});

// --- ROTA DE ACIONAMENTO ---
app.post('/api/acionar', (req, res) => {
    const token = req.headers['authorization'];
    
    if (!activeTokens.includes(token)) {
        return res.status(403).json({ error: "Sessão Expirada" });
    }

    // Envia comando para o ESP32
    const payload = `ABRIR_PORTAO_AGORA|WebUser|${Date.now()}`;
    client.publish(TOPIC_COMMAND, payload);
    
    res.json({ success: true });
});

// Rota Logout
app.post('/api/logout', (req, res) => {
    const token = req.headers['authorization'];
    activeTokens = activeTokens.filter(t => t !== token);
    res.json({ success: true });
});

app.listen(PORT, () => console.log(`🚀 Servidor rodando na porta ${PORT}`));