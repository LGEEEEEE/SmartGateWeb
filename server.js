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

// Memória de QUEM abriu
let ultimoComandoOrigem = null; 
let timeoutComando = null;

// --- NOVAS VARIÁVEIS DE PROTEÇÃO (ANTI-SPAM) ---
let ultimoTimestampMQTT = 0;          // Para filtrar ruído do sensor
let ultimaNotificacaoTimestamp = 0;   // Para não estourar a cota do ntfy
const DELAY_NOTIFICACAO = 10000;      // 10 segundos entre notificações no celular

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
    client.subscribe([TOPIC_STATUS, TOPIC_COMMAND], (err) => {
        if (!err) console.log("👂 Ouvindo comandos e status...");
    });
});

// --- RECEBIMENTO DE MENSAGENS ---
client.on('message', (topic, message) => {
    const msg = message.toString();

    // 1. SE FOR COMANDO (Vindo do App ou Site)
    if (topic === TOPIC_COMMAND) {
        const partes = msg.split('|');
        
        if (partes.length >= 3) {
            const usuario = partes[1]; // Ex: LG Admin
            const dispositivo = partes[2]; // Ex: iPhone 15 ou Android
            
            ultimoComandoOrigem = `${usuario} via ${dispositivo}`;
            console.log(`👤 Comando recebido de: ${ultimoComandoOrigem}`);

            if (timeoutComando) clearTimeout(timeoutComando);
            timeoutComando = setTimeout(() => {
                ultimoComandoOrigem = null;
            }, 40000);
        }
    }

    // 2. SE FOR STATUS (Vindo do ESP32/Portão)
    if (topic === TOPIC_STATUS) {
        
        // --- PROTEÇÃO 1: DEBOUNCE (Filtro de Ruído do Sensor) ---
        const agora = Date.now();
        const diferencaTempo = agora - ultimoTimestampMQTT;

        // Se a mensagem chegou em menos de 0.5s da anterior, é ruído/bouncing
        if (diferencaTempo < 500) {
            // console.log(`🚫 Ruído do sensor ignorado (${diferencaTempo}ms)`);
            return; 
        }
        
        ultimoTimestampMQTT = agora;
        // --------------------------------------------------------

        ultimoEstadoConhecido = msg;

        // Atualiza Frontend (SSE)
        sseClients.forEach(c => c.res.write(`data: ${msg}\n\n`));

        // Verifica Notificação Push
        verificarENotificar(msg);
    }
});

// --- FUNÇÃO DE NOTIFICAÇÃO ---
function verificarENotificar(estado) {
    // Valida se o estado é real
    if (estado !== "ESTADO_REAL_ABERTO" && estado !== "ESTADO_REAL_FECHADO") return;
    
    // Se o estado é o mesmo que já avisamos, ignora
    if (estado === ultimoEstadoNotificado) return;

    // --- PROTEÇÃO 2: RATE LIMIT (Cota do Ntfy) ---
    const agora = Date.now();
    if (agora - ultimaNotificacaoTimestamp < DELAY_NOTIFICACAO) {
        console.log("⏳ Notificação bloqueada para evitar spam (aguardando tempo mínimo)");
        return; 
    }
    // ---------------------------------------------

    let titulo = "";
    let mensagem = "";
    let tags = [];
    let origemTexto = "";
    
    if (estado === "ESTADO_REAL_ABERTO") {
        titulo = "Portão Aberto ⚠️";
        
        if (ultimoComandoOrigem) {
            origemTexto = `\n📱 Acionado por: ${ultimoComandoOrigem}`;
            ultimoComandoOrigem = null;
            if (timeoutComando) clearTimeout(timeoutComando);
        } else {
            origemTexto = "\n🎮 Acionado por: Controle Remoto/Manual";
        }

        mensagem = `O portão acabou de abrir.${origemTexto}`;
        tags = ["warning", "door"]; 

    } else {
        titulo = "Portão Fechado 🔒";
        mensagem = "O portão foi fechado.";
        tags = ["white_check_mark", "lock"];
    }

    // Atualiza controles ANTES de enviar para garantir
    ultimoEstadoNotificado = estado;
    ultimaNotificacaoTimestamp = agora;

    // ENVIO PARA O NTFY
    if (NTFY_TOPIC) {
        console.log(`🔔 Notificando: ${titulo}`);
        
        axios.post('https://ntfy.sh/', {
            topic: NTFY_TOPIC,
            title: titulo,
            message: mensagem,
            priority: 3, 
            tags: tags,
            click: "https://smartgateweb.onrender.com"
        })
        .catch(err => {
            console.error("❌ Erro ntfy:");
            if(err.response) console.error(err.response.data);
            else console.error(err.message);
        });
    }
}

// --- ROTAS HTTP (SITE/DASHBOARD) ---
app.get('/events', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();
    const id = Date.now();
    sseClients.push({ id, res });
    res.write(`data: ${ultimoEstadoConhecido}\n\n`);
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
    if (!activeTokens.includes(token)) return res.status(403).json({ error: "Sessão Expirada." });
    
    const userAgent = req.headers['user-agent'] || "Web";
    let device = "Navegador Web";
    if (userAgent.includes("Android")) device = "Android Web";
    else if (userAgent.includes("iPhone")) device = "iPhone Web";
    else if (userAgent.includes("Windows")) device = "PC Windows";

    const payload = `ABRIR_PORTAO_AGORA|WebUser|${device}`;
    
    client.publish(TOPIC_COMMAND, payload);
    
    res.json({ success: true });
});

app.post('/api/logout', (req, res) => {
    const token = req.headers['authorization'];
    activeTokens = activeTokens.filter(t => t !== token);
    res.json({ success: true });
});

app.listen(PORT, () => console.log(`🚀 Servidor Smart Gate na porta ${PORT}`));
