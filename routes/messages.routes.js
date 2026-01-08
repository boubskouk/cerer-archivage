// ============================================
// ROUTES MESSAGES
// ============================================

const express = require('express');
const router = express.Router();
const messagesController = require('../controllers/messages.controller');
const { isAuthenticated } = require('../middleware/authMiddleware');

// ============================================
// TOUTES LES ROUTES PROTÉGÉES
// ============================================

router.use(isAuthenticated);

// ============================================
// ENVOI
// ============================================

// POST /api/messages - Envoyer un message
router.post('/', messagesController.sendMessage);

// ============================================
// RÉCEPTION
// ============================================

// GET /api/messages/received/:userId - Messages reçus (limit 20)
router.get('/received/:userId', messagesController.getReceivedMessages);

// GET /api/messages/sent/:userId - Messages envoyés (limit 20)
router.get('/sent/:userId', messagesController.getSentMessages);

// GET /api/messages/:userId - Messages utilisateur (LEGACY - compatibilité)
router.get('/:userId', messagesController.getMessages);

// ============================================
// ACTIONS
// ============================================

// PUT /api/messages/:messageId/read - Marquer comme lu
router.put('/:messageId/read', messagesController.markAsRead);

// GET /api/messages/:userId/unread-count - Compteur non lus
router.get('/:userId/unread-count', messagesController.getUnreadCount);

// ============================================
// SUPPRESSION
// ============================================

// DELETE /api/messages/:messageId - Supprimer un message
router.delete('/:messageId', messagesController.deleteMessage);

// DELETE /api/messages/bulk/received/:userId - Supprimer tous messages reçus
router.delete('/bulk/received/:userId', messagesController.deleteAllReceived);

// DELETE /api/messages/bulk/sent/:userId - Supprimer tous messages envoyés
router.delete('/bulk/sent/:userId', messagesController.deleteAllSent);

// ============================================
// ROUTES UTILISATEUR CONNECTÉ
// ============================================

// GET /api/messages/my-conversation - Conversation de l'utilisateur connecté
router.get('/my-conversation', messagesController.getMyConversation);

// DELETE /api/messages/delete-all - Supprimer tous messages de l'utilisateur connecté
router.delete('/delete-all', messagesController.deleteAllMyMessages);

module.exports = router;
