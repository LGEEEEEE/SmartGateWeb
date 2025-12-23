const express = require('express');
const mqtt = require('mqtt');
const crypto = require('crypto'); // Para gerar tokens seguros
const app = express();

app.use(express.json());
app.use(express.static('public')); // Serve os arquivos da pasta public

const PORT = process.env.PORT || 3000;
// Variáveis de Ambiente
const MQTT_URL = process.env.MQTT_URL;
const MQTT_USER = process.env.MQTT_USER;
const MQTT_PASS = process.env.MQTT_PASS;
const APP_PASSWORD = process.env.APP_PASSWORD; 

const TOPIC_COMMAND = "projeto_LG/casa/portao";
const TOPIC_STATUS = "projeto_LG/casa/portao/status";

// Armazena tokens válidos na memória (Sessões ativas)
let activeTokens = [];

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

// SSE: Envia status para o site
let sseClients = [];
client.on('message', (topic, message) => {
    if (topic === TOPIC_STATUS) {
        const msg = message.toString();
        sseClients.forEach(c => c.res.write(`data: ${msg}\n\n`));
    }
});

app.get('/events', (req, res) => {
    // Validação simples: Só conecta no stream se tiver token na URL?
    // Para simplificar, deixamos o status aberto, mas o comando protegido.
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();
    const id = Date.now();
    sseClients.push({ id, res });
    req.on('close', () => sseClients = sseClients.filter(c => c.id !== id));
});

// --- ROTA DE LOGIN (Cria a Sessão) ---
app.post('/api/login', (req, res) => {
    const { password } = req.body;
    if (password === APP_PASSWORD) {
        // Gera um token aleatório
        const token = crypto.randomBytes(16).toString('hex');
        activeTokens.push(token);
        res.json({ success: true, token });
    } else {
        res.status(401).json({ success: false, error: "Senha Incorreta" });
    }
});

// --- ROTA DE ACIONAMENTO (Protegida pelo Token) ---
app.post('/api/acionar', (req, res) => {
    const token = req.headers['authorization']; // Pega o token do cabeçalho
    
    // Verifica se o token existe na lista de permitidos
    if (!activeTokens.includes(token)) {
        return res.status(403).json({ error: "Sessão Expirada. Faça login novamente." });
    }

    const payload = `ABRIR_PORTAO_AGORA|WebUser|SessaoAtiva`;
    client.publish(TOPIC_COMMAND, payload);
    res.json({ success: true });
});

// Rota para Logout
app.post('/api/logout', (req, res) => {
    const token = req.headers['authorization'];
    activeTokens = activeTokens.filter(t => t !== token); // Remove token
    res.json({ success: true });
});

app.listen(PORT, () => console.log(`Rodando na porta ${PORT}`));