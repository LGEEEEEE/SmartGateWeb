// src/middlewares/authMiddleware.js
const store = require('../config/store');

const authMiddleware = (req, res, next) => {
    const token = req.headers['authorization'];
    
    if (!token || !store.activeSessions[token]) {
        return res.status(403).json({ error: "Sessão Expirada ou Acesso Negado." });
    }
    
    // Injeta o nome do usuário na requisição para o Controller usar
    req.user = store.activeSessions[token]; 
    next();
};

module.exports = authMiddleware;