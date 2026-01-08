// ============================================
// CONTROLLER DES MESSAGES
// Gestion des requêtes HTTP et réponses
// ============================================

const messageService = require('../services/messageService');

/**
 * POST /api/messages - Envoyer un message
 */
async function sendMessage(req, res) {
    try {
        const { from, to, subject, body, type, relatedData } = req.body;

        const result = await messageService.sendMessage({
            from,
            to,
            subject,
            body,
            type,
            relatedData
        });

        res.json(result);

    } catch (error) {
        console.error('❌ Erreur sendMessage:', error);

        if (error.message === 'Données manquantes: from, to et body sont requis') {
            return res.status(400).json({
                success: false,
                message: error.message
            });
        }

        if (error.message === 'Expéditeur non trouvé' || error.message === 'Destinataire non trouvé') {
            return res.status(404).json({
                success: false,
                message: error.message
            });
        }

        res.status(500).json({
            success: false,
            message: 'Erreur serveur'
        });
    }
}

/**
 * GET /api/messages/received/:userId - Messages reçus
 */
async function getReceivedMessages(req, res) {
    try {
        const { userId } = req.params;
        const { unreadOnly } = req.query;

        const messages = await messageService.getReceivedMessages(userId, {
            unreadOnly: unreadOnly === 'true'
        });

        res.json({
            success: true,
            messages
        });

    } catch (error) {
        console.error('❌ Erreur getReceivedMessages:', error);
        res.status(500).json({
            success: false,
            message: 'Erreur serveur'
        });
    }
}

/**
 * GET /api/messages/sent/:userId - Messages envoyés
 */
async function getSentMessages(req, res) {
    try {
        const { userId } = req.params;

        const messages = await messageService.getSentMessages(userId);

        res.json({
            success: true,
            messages
        });

    } catch (error) {
        console.error('❌ Erreur getSentMessages:', error);
        res.status(500).json({
            success: false,
            message: 'Erreur serveur'
        });
    }
}

/**
 * GET /api/messages/:userId - Messages utilisateur (LEGACY)
 */
async function getMessages(req, res) {
    try {
        const { userId } = req.params;
        const { unreadOnly } = req.query;

        const messages = await messageService.getUserMessages(userId, {
            unreadOnly: unreadOnly === 'true'
        });

        // Format legacy : retourne directement le tableau
        res.json(messages);

    } catch (error) {
        console.error('❌ Erreur getMessages:', error);
        res.status(500).json({
            success: false,
            message: 'Erreur serveur'
        });
    }
}

/**
 * PUT /api/messages/:messageId/read - Marquer comme lu
 */
async function markAsRead(req, res) {
    try {
        const { messageId } = req.params;

        const result = await messageService.markAsRead(messageId);

        res.json(result);

    } catch (error) {
        console.error('❌ Erreur markAsRead:', error);

        if (error.message === 'Message non trouvé') {
            return res.status(404).json({
                success: false,
                message: error.message
            });
        }

        res.status(500).json({
            success: false,
            message: 'Erreur serveur'
        });
    }
}

/**
 * GET /api/messages/:userId/unread-count - Compteur non lus
 */
async function getUnreadCount(req, res) {
    try {
        const { userId } = req.params;

        const count = await messageService.getUnreadCount(userId);

        res.json({ count });

    } catch (error) {
        console.error('❌ Erreur getUnreadCount:', error);
        res.status(500).json({
            success: false,
            message: 'Erreur serveur'
        });
    }
}

/**
 * DELETE /api/messages/:messageId - Supprimer un message
 */
async function deleteMessage(req, res) {
    try {
        const { messageId } = req.params;

        const result = await messageService.deleteMessage(messageId);

        res.json(result);

    } catch (error) {
        console.error('❌ Erreur deleteMessage:', error);

        if (error.message === 'Message non trouvé') {
            return res.status(404).json({
                success: false,
                message: error.message
            });
        }

        res.status(500).json({
            success: false,
            message: 'Erreur serveur'
        });
    }
}

/**
 * DELETE /api/messages/bulk/received/:userId - Supprimer tous messages reçus
 */
async function deleteAllReceived(req, res) {
    try {
        const { userId } = req.params;

        const result = await messageService.deleteAllReceived(userId);

        res.json(result);

    } catch (error) {
        console.error('❌ Erreur deleteAllReceived:', error);
        res.status(500).json({
            success: false,
            message: 'Erreur serveur'
        });
    }
}

/**
 * DELETE /api/messages/bulk/sent/:userId - Supprimer tous messages envoyés
 */
async function deleteAllSent(req, res) {
    try {
        const { userId } = req.params;

        const result = await messageService.deleteAllSent(userId);

        res.json(result);

    } catch (error) {
        console.error('❌ Erreur deleteAllSent:', error);
        res.status(500).json({
            success: false,
            message: 'Erreur serveur'
        });
    }
}

/**
 * GET /api/messages/my-conversation - Récupérer la conversation de l'utilisateur connecté
 */
async function getMyConversation(req, res) {
    try {
        const userId = req.session?.userId;

        if (!userId) {
            return res.status(401).json({
                success: false,
                message: 'Non authentifié'
            });
        }

        const received = await messageService.getReceivedMessages(userId, 100);
        const sent = await messageService.getSentMessages(userId, 100);

        res.json({
            success: true,
            received: received.messages || [],
            sent: sent.messages || [],
            total: (received.messages?.length || 0) + (sent.messages?.length || 0)
        });

    } catch (error) {
        console.error('❌ Erreur getMyConversation:', error);
        res.status(500).json({
            success: false,
            message: 'Erreur serveur'
        });
    }
}

/**
 * DELETE /api/messages/delete-all - Supprimer tous les messages de l'utilisateur connecté
 */
async function deleteAllMyMessages(req, res) {
    try {
        const userId = req.session?.userId;

        if (!userId) {
            return res.status(401).json({
                success: false,
                message: 'Non authentifié'
            });
        }

        const result = await messageService.deleteAllReceived(userId);

        res.json(result);

    } catch (error) {
        console.error('❌ Erreur deleteAllMyMessages:', error);
        res.status(500).json({
            success: false,
            message: 'Erreur serveur'
        });
    }
}

module.exports = {
    sendMessage,
    getReceivedMessages,
    getSentMessages,
    getMessages,
    markAsRead,
    getUnreadCount,
    deleteMessage,
    deleteAllReceived,
    deleteAllSent,
    getMyConversation,
    deleteAllMyMessages
};
