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
            const usuario = partes[1]; 
            const dispositivo = partes[2];
            
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
        ultimoEstadoConhecido = msg;
        sseClients.forEach(c => c.res.write(`data: ${msg}\n\n`));
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
    let origemTexto = "";
    
    if (estado === "ESTADO_REAL_ABERTO") {
        titulo = "Portão Aberto ⚠️";
        if (ultimoComandoOrigem) {
            origemTexto = `\n📱 Acionado por: ${ultimoComandoOrigem}`;
            ultimoComandoOrigem = null;
            if (timeoutComando) clearTimeout(timeoutComando);
        } else {
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

    if (NTFY_TOPIC) {
        console.log(`🔔 Notificando: ${titulo}`);
        axios.post('https://ntfy.sh/', {
            topic: NTFY_TOPIC,
            title: titulo,
            message: mensagem,
            priority: 3, 
            tags: tags,
            click: "https://smartgateweb.onrender.com"
        }).catch(err => {
            console.error("❌ Erro ntfy:", err.message);
        });
    }
}

// --- FUNÇÃO INTELIGENTE PARA DESCOBRIR O MODELO DO CELULAR ---
function identificarDispositivo(userAgent) {
    // 1. iPhone (Apple oculta o modelo exato)
    if (/iPhone/.test(userAgent)) {
        return "iPhone"; 
    }

    // 2. Android (Tenta extrair o modelo ex: SM-M356B)
    if (/Android/.test(userAgent)) {
        // Procura texto entre ponto-e-vírgula e a palavra Build/
        const match = userAgent.match(/Android[^;]*;\s*([^;]+?)\s*(?:Build|\))/);
        
        if (match && match[1]) {
            let modelo = match[1].trim();
            // Limpeza extra caso pegue idioma (ex: pt-br)
            if (modelo.length < 5 && userAgent.includes(modelo)) {
                 const match2 = userAgent.match(/;\s([A-Za-z0-9\s\-]+)\sBuild/);
                 if(match2) modelo = match2[1].trim();
            }
            return `Android (${modelo})`;
        }
        return "Android Genérico";
    }

    // 3. Windows
    if (/Windows/.test(userAgent)) return "PC Windows";

    return "Navegador Web";
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

    const { confirmed, deviceName } = req.body; // Aceita deviceName se o front mandar

    // 1. Verifica Horário Crítico (Brasília)
    const dataBrasilia = new Date().toLocaleString("en-US", {timeZone: "America/Sao_Paulo"});
    const horaAtual = new Date(dataBrasilia).getHours();
    
    // Regra: Das 23h até 05h precisa de confirmação
    const isHorarioCritico = horaAtual >= 23 || horaAtual < 5;

    if (isHorarioCritico && !confirmed) {
        return res.json({ 
            success: false, 
            requiresConfirmation: true, 
            message: "⚠️ Atenção: Horário de Segurança (23h-05h).\nDeseja realmente abrir o portão?" 
        });
    }

    // 2. Identifica o Dispositivo
    const userAgent = req.headers['user-agent'] || "";
    // Se o frontend mandou um nome personalizado, usa ele. Se não, tenta descobrir.
    const device = deviceName || identificarDispositivo(userAgent);

    // 3. Publica no MQTT
    const payload = `ABRIR_PORTAO_AGORA|WebUser|${device}`;
    client.publish(TOPIC_COMMAND, payload);
    
    console.log(`📱 Acionamento via Site: ${device} (Hora: ${horaAtual}h)`);
    
    res.json({ success: true });
});

app.post('/api/logout', (req, res) => {
    const token = req.headers['authorization'];
    activeTokens = activeTokens.filter(t => t !== token);
    res.json({ success: true });
});

app.listen(PORT, () => console.log(`🚀 Servidor Smart Gate na porta ${PORT}`));
