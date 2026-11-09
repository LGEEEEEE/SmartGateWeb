// src/routes/apiRoutes.js
const express = require('express');
const rateLimit = require('express-rate-limit');
const authMiddleware = require('../middlewares/authMiddleware');
const authController = require('../controllers/authController');
const deviceController = require('../controllers/deviceController');
const sseController = require('../controllers/sseController');

const router = express.Router();

// Configura o Limite de Tentativas
const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, 
    max: 5, 
    message: { error: "Muitas tentativas. Tente em 15 minutos." }
});

// Auth (com Rate Limit)
router.post('/api/login', loginLimiter, authController.login);
// Agora exige estar logado E tem rate limit contra força bruta
router.post('/api/verify-night', loginLimiter, authMiddleware, authController.verifyNight);

// SSE (Protegido)
router.get('/events', authMiddleware, sseController.getEvents);

// Dispositivos
router.post('/api/acionar', authMiddleware, deviceController.acionar);
router.post('/api/admin/update', authMiddleware, deviceController.updateFirmware);

module.exports = router;