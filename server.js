require('dotenv').config();
const express = require('express');
const mqtt = require('mqtt');
const crypto = require('crypto');
const axios = require('axios'); 
const app = express();

app.use(express.json());
app.use(express.static('public'));

const PORT = process.env.PORT || 3000;

// --- CONFIGURAÇÃO ---
const MQTT_URL = process.env.MQTT_URL;
const MQTT_USER = process.env.MQTT_USER;
const MQTT_PASS = process.env.MQTT_PASS;
const APP_PASSWORD = process.env.APP_PASSWORD; 
const NTFY_TOPIC = process.env.NTFY_TOPIC; 

const TOPIC_COMMAND = "projeto_LG/casa/portao";
const TOPIC_STATUS = "projeto_LG/casa/portao/status";

let ultimoEstadoConhecido = "AGUARDANDO_ATUALIZACAO"; 
let ultimoEstadoNotificado = ""; 
let activeTokens = [];
let sseClients = [];
let ultimoComandoOrigem = null; 
let timeoutComando = null;

// --- MQTT ---
const client = mqtt.connect(MQTT_URL, {
    username: MQTT_USER, password: MQTT_PASS, protocol: 'mqtts', rejectUnauthorized: false
});

client.on('connect', () => {
    console.log("✅ MQTT Conectado!");
    client.subscribe([TOPIC_STATUS, TOPIC_COMMAND]);
});

client.on('message', (topic, message) => {
    const msg = message.toString();

    // COMANDO (Registra quem mandou)
    if (topic === TOPIC_COMMAND) {
        const partes = msg.split('|');
        if (partes.length >= 3) {
            const comando = partes[0]; // Ex: ABRIR_PORTAO_AGORA ou CHECAR_STATUS
            
            // Só registra origem se for comando de abrir
            if (comando === "ABRIR_PORTAO_AGORA") {
                ultimoComandoOrigem = `${partes[1]} via ${partes[2]}`;
                console.log(`👤 Comando ABRIR de: ${ultimoComandoOrigem}`);
                if (timeoutComando) clearTimeout(timeoutComando);
                timeoutComando = setTimeout(() => ultimoComandoOrigem = null, 40000);
            }
        }
    }

    // STATUS (Atualiza site e Notifica)
    if (topic === TOPIC_STATUS) {
        ultimoEstadoConhecido = msg;
        sseClients.forEach(c => c.res.write(`data: ${msg}\n\n`));
        verificarENotificar(msg);
    }
});

// --- NOTIFICAÇÃO (Com proteção anti-spam) ---
function verificarENotificar(estado) {
    if (estado !== "ESTADO_REAL_ABERTO" && estado !== "ESTADO_REAL_FECHADO") return;
    
    // A MÁGICA: Se o estado for igual ao último notificado, IGNORA (não manda ntfy)
    if (estado === ultimoEstadoNotificado) return;

    let titulo = "", mensagem = "", tags = [];
    let origemTexto = "";
    
    if (estado === "ESTADO_REAL_ABERTO") {
        titulo = "Portão Aberto ⚠️";
        origemTexto = ultimoComandoOrigem ? `\n📱 Por: ${ultimoComandoOrigem}` : "\n🎮 Por: Controle/Manual";
        mensagem = `O portão abriu.${origemTexto}`;
        tags = ["warning", "door"]; 
        ultimoComandoOrigem = null; // Limpa após usar
    } else {
        titulo = "Portão Fechado 🔒";
        mensagem = "O portão foi fechado.";
        tags = ["lock"];
    }

    ultimoEstadoNotificado = estado; // Atualiza a memória para evitar repetição

    if (NTFY_TOPIC) {
        console.log(`🔔 Notificando: ${titulo}`);
        axios.post('https://ntfy.sh/', {
            topic: NTFY_TOPIC, title: titulo, message: mensagem, priority: 3, tags: tags,
            click: "https://smartgateweb.onrender.com"
        }).catch(e => console.error("Erro ntfy:", e.message));
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

// ROTA FLEXÍVEL (ACEITA COMANDOS CUSTOMIZADOS)
app.post('/api/acionar', (req, res) => {
    const token = req.headers['authorization'];
    if (!activeTokens.includes(token)) return res.status(403).json({ error: "Sessão Expirada." });
    
    const userAgent = req.headers['user-agent'] || "Web";
    let device = userAgent.includes("Android") ? "Android" : userAgent.includes("iPhone") ? "iPhone" : "PC/Web";

    // Se o front mandou um comando específico, usa ele. Se não, usa o padrão ABRIR.
    const acao = req.body.comando_customizado || "ABRIR_PORTAO_AGORA";
    
    const payload = `${acao}|WebUser|${device}`;
    client.publish(TOPIC_COMMAND, payload);
    
    res.json({ success: true });
});

app.post('/api/admin/update', (req, res) => {
    const token = req.headers['authorization'];
    if (!activeTokens.includes(token)) return res.status(403).json({ error: "Acesso Negado." });
    client.publish(TOPIC_COMMAND, "ATUALIZAR_FIRMWARE");
    sseClients.forEach(c => c.res.write(`data: STATUS_ATUALIZANDO_SISTEMA\n\n`));
    res.json({ success: true });
});

app.post('/api/logout', (req, res) => {
    activeTokens = activeTokens.filter(t => t !== req.headers['authorization']);
    res.json({ success: true });
});

app.listen(PORT, () => console.log(`🚀 Servidor na porta ${PORT}`));