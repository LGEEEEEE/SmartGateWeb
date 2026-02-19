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

// --- TÓPICOS SEPARADOS E PADRONIZADOS ---
const TOPIC_STATUS_PORTAO = "projeto_LG/casa/portao/status";
const TOPIC_STATUS_BOMBA = "projeto_LG/casa/bomba/status"; 
const TOPIC_COMMAND = "projeto_LG/casa/portao";
const TOPIC_COMMAND_BOMBA = "projeto_LG/casa/bomba/cmd";

// --- MEMÓRIA E ESTADOS ---
let ultimoEstadoPortao = "AGUARDANDO"; 
let ultimoEstadoBomba = "AGUARDANDO"; 

let ultimoEstadoNotificado = ""; 
let ultimoTempoNotificacao = 0;
let ultimoComandoOrigem = null; 
let timeoutComando = null;

let activeSessions = {}; 
let sseClients = [];

// --- CONEXÃO MQTT ---
const client = mqtt.connect(MQTT_URL, {
    username: MQTT_USER, 
    password: MQTT_PASS,
    protocol: 'mqtts', 
    rejectUnauthorized: false
});

client.on('connect', () => {
    console.log("✅ MQTT Conectado ao HiveMQ");
    client.subscribe([TOPIC_STATUS_PORTAO, TOPIC_STATUS_BOMBA, TOPIC_COMMAND]);
});

client.on('message', (topic, message) => {
    const msg = message.toString();

    // LÓGICA DE STATUS DO PORTÃO
    if (topic === TOPIC_STATUS_PORTAO) {
        if (msg.includes("BOMBA")) return; // Prevenção contra sujeira de tópicos antigos

        if (msg === "STATUS_ATUALIZANDO_SISTEMA" || msg === "ERRO_ATUALIZACAO") {
            console.log(`\nOTA PORTÃO: ${msg}\n`);
            sseClients.forEach(c => c.res.write(`data: ${msg}\n\n`));
        }
        else if (msg !== ultimoEstadoPortao) {
            console.log(`🚪 Status Portão: ${msg}`);
            ultimoEstadoPortao = msg;
            sseClients.forEach(c => c.res.write(`data: ${msg}\n\n`));
            verificarENotificar(msg);
        }
    }
    // LÓGICA DE STATUS DA BOMBA
    else if (topic === TOPIC_STATUS_BOMBA) {
        if (msg !== ultimoEstadoBomba) {
            console.log(`💧 Status Bomba: ${msg}`);
            ultimoEstadoBomba = msg;
            sseClients.forEach(c => c.res.write(`data: ${msg}\n\n`));
        }
    }
    // RASTREIO DE QUEM ABRIU O PORTÃO
    else if (topic === TOPIC_COMMAND) {
        const partes = msg.split('|');
        if (partes[0] === "ABRIR_PORTAO_AGORA") {
            ultimoComandoOrigem = `${partes[1]} (${partes[2]})`;
            if (timeoutComando) clearTimeout(timeoutComando);
            timeoutComando = setTimeout(() => { ultimoComandoOrigem = null; }, 40000);
        }
    }
});

// --- SISTEMA DE NOTIFICAÇÕES PUSH (NTFY) ---
function verificarENotificar(estado) {
    if (estado !== "ESTADO_REAL_ABERTO" && estado !== "ESTADO_REAL_FECHADO") return;
    if (estado === ultimoEstadoNotificado) return;
    
    const agora = Date.now();
    if (agora - ultimoTempoNotificacao < 1000) return;

    let titulo = "", mensagem = "", tags = [];
    
    if (estado === "ESTADO_REAL_ABERTO") {
        titulo = "Portão Aberto ⚠️";
        let quem = ultimoComandoOrigem ? ultimoComandoOrigem : "Controle Remoto/Manual";
        mensagem = `O portão foi aberto por: ${quem}`;
        tags = ["warning", "door"]; 
    } else if (estado === "ESTADO_REAL_FECHADO") { 
        titulo = "Portão Fechado 🔒";
        mensagem = "Portão fechado com segurança.";
        tags = ["white_check_mark", "lock"];
    }

    ultimoEstadoNotificado = estado;
    ultimoTempoNotificacao = agora; 

    if (NTFY_TOPIC) {
        axios.post('https://ntfy.sh/', {
            topic: NTFY_TOPIC, title: titulo, message: mensagem,
            priority: 3, tags: tags, click: "https://smartgateweb.onrender.com"
        }).catch(e => console.error("Erro ao enviar notificação push via ntfy"));
    }
}

// --- ROTAS DA API ---

// 1. Server-Sent Events (SSE) para atualização em tempo real
app.get('/events', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();
    
    const id = Date.now();
    sseClients.push({ id, res });
    
    // Envia o último status conhecido imediatamente ao conectar
    res.write(`data: ${ultimoEstadoPortao}\n\n`);
    res.write(`data: ${ultimoEstadoBomba}\n\n`);
    
    req.on('close', () => { sseClients = sseClients.filter(c => c.id !== id); });
});

// 2. Autenticação
app.post('/api/login', (req, res) => {
    const { password, name } = req.body; 
    if (password === APP_PASSWORD) {
        const token = crypto.randomBytes(16).toString('hex');
        const userName = name || "Anônimo";
        activeSessions[token] = userName; 
        console.log(`🔑 Login: ${userName} entrou.`);
        res.json({ success: true, token });
    } else {
        res.status(401).json({ success: false, error: "Senha Incorreta" });
    }
});

// 3. Central de Acionamento (Portão e Bomba)
app.post('/api/acionar', (req, res) => {
    const token = req.headers['authorization'];
    if (!activeSessions[token]) return res.status(403).json({ error: "Sessão Expirada." });
    
    const usuarioNome = activeSessions[token];
    const userAgent = req.headers['user-agent'] || "";
    let device = "PC";
    if (userAgent.includes("Android")) device = "Android";
    else if (userAgent.includes("iPhone")) device = "iPhone";

    const dispositivo = req.body.dispositivo || "portao"; 
    const acao = req.body.comando_customizado || "ABRIR_PORTAO_AGORA";

    // LÓGICA SEPARADA: Bomba x Portão
    if (dispositivo === "bomba") {
        // Envia comando limpo (ex: LIGAR_BOMBA)
        client.publish(TOPIC_COMMAND_BOMBA, acao);
        console.log(`💧 Comando Bomba: [${acao}] por ${usuarioNome} (${device})`);
    } else {
        // Envia comando com metadados para o portão
        const payload = `${acao}|${usuarioNome}|${device}`;
        client.publish(TOPIC_COMMAND, payload);
        console.log(`📤 Comando Portão: [${acao}] de: ${usuarioNome} (${device})`);
    }
    
    res.json({ success: true });
});

// 4. OTA Firmware Update
app.post('/api/admin/update', (req, res) => {
    const token = req.headers['authorization'];
    if (!activeSessions[token]) return res.status(403).json({ error: "Acesso Negado." });
    
    console.log("\n🚀 OTA PORTÃO SOLICITADO\n");
    client.publish(TOPIC_COMMAND, "ATUALIZAR_FIRMWARE");
    sseClients.forEach(c => c.res.write(`data: STATUS_ATUALIZANDO_SISTEMA\n\n`));
    res.json({ success: true });
});

// --- INICIALIZAÇÃO ---
app.listen(PORT, () => console.log(`🚀 Smart Home Hub rodando na porta ${PORT}`));