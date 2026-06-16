// src/routes/apiRoutes.js
const express = require('express');
const authMiddleware = require('../middlewares/authMiddleware');
const authController = require('../controllers/authController');
const deviceController = require('../controllers/deviceController');
const sseController = require('../controllers/sseController');

const router = express.Router();

// SSE (Server-Sent Events)
router.get('/events', sseController.getEvents);

// Auth
router.post('/api/login', authController.login);
router.post('/api/verify-night', authController.verifyNight);

// Dispositivos (Protegidos pelo Middleware)
router.post('/api/acionar', authMiddleware, deviceController.acionar);
router.post('/api/admin/update', authMiddleware, deviceController.updateFirmware);

module.exports = router;