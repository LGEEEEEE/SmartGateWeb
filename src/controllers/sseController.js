// src/controllers/sseController.js
const store = require('../config/store');

const getEvents = (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();
    
    const id = Date.now();
    store.sseClients.push({ id, res });
    
    res.write(`data: ${store.ultimoEstadoPortao}\n\n`);
    res.write(`data: ${store.ultimoEstadoBomba}\n\n`);
    
    req.on('close', () => { 
        store.sseClients = store.sseClients.filter(c => c.id !== id); 
    });
};

module.exports = { getEvents };