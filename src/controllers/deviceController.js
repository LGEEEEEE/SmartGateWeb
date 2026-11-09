// src/controllers/deviceController.js
const { publishCommand } = require('../services/mqttService');

const acionar = (req, res) => {
    // Atenção: agora pegamos o nome de req.user.user porque mudamos a estrutura da sessão
    const usuarioNome = req.user || "Usuário"; 
    const userAgent = req.headers['user-agent'] || "";
    let device = "PC";
    if (userAgent.includes("Android")) device = "Android";
    else if (userAgent.includes("iPhone")) device = "iPhone";

    const dispositivo = req.body.dispositivo || "portao"; 
    const acao = req.body.comando_customizado || "ABRIR_PORTAO_AGORA";

    // --- NOVA REGRA NOTURNA EMBUTIDA AQUI ---
    const horaAtual = new Date().getHours();
    const isMadrugada = horaAtual >= 23 || horaAtual < 6;

    // Bloqueia se for portão, for madrugada, não for um check de status, e não tiver o token noturno
    if (dispositivo === "portao" && isMadrugada && acao !== "CHECAR_STATUS" && !req.body.nightVerified) {
        return res.status(403).json({ error: "Abertura noturna requer confirmação de senha noturna." });
    }
    // ----------------------------------------

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