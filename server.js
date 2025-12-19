const express = require('express');
const mqtt = require('mqtt');
const app = express();

app.use(express.json());

const PORT = process.env.PORT || 3000;
// Variáveis do Render
const MQTT_URL = process.env.MQTT_URL; 
const MQTT_USER = process.env.MQTT_USER;
const MQTT_PASS = process.env.MQTT_PASS;
const APP_PASSWORD = process.env.APP_PASSWORD; 
const TOPIC_COMMAND = "projeto_LG/casa/portao";
const TOPIC_STATUS = "projeto_LG/casa/portao/status";

let clients = [];

// Conexão MQTT
const client = mqtt.connect(MQTT_URL, {
    username: MQTT_USER,
    password: MQTT_PASS,
    protocol: 'mqtts', 
    rejectUnauthorized: false 
});

client.on('connect', () => {
    console.log("✅ Servidor conectado ao MQTT!");
    client.subscribe(TOPIC_STATUS);
});

// Repassa status do MQTT para o navegador (SSE)
client.on('message', (topic, message) => {
    if (topic === TOPIC_STATUS) {
        const msgString = message.toString();
        clients.forEach(client => client.res.write(`data: ${msgString}\n\n`));
    }
});

// Endpoint de Eventos (Mantém conexão aberta com o navegador)
app.get('/events', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const clientId = Date.now();
    const newClient = { id: clientId, res };
    clients.push(newClient);

    req.on('close', () => {
        clients = clients.filter(c => c.id !== clientId);
    });
});

// O Site (Frontend)
app.get('/', (req, res) => {
    res.send(`
    <!DOCTYPE html>
    <html lang="pt-br">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Smart Gate Web</title>
        <style>
            body { background-color: #121212; color: white; font-family: sans-serif; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; margin: 0; }
            .status-box { margin-bottom: 40px; font-size: 1.2rem; font-weight: bold; padding: 10px 20px; border-radius: 20px; background: #222; border: 2px solid #555; }
            input { background: #333; border: 1px solid #555; color: white; padding: 15px; border-radius: 8px; font-size: 1.2rem; text-align: center; width: 80%; margin-bottom: 20px; outline: none; }
            button { background: linear-gradient(145deg, #4CAF50, #388E3C); color: white; border: none; width: 220px; height: 220px; border-radius: 50%; font-size: 1.5rem; font-weight: bold; cursor: pointer; }
            button:disabled { filter: grayscale(100%); opacity: 0.5; }
        </style>
    </head>
    <body>
        <h1>🏠 Smart Gate</h1>
        <div id="statusDisplay" class="status-box">Aguardando Status... 📡</div>
        <input type="password" id="senha" placeholder="Senha de Acesso">
        <button id="btn" onclick="abrirPortao()">ABRIR</button>

        <script>
            const statusDisplay = document.getElementById('statusDisplay');
            const evtSource = new EventSource('/events');
            
            evtSource.onmessage = function(event) {
                const msg = event.data;
                if(msg === "STATUS_ABRINDO") {
                    statusDisplay.innerText = "Abrindo... 🔼";
                    statusDisplay.style.borderColor = "#FFD700"; statusDisplay.style.color = "#FFD700";
                } else if(msg === "STATUS_FECHANDO") {
                    statusDisplay.innerText = "Fechando... 🔽";
                    statusDisplay.style.borderColor = "#FFD700"; statusDisplay.style.color = "#FFD700";
                } else if(msg === "ESTADO_REAL_ABERTO") {
                    statusDisplay.innerText = "PORTÃO ABERTO 🔓";
                    statusDisplay.style.borderColor = "#ff4444"; statusDisplay.style.color = "#ff4444";
                } else if(msg === "ESTADO_REAL_FECHADO") {
                    statusDisplay.innerText = "PORTÃO FECHADO 🔒";
                    statusDisplay.style.borderColor = "#4CAF50"; statusDisplay.style.color = "#4CAF50";
                }
            };

            async function abrirPortao() {
                const senha = document.getElementById('senha').value;
                if(!senha) return alert("Digite a senha!");
                document.getElementById('btn').disabled = true;
                await fetch('/api/acionar', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ password: senha }) });
                setTimeout(() => { document.getElementById('btn').disabled = false; }, 3000);
            }
        </script>
    </body>
    </html>
    `);
});

app.post('/api/acionar', (req, res) => {
    if (req.body.password !== APP_PASSWORD) return res.status(401).json({ error: "Senha Errada" });
    client.publish(TOPIC_COMMAND, "ABRIR_PORTAO_AGORA|WebUser|Navegador");
    res.json({ success: true });
});

app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});