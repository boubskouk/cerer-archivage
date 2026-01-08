// ============================================
// MIDDLEWARE D'AUTHENTIFICATION
// ============================================

const { getCollections } = require('../config/database');

/**
 * Vérifier si l'utilisateur est authentifié
 */
function isAuthenticated(req, res, next) {
    if (!req.session || !req.session.userId) {
        return res.status(401).json({
            success: false,
            message: 'Non authentifié. Veuillez vous connecter.'
        });
    }
    next();
}

/**
 * Middleware pour vérifier isOnline et forcer la déconnexion si false
 * Utilisé pour détecter les sessions forcées à se déconnecter
 */
async function checkIsOnline(req, res, next) {
    // Ignorer pour les routes publiques
    const publicRoutes = ['/api/login', '/api/logout', '/api/check-session-status', '/api/register'];
    if (publicRoutes.includes(req.path) || !req.path.startsWith('/api/')) {
        return next();
    }

    // Vérifier uniquement si l'utilisateur est connecté
    if (!req.session || !req.session.userId) {
        return next();
    }

    try {
        const collections = getCollections();
        const user = await collections.users.findOne({ username: req.session.userId });

        if (!user) {
            // Utilisateur n'existe plus - détruire la session
            req.session.destroy();
            return res.status(401).json({
                success: false,
                message: 'Session invalide',
                forceLogout: true
            });
        }

        // 🔒 SÉCURITÉ: Si isOnline est false, forcer la déconnexion
        if (user.isOnline === false) {
            console.log(`🔒 Déconnexion forcée: ${req.session.userId} (isOnline = false)`);

            // Détruire la session
            req.session.destroy();

            return res.status(401).json({
                success: false,
                message: 'Votre session a été fermée par un administrateur',
                forceLogout: true
            });
        }

        // Tout est OK, continuer
        next();

    } catch (error) {
        console.error('❌ Erreur checkIsOnline:', error);
        next(); // Continuer même en cas d'erreur pour ne pas bloquer l'application
    }
}

/**
 * Vérifier que l'utilisateur est bloqué
 */
async function checkIfBlocked(req, res, next) {
    if (!req.session || !req.session.userId) {
        return next();
    }

    try {
        const collections = getCollections();
        const user = await collections.users.findOne({ username: req.session.userId });

        if (user && user.blocked) {
            req.session.destroy();
            return res.status(403).json({
                success: false,
                message: user.blockedReason || 'Votre compte a été bloqué',
                blocked: true
            });
        }

        next();
    } catch (error) {
        console.error('❌ Erreur checkIfBlocked:', error);
        next();
    }
}

module.exports = {
    isAuthenticated,
    checkIsOnline,
    checkIfBlocked
};
