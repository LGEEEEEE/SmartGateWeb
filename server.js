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
let ultimoTempoNotificacao = 0; // Anti-Spam
let activeTokens = [];
let sseClients = [];

// Memória de QUEM abriu
let ultimoComandoOrigem = null; 
let timeoutComando = null;

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

    // 1. COMANDOS
    if (topic === TOPIC_COMMAND) {
        const partes = msg.split('|');
        if (partes.length >= 3) {
            const comando = partes[0];
            const usuario = partes[1]; 
            const dispositivo = partes[2]; 
            
            if (comando === "ABRIR_PORTAO_AGORA") {
                ultimoComandoOrigem = `${usuario} via ${dispositivo}`;
                console.log(`👤 Comando recebido de: ${ultimoComandoOrigem}`);
                if (timeoutComando) clearTimeout(timeoutComando);
                timeoutComando = setTimeout(() => { ultimoComandoOrigem = null; }, 40000);
            }
        }
    }

    // 2. STATUS
    if (topic === TOPIC_STATUS) {
        // Ignora status repetido (filtro básico)
        if (msg === ultimoEstadoConhecido) return;

        console.log(`📥 Status Recebido: ${msg}`);
        ultimoEstadoConhecido = msg;

        // Atualiza Frontend
        sseClients.forEach(c => c.res.write(`data: ${msg}\n\n`));

        // Verifica Notificação
        verificarENotificar(msg);
    }
});

// --- NOTIFICAÇÃO INTELIGENTE (CORRIGIDA) ---
function verificarENotificar(estado) {
    // CORREÇÃO CRÍTICA: Se não for um estado REAL, ignora.
    if (estado !== "ESTADO_REAL_ABERTO" && estado !== "ESTADO_REAL_FECHADO") return;
    
    if (estado === ultimoEstadoNotificado) return;

    // --- PROTEÇÃO ANTI-SPAM DE 3 SEGUNDOS ---
    const agora = Date.now();
    if (agora - ultimoTempoNotificacao < 3000) {
        console.log("🚫 Notificação bloqueada por ser muito rápida.");
        return;
    }

    let titulo = "";
    let mensagem = "";
    let tags = [];
    let origemTexto = "";
    let deveNotificar = false;
    
    if (estado === "ESTADO_REAL_ABERTO") {
        titulo = "Portão Aberto ⚠️";
        if (ultimoComandoOrigem) {
            origemTexto = `\n📱 Acionado por: ${ultimoComandoOrigem}`;
            ultimoComandoOrigem = null; 
            if (timeoutComando) clearTimeout(timeoutComando);
        } else {
            origemTexto = "\n🎮 Acionado por: Controle Remoto ou Manual";
        }
        mensagem = `O portão acabou de abrir.${origemTexto}`;
        tags = ["warning", "door"]; 
        deveNotificar = true;

    } else if (estado === "ESTADO_REAL_FECHADO") { 
        // AQUI ESTAVA O ERRO ANTES: AGORA USAMOS ELSE IF EXPLÍCITO
        titulo = "Portão Fechado 🔒";
        mensagem = "O portão foi fechado com segurança.";
        tags = ["white_check_mark", "lock"];
        deveNotificar = true;
    }

    if (deveNotificar) {
        ultimoEstadoNotificado = estado;
        ultimoTempoNotificacao = agora; 

        if (NTFY_TOPIC) {
            console.log(`🔔 Enviando Notificação: ${titulo}`);
            axios.post('https://ntfy.sh/', {
                topic: NTFY_TOPIC,
                title: titulo,
                message: mensagem,
                priority: 3, 
                tags: tags,
                click: "https://smartgateweb.onrender.com"
            })
            .catch(err => console.error("❌ Erro ntfy:", err.message));
        }
    }
}

// --- ROTAS HTTP ---
app.get('/events', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();
    const id = Date.now();
    sseClients.push({ id, res });
    res.write(`data: ${ultimoEstadoConhecido}\n\n`);
    req.on('close', () => { sseClients = sseClients.filter(c => c.id !== id); });
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
    let device = "Web";
    if (userAgent.includes("Android")) device = "Android";
    else if (userAgent.includes("iPhone")) device = "iPhone";
    else if (userAgent.includes("Windows")) device = "PC";

    const acao = req.body.comando_customizado || "ABRIR_PORTAO_AGORA";
    const payload = `${acao}|WebUser|${device}`;
    client.publish(TOPIC_COMMAND, payload);
    
    console.log(`📤 Comando API: ${payload}`);
    res.json({ success: true });
});

app.post('/api/admin/update', (req, res) => {
    const token = req.headers['authorization'];
    if (!activeTokens.includes(token)) return res.status(403).json({ error: "Acesso Negado." });
    console.log("🔄 ADMIN: Update OTA...");
    client.publish(TOPIC_COMMAND, "ATUALIZAR_FIRMWARE");
    sseClients.forEach(c => c.res.write(`data: STATUS_ATUALIZANDO_SISTEMA\n\n`));
    res.json({ success: true });
});

app.post('/api/logout', (req, res) => {
    const token = req.headers['authorization'];
    activeTokens = activeTokens.filter(t => t !== token);
    res.json({ success: true });
});

app.listen(PORT, () => console.log(`🚀 Smart Gate Server na porta ${PORT}`));