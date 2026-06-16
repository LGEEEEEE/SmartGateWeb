// src/services/mqttService.js
const mqtt = require('mqtt');
const store = require('../config/store');
const { verificarENotificar } = require('./notificationService');

const TOPIC_STATUS_PORTAO = "projeto_LG/casa/portao/status";
const TOPIC_STATUS_BOMBA = "projeto_LG/casa/bomba/status"; 
const TOPIC_COMMAND = "projeto_LG/casa/portao";
const TOPIC_COMMAND_BOMBA = "projeto_LG/casa/bomba/cmd";

let client;

const initMqtt = () => {
    client = mqtt.connect(process.env.MQTT_URL, {
        username: process.env.MQTT_USER, 
        password: process.env.MQTT_PASS,
        protocol: 'mqtts', 
        rejectUnauthorized: false
    });

    client.on('connect', () => {
        console.log("✅ MQTT Conectado ao HiveMQ");
        client.subscribe([TOPIC_STATUS_PORTAO, TOPIC_STATUS_BOMBA, TOPIC_COMMAND]);
    });

    client.on('message', (topic, message) => {
        const msg = message.toString();

        if (topic === TOPIC_STATUS_PORTAO) {
            if (msg.includes("BOMBA")) return; 
            if (msg === "STATUS_ATUALIZANDO_SISTEMA" || msg === "ERRO_ATUALIZACAO") {
                store.ultimoEstadoPortao = ""; 
                console.log(`\nOTA PORTÃO: ${msg}\n`);
                store.sseClients.forEach(c => c.res.write(`data: PORTAO_${msg}\n\n`));
            }
            else if (msg !== store.ultimoEstadoPortao) {
                console.log(`🚪 Status Portão: ${msg}`);
                store.ultimoEstadoPortao = msg;
                store.sseClients.forEach(c => c.res.write(`data: ${msg}\n\n`));
                verificarENotificar(msg);
            }
        }
        else if (topic === TOPIC_STATUS_BOMBA) {
            if (msg === "STATUS_ATUALIZANDO_BOMBA" || msg === "ERRO_ATUALIZACAO_BOMBA") {
                store.ultimoEstadoBomba = ""; 
                console.log(`\nOTA BOMBA: ${msg}\n`);
                store.sseClients.forEach(c => c.res.write(`data: ${msg}\n\n`));
            }
            else if (msg !== store.ultimoEstadoBomba) {
                console.log(`💧 Status Bomba: ${msg}`);
                store.ultimoEstadoBomba = msg;
                store.sseClients.forEach(c => c.res.write(`data: ${msg}\n\n`));
            }
        }
        else if (topic === TOPIC_COMMAND) {
            const partes = msg.split('|');
            if (partes[0] === "ABRIR_PORTAO_AGORA" || partes[0] === "REGISTRAR_ORIGEM") {
                store.ultimoComandoOrigem = `${partes[1]} | ${partes[2]}`;
                if (store.timeoutComando) clearTimeout(store.timeoutComando);
                store.timeoutComando = setTimeout(() => { store.ultimoComandoOrigem = null; }, 40000);
            }
        }
    });
};

const publishCommand = (dispositivo, payload) => {
    if (dispositivo === "bomba") {
        client.publish(TOPIC_COMMAND_BOMBA, payload);
    } else {
        client.publish(TOPIC_COMMAND, payload);
    }
};

module.exports = { initMqtt, publishCommand };