require('dotenv').config();

const express = require('express');
const mqtt = require('mqtt');
const crypto = require('crypto');
const axios = require('axios'); 
const app = express();

app.use(express.json());
app.use(express.static('public'));

const PORT = process.env.PORT || 3000;

// --- VARIÁVEIS DE AMBIENTE ---
const MQTT_URL = process.env.MQTT_URL;
const MQTT_USER = process.env.MQTT_USER;
const MQTT_PASS = process.env.MQTT_PASS;
const APP_PASSWORD = process.env.APP_PASSWORD; 
const NTFY_TOPIC = process.env.NTFY_TOPIC; 

// Tópicos MQTT
const TOPIC_COMMAND = "projeto_LG/casa/portao";
const TOPIC_STATUS = "projeto_LG/casa/portao/status";

// Memória de Estado
let ultimoEstadoConhecido = "AGUARDANDO_ATUALIZACAO"; 
let ultimoEstadoNotificado = ""; 
let activeTokens = [];
let sseClients = [];

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

// --- RECEBIMENTO DE MENSAGENS E NOTIFICAÇÃO ---
client.on('message', (topic, message) => {
    if (topic === TOPIC_STATUS) {
        const msg = message.toString();
        
        // Atualiza estado global
        ultimoEstadoConhecido = msg;

        // 1. Atualiza o Frontend em tempo real (quem está com o site aberto)
        sseClients.forEach(c => c.res.write(`data: ${msg}\n\n`));

        // 2. Verifica se precisa mandar Notificação Push
        verificarENotificar(msg);
    }
});

// --- FUNÇÃO DE NOTIFICAÇÃO (VERSÃO FINAL CORRIGIDA) ---
function verificarENotificar(estado) {
    // 1. Filtra estados irrelevantes
    if (estado !== "ESTADO_REAL_ABERTO" && estado !== "ESTADO_REAL_FECHADO") {
        return;
    }

    // 2. Evita spam (não manda se for igual ao último enviado)
    if (estado === ultimoEstadoNotificado) {
        return;
    }

    let titulo = "";
    let mensagem = "";
    let tags = [];

    if (estado === "ESTADO_REAL_ABERTO") {
        titulo = "Portão Aberto ⚠️";
        mensagem = "Atenção: O portão da garagem acabou de abrir.";
        tags = ["warning", "door"]; 
    } else {
        titulo = "Portão Fechado 🔒";
        mensagem = "Seguro: O portão foi fechado com sucesso.";
        tags = ["white_check_mark", "lock"];
    }

    // Atualiza a memória para não repetir
    ultimoEstadoNotificado = estado;

    // 3. Envio seguro via JSON para o NTFY
    if (NTFY_TOPIC) {
        console.log(`🔔 Enviando notificação para o tópico: ${NTFY_TOPIC}`);
        
        // POST para a raiz do ntfy.sh enviando o tópico no corpo
        // Isso garante que a formatação (título, emojis) funcione corretamente
        axios.post('https://ntfy.sh/', {
            topic: NTFY_TOPIC,
            title: titulo,
            message: mensagem,
            priority: 4, // Alta prioridade
            tags: tags,
            click: "https://smartgateweb.onrender.com" // <--- O PULO DO GATO AQUI
        })
        .then(() => console.log("✅ Notificação enviada com sucesso!"))
        .catch(err => {
            console.error("❌ Erro no envio da notificação:");
            if (err.response) {
                console.error(err.response.data);
            } else {
                console.error(err.message);
            }
        });
    }
}

// --- ROTAS DO SERVIDOR ---

// Rota SSE (Server-Sent Events) para o Frontend
app.get('/events', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();
    
    const id = Date.now();
    sseClients.push({ id, res });
    
    // Envia o estado atual imediatamente ao conectar
    res.write(`data: ${ultimoEstadoConhecido}\n\n`);

    req.on('close', () => {
        sseClients = sseClients.filter(c => c.id !== id);
    });
});

// Login
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

// Acionar Portão
app.post('/api/acionar', (req, res) => {
    const token = req.headers['authorization'];
    if (!activeTokens.includes(token)) {
        return res.status(403).json({ error: "Sessão Expirada." });
    }
    
    // Envia comando para o ESP32 via MQTT
    const payload = `ABRIR_PORTAO_AGORA|WebUser|SessaoAtiva`;
    client.publish(TOPIC_COMMAND, payload);
    
    res.json({ success: true });
});

// Logout
app.post('/api/logout', (req, res) => {
    const token = req.headers['authorization'];
    activeTokens = activeTokens.filter(t => t !== token);
    res.json({ success: true });
});

// --- INICIALIZAÇÃO ---
app.listen(PORT, () => console.log(`🚀 Servidor Smart Gate rodando na porta ${PORT}`));
