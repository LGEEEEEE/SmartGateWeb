// src/controllers/deviceController.js
const { publishCommand } = require('../services/mqttService');

const acionar = (req, res) => {
    const usuarioNome = req.user; 
    const userAgent = req.headers['user-agent'] || "";
    let device = "PC";
    if (userAgent.includes("Android")) device = "Android";
    else if (userAgent.includes("iPhone")) device = "iPhone";

    const dispositivo = req.body.dispositivo || "portao"; 
    const acao = req.body.comando_customizado || "ABRIR_PORTAO_AGORA";

    if (dispositivo === "bomba") {
        publishCommand("bomba", acao);
        console.log(`💧 Comando Bomba: [${acao}] por ${usuarioNome} (${device})`);
    } else {
        const payload = `${acao}|${usuarioNome}|${device}`;
        publishCommand("portao", payload);
        console.log(`📤 Comando Portão: [${acao}] de: ${usuarioNome} (${device})`);
    }
    
    res.json({ success: true });
};

const updateFirmware = (req, res) => {
    const dispositivo = req.body.dispositivo;

    if (dispositivo === "bomba") {
        console.log("\n🚀 OTA BOMBA SOLICITADO\n");
        publishCommand("bomba", "ATUALIZAR_FIRMWARE");
    } else {
        console.log("\n🚀 OTA PORTÃO SOLICITADO\n");
        publishCommand("portao", "ATUALIZAR_FIRMWARE");
    }
    
    res.json({ success: true });
};

module.exports = { acionar, updateFirmware };