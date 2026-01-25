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

// Memória de QUEM abriu (Para notificações ricas)
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
        // O payload geralmente é: "COMANDO|Usuario|Dispositivo"
        const partes = msg.split('|');
        
        if (partes.length >= 3) {
            const comando = partes[0];
            const usuario = partes[1]; 
            const dispositivo = partes[2]; 
            
            // Só registramos a origem se for uma ação de abrir, para notificar depois
            if (comando === "ABRIR_PORTAO_AGORA") {
                ultimoComandoOrigem = `${usuario} via ${dispositivo}`;
                console.log(`👤 Comando recebido de: ${ultimoComandoOrigem}`);
    
                if (timeoutComando) clearTimeout(timeoutComando);
                timeoutComando = setTimeout(() => {
                    ultimoComandoOrigem = null;
                }, 40000); // Esquece quem abriu depois de 40s
            }
        }
    }

    // 2. SE FOR STATUS (Vindo do ESP32/Portão)
    if (topic === TOPIC_STATUS) {
        console.log(`📥 Status Recebido: ${msg}`);
        ultimoEstadoConhecido = msg;

        // Atualiza todos os navegadores conectados (SSE) em tempo real
        sseClients.forEach(c => c.res.write(`data: ${msg}\n\n`));

        // Verifica se precisa mandar Push Notification (ntfy)
        verificarENotificar(msg);
    }
});

// --- FUNÇÃO DE NOTIFICAÇÃO INTELIGENTE ---
function verificarENotificar(estado) {
    // Só notifica estados finais (Aberto/Fechado)
    if (estado !== "ESTADO_REAL_ABERTO" && estado !== "ESTADO_REAL_FECHADO") return;
    
    // Evita spam: se o estado é igual ao último notificado, ignora
    if (estado === ultimoEstadoNotificado) return;

    let titulo = "";
    let mensagem = "";
    let tags = [];
    let origemTexto = "";
    
    if (estado === "ESTADO_REAL_ABERTO") {
        titulo = "Portão Aberto ⚠️";
        
        // Adiciona quem abriu na mensagem, se soubermos
        if (ultimoComandoOrigem) {
            origemTexto = `\n📱 Acionado por: ${ultimoComandoOrigem}`;
            ultimoComandoOrigem = null; // Limpa após usar
            if (timeoutComando) clearTimeout(timeoutComando);
        } else {
            origemTexto = "\n🎮 Acionado por: Controle Remoto ou Manual";
        }

        mensagem = `O portão acabou de abrir.${origemTexto}`;
        tags = ["warning", "door"]; 

    } else {
        titulo = "Portão Fechado 🔒";
        mensagem = "O portão foi fechado com segurança.";
        tags = ["white_check_mark", "lock"];
    }

    ultimoEstadoNotificado = estado; // Atualiza a memória

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
        .catch(err => {
            console.error("❌ Erro ao enviar ntfy:", err.message);
        });
    }
}

// --- ROTAS HTTP (API) ---

// Rota de Eventos (SSE) - Mantém a conexão aberta com o navegador
app.get('/events', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const id = Date.now();
    sseClients.push({ id, res });

    // Envia o estado atual assim que conecta
    res.write(`data: ${ultimoEstadoConhecido}\n\n`);

    // Remove cliente quando desconecta
    req.on('close', () => {
        sseClients = sseClients.filter(c => c.id !== id);
    });
});

// Rota de Login
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

// Rota de Acionamento (Abrir ou Checar Status)
app.post('/api/acionar', (req, res) => {
    const token = req.headers['authorization'];
    if (!activeTokens.includes(token)) return res.status(403).json({ error: "Sessão Expirada." });
    
    // Identifica dispositivo para o log
    const userAgent = req.headers['user-agent'] || "Web";
    let device = "Navegador Web";
    if (userAgent.includes("Android")) device = "Android";
    else if (userAgent.includes("iPhone")) device = "iPhone";
    else if (userAgent.includes("Windows")) device = "PC";

    // Se o frontend mandou um comando específico (ex: CHECAR_STATUS), usa ele. 
    // Se não, usa o padrão ABRIR.
    const acao = req.body.comando_customizado || "ABRIR_PORTAO_AGORA";
    
    const payload = `${acao}|WebUser|${device}`;
    client.publish(TOPIC_COMMAND, payload);
    
    console.log(`📤 Comando enviado via API: ${payload}`);
    res.json({ success: true });
});

// Rota de Atualização de Firmware (OTA)
app.post('/api/admin/update', (req, res) => {
    const token = req.headers['authorization'];
    if (!activeTokens.includes(token)) return res.status(403).json({ error: "Acesso Negado." });

    console.log("🔄 COMANDO ADMIN: Iniciando atualização de firmware via OTA...");
    
    // 1. Manda o comando pro ESP32
    client.publish(TOPIC_COMMAND, "ATUALIZAR_FIRMWARE");
    
    // 2. Avisa IMEDIATAMENTE os navegadores (UX Instantânea)
    // Isso faz aparecer o Toast "Baixando..." antes mesmo do ESP responder
    sseClients.forEach(c => c.res.write(`data: STATUS_ATUALIZANDO_SISTEMA\n\n`));

    res.json({ success: true, message: "Comando enviado!" });
});

// Rota de Logout
app.post('/api/logout', (req, res) => {
    const token = req.headers['authorization'];
    activeTokens = activeTokens.filter(t => t !== token);
    res.json({ success: true });
});

app.listen(PORT, () => console.log(`🚀 Servidor Smart Gate rodando na porta ${PORT}`));