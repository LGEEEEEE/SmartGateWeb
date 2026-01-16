

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
    // AGORA ASSINAMOS OS DOIS TÓPICOS: COMANDO E STATUS
    client.subscribe([TOPIC_STATUS, TOPIC_COMMAND], (err) => {
        if (!err) console.log("👂 Ouvindo comandos e status...");
    });
});

// --- RECEBIMENTO DE MENSAGENS ---
client.on('message', (topic, message) => {
    const msg = message.toString();

    // 1. SE FOR COMANDO (Vindo do App ou Site)
    if (topic === TOPIC_COMMAND) {
        // O App manda: "ABRIR_PORTAO_AGORA|NomeUser|ModeloCelular"
        const partes = msg.split('|');
        
        // Verifica se o payload tem o formato certo (3 partes)
        if (partes.length >= 3) {
            const usuario = partes[1]; // Ex: LG Admin
            const dispositivo = partes[2]; // Ex: iPhone 15 ou Android
            
            // Salva na memória quem mandou abrir
            ultimoComandoOrigem = `${usuario} via ${dispositivo}`;
            console.log(`👤 Comando recebido de: ${ultimoComandoOrigem}`);

            // Reseta o timeout (esquece quem foi depois de 40s)
            if (timeoutComando) clearTimeout(timeoutComando);
            timeoutComando = setTimeout(() => {
                ultimoComandoOrigem = null;
            }, 40000);
        }
    }

    // 2. SE FOR STATUS (Vindo do ESP32/Portão)
    if (topic === TOPIC_STATUS) {
        ultimoEstadoConhecido = msg;

        // Atualiza Frontend (SSE)
        sseClients.forEach(c => c.res.write(`data: ${msg}\n\n`));

        // Verifica Notificação Push
        verificarENotificar(msg);
    }
});

// --- FUNÇÃO DE NOTIFICAÇÃO ---
function verificarENotificar(estado) {
    if (estado !== "ESTADO_REAL_ABERTO" && estado !== "ESTADO_REAL_FECHADO") return;
    if (estado === ultimoEstadoNotificado) return;

    let titulo = "";
    let mensagem = "";
    let tags = [];

    // LÓGICA DE ORIGEM
    let origemTexto = "";
    
    if (estado === "ESTADO_REAL_ABERTO") {
        titulo = "Portão Aberto ⚠️";
        
        // Se temos registro de quem mandou o comando
        if (ultimoComandoOrigem) {
            origemTexto = `\n📱 Acionado por: ${ultimoComandoOrigem}`;
            // Limpa a memória
            ultimoComandoOrigem = null;
            if (timeoutComando) clearTimeout(timeoutComando);
        } else {
            // Se não capturamos comando no MQTT, foi controle físico
            origemTexto = "\n🎮 Acionado por: Controle Remoto";
        }

        mensagem = `O portão acabou de abrir.${origemTexto}`;
        tags = ["warning", "door"]; 

    } else {
        titulo = "Portão Fechado 🔒";
        mensagem = "O portão foi fechado.";
        tags = ["white_check_mark", "lock"];
    }

    ultimoEstadoNotificado = estado;

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
// Mantido para compatibilidade com o site web

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

// Se acionar pelo SITE (via HTTP), simulamos o payload igual ao do App
app.post('/api/acionar', (req, res) => {
    const token = req.headers['authorization'];
    if (!activeTokens.includes(token)) return res.status(403).json({ error: "Sessão Expirada." });
    
    // Identifica se é navegador
    const userAgent = req.headers['user-agent'] || "Web";
    let device = "Navegador Web";
    if (userAgent.includes("Android")) device = "Android Web";
    else if (userAgent.includes("iPhone")) device = "iPhone Web";
    else if (userAgent.includes("Windows")) device = "PC Windows";

    // Monta o payload igualzinho ao do seu App React Native
    // Assim o próprio listener MQTT ali em cima vai capturar e processar
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

https://smartgateweb.onrender.com