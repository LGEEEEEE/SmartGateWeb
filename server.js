require('dotenv').config();

const express = require('express');
const mqtt = require('mqtt');
const crypto = require('crypto');
const axios = require('axios'); // <--- NOVA BIBLIOTECA
const app = express();

app.use(express.json());
app.use(express.static('public'));

const PORT = process.env.PORT || 3000;

// Variáveis de Ambiente
const MQTT_URL = process.env.MQTT_URL;
const MQTT_USER = process.env.MQTT_USER;
const MQTT_PASS = process.env.MQTT_PASS;
const APP_PASSWORD = process.env.APP_PASSWORD; 
const NTFY_TOPIC = process.env.NTFY_TOPIC; // <--- Tópico de notificação

const TOPIC_COMMAND = "projeto_LG/casa/portao";
const TOPIC_STATUS = "projeto_LG/casa/portao/status";

// Memória de Estado
let ultimoEstadoConhecido = "AGUARDANDO_ATUALIZACAO"; 
// Memória para evitar notificações repetidas
let ultimoEstadoNotificado = ""; 

let activeTokens = [];

// --- CONEXÃO MQTT ---
console.log("📡 Conectando ao Broker MQTT...");
const client = mqtt.connect(MQTT_URL, {
    username: MQTT_USER,
    password: MQTT_PASS,
    protocol: 'mqtts',
    rejectUnauthorized: false
});

client.on('connect', () => {
    console.log("✅ MQTT Conectado com Sucesso!");
    client.subscribe(TOPIC_STATUS);
});

let sseClients = [];

// --- RECEBIMENTO DE MENSAGENS E NOTIFICAÇÃO ---
client.on('message', (topic, message) => {
    if (topic === TOPIC_STATUS) {
        const msg = message.toString();
        ultimoEstadoConhecido = msg;

        // Avisa o Frontend (Site)
        sseClients.forEach(c => c.res.write(`data: ${msg}\n\n`));

        // --- LÓGICA DE NOTIFICAÇÃO PUSH ---
        verificarENotificar(msg);
    }
});

// Função para enviar notificação ao celular
function verificarENotificar(estado) {
    // Só queremos saber se ABRIR ou FECHAR (ignora 'ABRINDO'/'FECHANDO')
    if (estado !== "ESTADO_REAL_ABERTO" && estado !== "ESTADO_REAL_FECHADO") {
        return;
    }

    // Se o estado for igual ao último que já avisamos, não faz nada (evita spam)
    if (estado === ultimoEstadoNotificado) {
        return;
    }

    // Define a mensagem bonitinha
    let titulo = "";
    let mensagem = "";
    let tags = [];

    if (estado === "ESTADO_REAL_ABERTO") {
        titulo = "Portão Aberto ⚠️";
        mensagem = "Atenção: O portão da garagem acabou de abrir.";
        tags = ["warning", "door"]; // Ícones do ntfy
    } else {
        titulo = "Portão Fechado 🔒";
        mensagem = "Seguro: O portão foi fechado com sucesso.";
        tags = ["white_check_mark", "lock"];
    }

    // Atualiza memória para não repetir
    ultimoEstadoNotificado = estado;

    // Envia para o NTFY.sh
    if (NTFY_TOPIC) {
        console.log(`🔔 Enviando notificação: ${titulo}`);
        axios.post(`https://ntfy.sh/${NTFY_TOPIC}`, {
            topic: NTFY_TOPIC,
            title: titulo,
            message: mensagem,
            priority: 4, // Prioridade Alta (faz o celular vibrar/tocar)
            tags: tags
        })
        .catch(err => console.error("Erro ao enviar notificação:", err.message));
    }
}

// --- ROTAS DO APP (MANTIDAS IGUAIS) ---
app.get('/events', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();
    
    const id = Date.now();
    sseClients.push({ id, res });
    res.write(`data: ${ultimoEstadoConhecido}\n\n`); // Envia estado atual ao conectar

    req.on('close', () => sseClients = sseClients.filter(c => c.id !== id));
});

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

app.post('/api/acionar', (req, res) => {
    const token = req.headers['authorization'];
    if (!activeTokens.includes(token)) {
        return res.status(403).json({ error: "Sessão Expirada." });
    }
    const payload = `ABRIR_PORTAO_AGORA|WebUser|SessaoAtiva`;
    client.publish(TOPIC_COMMAND, payload);
    res.json({ success: true });
});

app.post('/api/logout', (req, res) => {
    const token = req.headers['authorization'];
    activeTokens = activeTokens.filter(t => t !== token);
    res.json({ success: true });
});

app.listen(PORT, () => console.log(`🚀 Servidor rodando na porta ${PORT}`));