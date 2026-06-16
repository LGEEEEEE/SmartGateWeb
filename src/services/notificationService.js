// src/services/notificationService.js
const axios = require('axios');
const store = require('../config/store');

const verificarENotificar = (estado) => {
    if (estado !== "ESTADO_REAL_ABERTO" && estado !== "ESTADO_REAL_FECHADO") return;
    if (estado === store.ultimoEstadoNotificado) return;
    
    const agora = Date.now();
    if (agora - store.ultimoTempoNotificacao < 1000) return;

    let titulo = "", mensagem = "", tags = [];
    
    // Movi a variável pra cá pra não dar ReferenceError no bloco do "FECHADO"
    let quem = store.ultimoComandoOrigem ? store.ultimoComandoOrigem : "Controle Remoto/Manual";
    
    if (estado === "ESTADO_REAL_ABERTO") {
        titulo = "Portão Aberto ⚠️";
        mensagem = `O portão foi aberto por: ${quem}`;
        tags = ["warning", "door"]; 
    } else if (estado === "ESTADO_REAL_FECHADO") { 
        titulo = "Portão Fechado 🔒";
        mensagem = `Portão fechado com segurança por ${quem}`;
        tags = ["white_check_mark", "lock"];
    }

    store.ultimoEstadoNotificado = estado;
    store.ultimoTempoNotificacao = agora; 

    enviarNtfy(titulo, mensagem, tags);
};

// Nova função para avisos do servidor/sistema
const notificarSistema = (titulo, mensagem, tags = []) => {
    enviarNtfy(titulo, mensagem, tags);
};

// Função auxiliar para não repetir o código do axios
const enviarNtfy = (titulo, mensagem, tags) => {
    if (process.env.NTFY_TOPIC) {
        axios.post('https://ntfy.sh/', {
            topic: process.env.NTFY_TOPIC, 
            title: titulo, 
            message: mensagem,
            priority: 3, 
            tags: tags, 
            click: "https://smartgateweb.onrender.com"
        }).catch(e => console.error("Erro ao enviar notificação push via ntfy:", e.message));
    }
};

module.exports = { verificarENotificar, notificarSistema };