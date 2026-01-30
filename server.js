require('dotenv').config();
const express = require('express');
const mqtt = require('mqtt');
const crypto = require('crypto');
const axios = require('axios'); 
const app = express();

app.use(express.json());
app.use(express.static('public'));

const PORT = process.env.PORT || 3000;

// Variáveis
const MQTT_URL = process.env.MQTT_URL;
const MQTT_USER = process.env.MQTT_USER;
const MQTT_PASS = process.env.MQTT_PASS;
const APP_PASSWORD = process.env.APP_PASSWORD; 
const NTFY_TOPIC = process.env.NTFY_TOPIC; 

// Tópicos
const TOPIC_COMMAND = "projeto_LG/casa/portao";
const TOPIC_STATUS = "projeto_LG/casa/portao/status";

// --- MEMÓRIA ---
let ultimoEstadoConhecido = "AGUARDANDO"; 
let ultimoEstadoNotificado = ""; 
let ultimoTempoNotificacao = 0;
let ultimoComandoOrigem = null; 
let timeoutComando = null;

let activeSessions = {}; 
let sseClients = [];

// MQTT Conexão
const client = mqtt.connect(MQTT_URL, {
    username: MQTT_USER, password: MQTT_PASS,
    protocol: 'mqtts', rejectUnauthorized: false
});

client.on('connect', () => {
    console.log("✅ MQTT Conectado");
    client.subscribe([TOPIC_STATUS, TOPIC_COMMAND]);
});

client.on('message', (topic, message) => {
    const msg = message.toString();

    if (topic === TOPIC_COMMAND) {
        const partes = msg.split('|');
        if (partes.length >= 3 && partes[0] === "ABRIR_PORTAO_AGORA") {
            ultimoComandoOrigem = `${partes[1]} (${partes[2]})`;
            if (timeoutComando) clearTimeout(timeoutComando);
            timeoutComando = setTimeout(() => { ultimoComandoOrigem = null; }, 40000);
        }
    }

    if (topic === TOPIC_STATUS) {
        // Envia TUDO para o Front-end imediatamente (para a animação fluir)
        sseClients.forEach(c => c.res.write(`data: ${msg}\n\n`));
        
        // Verifica se deve notificar no celular
        if (msg !== ultimoEstadoConhecido) {
            ultimoEstadoConhecido = msg;
            verificarENotificar(msg);
        }
    }
});

function verificarENotificar(estado) {
    // SÓ NOTIFICA SE FOR REAL (Blindagem contra estados intermediários)
    if (estado !== "ESTADO_REAL_ABERTO" && estado !== "ESTADO_REAL_FECHADO") return;
    
    // Se o estado for igual ao último notificado, ignora (evita flood)
    if (estado === ultimoEstadoNotificado) return;
    
    const agora = Date.now();
    // DIMINUÍDO PARA 1 SEGUNDO (Era 3s)
    // Se você abrir e fechar em 1.5s, ele vai notificar os dois.
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
        }).catch(e => console.error("Erro ntfy"));
    }
}

// --- ROTAS ---
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

app.post('/api/acionar', (req, res) => {
    const token = req.headers['authorization'];
    if (!activeSessions[token]) return res.status(403).json({ error: "Sessão Expirada." });
    
    const usuarioNome = activeSessions[token];
    const userAgent = req.headers['user-agent'] || "";
    let device = "PC";
    if (userAgent.includes("Android")) device = "Android";
    else if (userAgent.includes("iPhone")) device = "iPhone";

    const acao = req.body.comando_customizado || "ABRIR_PORTAO_AGORA";
    const payload = `${acao}|${usuarioNome}|${device}`;
    client.publish(TOPIC_COMMAND, payload);
    
    console.log(`📤 Ação de: ${usuarioNome} (${device})`);
    res.json({ success: true });
});

app.post('/api/admin/update', (req, res) => {
    const token = req.headers['authorization'];
    if (!activeSessions[token]) return res.status(403).json({ error: "Acesso Negado." });
    
    client.publish(TOPIC_COMMAND, "ATUALIZAR_FIRMWARE");
    sseClients.forEach(c => c.res.write(`data: STATUS_ATUALIZANDO_SISTEMA\n\n`));
    res.json({ success: true });
});

app.listen(PORT, () => console.log(`🚀 Smart Gate V3 na porta ${PORT}`));