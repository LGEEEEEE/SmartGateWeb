// src/middlewares/authMiddleware.js
const store = require('../config/store');

// src/middlewares/authMiddleware.js
const authMiddleware = (req, res, next) => {
    // Tenta pegar o token do Header OU da URL (para o EventSource)
    const token = req.headers['authorization'] || req.query.token;
    const session = store.activeSessions[token];
    
    if (!token || !session || Date.now() > session.expiresAt) {
        if (session) delete store.activeSessions[token]; // Limpa a sessão expirada
        return res.status(403).json({ error: "Sessão Expirada ou Acesso Negado." });
    }
    
    req.user = session.user; 
    next();
};

module.exports = authMiddleware;