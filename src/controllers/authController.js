// src/controllers/authController.js
const crypto = require('crypto');
const store = require('../config/store');

// src/controllers/authController.js
const login = (req, res) => {
    const { password, name } = req.body; 
    if (password === process.env.APP_PASSWORD) {
        const token = crypto.randomBytes(16).toString('hex');
        const userName = name || "Anônimo";
        
        // Define expiração para 24 horas
        const expiresAt = Date.now() + (24 * 60 * 60 * 1000);
        
        store.activeSessions[token] = { user: userName, expiresAt }; 
        res.json({ success: true, token });
    } else {
        res.status(401).json({ success: false, error: "Senha Incorreta" });
    }
};
const verifyNight = (req, res) => {
    const { password } = req.body;
    if (!process.env.NIGHT_PASSWORD) {
        console.warn("⚠️ NIGHT_PASSWORD não definida no .env!");
        return res.status(500).json({ success: false, error: "Erro de configuração no servidor." });
    }

    if (password === process.env.NIGHT_PASSWORD) {
        res.json({ success: true });
    } else {
        res.status(401).json({ success: false, error: "Senha Noturna Incorreta" });
    }
};

module.exports = { login, verifyNight };