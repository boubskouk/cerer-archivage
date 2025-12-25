/**
 * ============================================
 * ROUTES API SUPER ADMIN
 * ============================================
 *
 * Toutes les routes nécessitent le niveau 0 (middleware requireSuperAdmin)
 */

const express = require('express');
const router = express.Router();

// Middleware
const { requireSuperAdmin, logAction } = require('../middleware/superAdminAuth');

// Modules
const dashboardModule = require('../modules/superadmin/dashboard');
const usersModule = require('../modules/superadmin/users');
const documentsModule = require('../modules/superadmin/documents');
const departmentsModule = require('../modules/superadmin/departments');

// Collections (injectées depuis server.js)
let db;
let collections;

/**
 * Initialiser les routes avec les collections
 */
function init(database, cols) {
    db = database;
    collections = cols;

    // Initialiser les modules
    dashboardModule.init(collections);
    usersModule.init(collections);
    documentsModule.init(collections);
    departmentsModule.init(collections);

    console.log('✅ Routes Super Admin initialisées');
}

// ============================================
// ROUTES DASHBOARD
// ============================================

/**
 * GET /api/superadmin/dashboard/stats
 * Obtenir les statistiques globales du système
 */
router.get('/dashboard/stats', requireSuperAdmin, async (req, res) => {
    try {
        console.log(`📊 Récupération stats dashboard pour: ${req.session.userId}`);

        const stats = await dashboardModule.getGlobalStats();

        res.json({
            success: true,
            data: stats
        });

    } catch (error) {
        console.error('❌ Erreur dashboard/stats:', error);
        res.status(500).json({
            success: false,
            message: "Erreur lors de la récupération des statistiques",
            error: process.env.NODE_ENV === 'production' ? undefined : error.message
        });
    }
});

/**
 * GET /api/superadmin/dashboard/trends
 * Obtenir les tendances pour les graphiques
 */
router.get('/dashboard/trends', requireSuperAdmin, async (req, res) => {
    try {
        const { type, period } = req.query;

        if (!type) {
            return res.status(400).json({
                success: false,
                message: "Le paramètre 'type' est requis (users, documents)"
            });
        }

        console.log(`📈 Récupération trends: type=${type}, period=${period}`);

        const trends = await dashboardModule.getTrends(type, period || '24h');

        res.json({
            success: true,
            data: trends
        });

    } catch (error) {
        console.error('❌ Erreur dashboard/trends:', error);
        res.status(500).json({
            success: false,
            message: "Erreur lors de la récupération des tendances",
            error: process.env.NODE_ENV === 'production' ? undefined : error.message
        });
    }
});

// ============================================
// MODULE 2 : GESTION DES UTILISATEURS
// ============================================

/**
 * GET /api/superadmin/users
 * Liste tous les utilisateurs avec données enrichies
 */
router.get('/users', requireSuperAdmin, async (req, res) => {
    try {
        const { search, role, status, page = 1, period = 'all', startDate, endDate } = req.query;

        const filters = {
            search,
            role,
            status,
            page: parseInt(page),
            limit: 15,
            period,
            startDate,
            endDate
        };

        const result = await usersModule.getAllUsers(filters);

        // Logger l'accès
        await logAction(req.superAdmin.username, 'SUPERADMIN_VIEW_USERS_LIST',
            { filters }, {}, req);

        res.json({
            success: true,
            data: result
        });

    } catch (error) {
        console.error('❌ Erreur /users:', error);
        res.status(500).json({
            success: false,
            message: "Erreur lors de la récupération des utilisateurs"
        });
    }
});

/**
 * GET /api/superadmin/users/:username/history
 * Historique complet des actions d'un utilisateur
 */
router.get('/users/:username/history', requireSuperAdmin, async (req, res) => {
    try {
        const { username } = req.params;
        const { page = 1, limit = 50 } = req.query;

        const result = await usersModule.getUserHistory(username, {
            page: parseInt(page),
            limit: parseInt(limit)
        });

        await logAction(req.superAdmin.username, 'SUPERADMIN_VIEW_USER_HISTORY',
            { targetUser: username }, {}, req);

        res.json({
            success: true,
            data: result
        });

    } catch (error) {
        console.error('❌ Erreur /users/:username/history:', error);
        res.status(500).json({
            success: false,
            message: "Erreur lors de la récupération de l'historique"
        });
    }
});

/**
 * POST /api/superadmin/users/:username/block
 * Bloquer un utilisateur
 */
router.post('/users/:username/block', requireSuperAdmin, async (req, res) => {
    try {
        const { username } = req.params;
        const { reason } = req.body;

        if (!reason) {
            return res.status(400).json({
                success: false,
                message: "La raison du blocage est requise"
            });
        }

        await usersModule.blockUser(username, req.superAdmin.username, reason);

        res.json({
            success: true,
            message: `Utilisateur ${username} bloqué avec succès`
        });

    } catch (error) {
        console.error('❌ Erreur block user:', error);
        res.status(403).json({
            success: false,
            message: error.message || "Erreur lors du blocage"
        });
    }
});

/**
 * POST /api/superadmin/users/:username/unblock
 * Débloquer un utilisateur
 */
router.post('/users/:username/unblock', requireSuperAdmin, async (req, res) => {
    try {
        const { username } = req.params;

        await usersModule.unblockUser(username, req.superAdmin.username);

        res.json({
            success: true,
            message: `Utilisateur ${username} débloqué avec succès`
        });

    } catch (error) {
        console.error('❌ Erreur unblock user:', error);
        res.status(500).json({
            success: false,
            message: "Erreur lors du déblocage"
        });
    }
});

/**
 * DELETE /api/superadmin/users/:username
 * Supprimer un utilisateur
 */
router.delete('/users/:username', requireSuperAdmin, async (req, res) => {
    try {
        const { username } = req.params;

        await usersModule.deleteUser(username, req.superAdmin.username);

        res.json({
            success: true,
            message: `Utilisateur ${username} supprimé avec succès`
        });

    } catch (error) {
        console.error('❌ Erreur delete user:', error);
        res.status(403).json({
            success: false,
            message: error.message || "Erreur lors de la suppression"
        });
    }
});

/**
 * POST /api/superadmin/users
 * Créer un nouvel utilisateur
 */
router.post('/users', requireSuperAdmin, async (req, res) => {
    try {
        const { username, nom, email, idRole, idDepartement } = req.body;

        // Validation
        if (!username || !nom || !email || !idRole || !idDepartement) {
            return res.status(400).json({
                success: false,
                message: "Tous les champs sont requis (username, nom, email, idRole, idDepartement)"
            });
        }

        const newUser = await usersModule.createUser({
            username,
            nom,
            email,
            idRole,
            idDepartement
        }, req.superAdmin.username);

        res.json({
            success: true,
            message: "Utilisateur créé avec succès",
            data: {
                user: newUser,
                defaultPassword: "1234"
            }
        });

    } catch (error) {
        console.error('❌ Erreur create user:', error);
        res.status(400).json({
            success: false,
            message: error.message || "Erreur lors de la création"
        });
    }
});

/**
 * GET /api/superadmin/test
 * Route de test pour vérifier l'authentification
 */
router.get('/test', requireSuperAdmin, async (req, res) => {
    try {
        res.json({
            success: true,
            message: "Authentification Super Admin réussie !",
            user: {
                username: req.superAdmin.username,
                niveau: req.superAdmin.role.niveau,
                role: req.superAdmin.role.nom
            }
        });
    } catch (error) {
        console.error('❌ Erreur test:', error);
        res.status(500).json({
            success: false,
            message: "Erreur serveur"
        });
    }
});

// ============================================
// MODULE MAINTENANCE
// ============================================

/**
 * GET /api/superadmin/maintenance/status
 * Vérifier l'état de la maintenance
 */
router.get('/maintenance/status', requireSuperAdmin, async (req, res) => {
    try {
        const systemSettings = await collections.systemSettings.findOne({ _id: 'maintenance' });

        res.json({
            success: true,
            maintenanceMode: systemSettings?.enabled || false,
            maintenanceBy: systemSettings?.enabledBy || null,
            maintenanceAt: systemSettings?.enabledAt || null
        });
    } catch (error) {
        console.error('❌ Erreur maintenance/status:', error);
        res.status(500).json({
            success: false,
            message: "Erreur lors de la vérification du statut"
        });
    }
});

/**
 * POST /api/superadmin/maintenance/enable
 * Activer le mode maintenance (bloquer tous les utilisateurs sauf Super Admin)
 */
router.post('/maintenance/enable', requireSuperAdmin, async (req, res) => {
    try {
        const username = req.superAdmin.username;

        // Activer le mode maintenance dans systemSettings avec whitelist vide
        await collections.systemSettings.updateOne(
            { _id: 'maintenance' },
            {
                $set: {
                    enabled: true,
                    enabledBy: username,
                    enabledAt: new Date(),
                    whitelist: [] // Initialiser whitelist vide
                }
            },
            { upsert: true }
        );

        // Logger l'action
        await logAction(username, 'MAINTENANCE_MODE_ENABLED', {}, {}, req);

        console.log(`🔒 Mode maintenance activé par ${username} (whitelist initialisée)`);

        res.json({
            success: true,
            message: "Mode maintenance activé. Tous les utilisateurs (sauf Super Admin) sont bloqués."
        });
    } catch (error) {
        console.error('❌ Erreur maintenance/enable:', error);
        res.status(500).json({
            success: false,
            message: "Erreur lors de l'activation de la maintenance"
        });
    }
});

/**
 * POST /api/superadmin/maintenance/disable
 * Désactiver le mode maintenance (débloquer tous les utilisateurs)
 */
router.post('/maintenance/disable', requireSuperAdmin, async (req, res) => {
    try {
        const username = req.superAdmin.username;

        // Désactiver le mode maintenance et vider la whitelist
        await collections.systemSettings.updateOne(
            { _id: 'maintenance' },
            {
                $set: {
                    enabled: false,
                    disabledBy: username,
                    disabledAt: new Date(),
                    whitelist: [] // Vider la whitelist
                }
            },
            { upsert: true }
        );

        // Logger l'action
        await logAction(username, 'MAINTENANCE_MODE_DISABLED', {}, {}, req);

        console.log(`🔓 Mode maintenance désactivé par ${username} (whitelist vidée)`);

        res.json({
            success: true,
            message: "Mode maintenance désactivé. Tous les utilisateurs peuvent se reconnecter."
        });
    } catch (error) {
        console.error('❌ Erreur maintenance/disable:', error);
        res.status(500).json({
            success: false,
            message: "Erreur lors de la désactivation de la maintenance"
        });
    }
});

/**
 * POST /api/superadmin/force-logout-all
 * Déconnecter tous les utilisateurs (sauf Super Admin)
 * VRAIE déconnexion : destruction des sessions Express + isOnline=false
 */
router.post('/force-logout-all', requireSuperAdmin, async (req, res) => {
    try {
        const username = req.superAdmin.username;

        // 1️⃣ Récupérer tous les sessionID des utilisateurs non-admin
        const usersToDisconnect = await collections.users.find(
            {
                'role.niveau': { $ne: 0 }, // Tous sauf niveau 0
                sessionID: { $exists: true } // Qui ont une session active
            }
        ).toArray();

        console.log(`🔴 ${usersToDisconnect.length} utilisateur(s) avec session active à déconnecter`);

        let sessionsDestroyed = 0;

        // 2️⃣ Détruire chaque session Express
        for (const user of usersToDisconnect) {
            if (user.sessionID) {
                try {
                    await new Promise((resolve, reject) => {
                        req.sessionStore.destroy(user.sessionID, (err) => {
                            if (err) {
                                console.error(`❌ Erreur destruction session ${user.username}:`, err);
                                reject(err);
                            } else {
                                console.log(`✅ Session détruite pour: ${user.username}`);
                                sessionsDestroyed++;
                                resolve();
                            }
                        });
                    });
                } catch (error) {
                    console.error(`❌ Erreur lors de la destruction de session pour ${user.username}:`, error);
                }
            }
        }

        // 3️⃣ Mettre à jour MongoDB (isOnline=false + supprimer sessionID)
        const result = await collections.users.updateMany(
            { 'role.niveau': { $ne: 0 } }, // Tous sauf niveau 0
            {
                $set: {
                    isOnline: false,
                    lastActivity: new Date()
                },
                $unset: {
                    sessionID: "" // Supprimer le sessionID
                }
            }
        );

        // Logger l'action
        await logAction(username, 'FORCE_LOGOUT_ALL_USERS',
            {
                usersDisconnected: result.modifiedCount,
                sessionsDestroyed: sessionsDestroyed
            }, {}, req);

        console.log(`🔴 ${username} a déconnecté ${result.modifiedCount} utilisateur(s)`);
        console.log(`💥 ${sessionsDestroyed} session(s) Express détruite(s)`);

        res.json({
            success: true,
            message: `${result.modifiedCount} utilisateur(s) déconnecté(s) avec succès`,
            count: result.modifiedCount,
            sessionsDestroyed: sessionsDestroyed
        });
    } catch (error) {
        console.error('❌ Erreur force-logout-all:', error);
        res.status(500).json({
            success: false,
            message: "Erreur lors de la déconnexion des utilisateurs"
        });
    }
});

// ============================================
// MODULE 3 : GESTION DES DOCUMENTS
// ============================================

/**
 * GET /api/superadmin/documents/stats
 * Statistiques globales des documents
 */
router.get('/documents/stats', requireSuperAdmin, async (req, res) => {
    try {
        const { period, startDate, endDate } = req.query;

        const stats = await documentsModule.getDocumentsStats({
            period: period || 'all',
            startDate: startDate ? new Date(startDate) : null,
            endDate: endDate ? new Date(endDate) : null
        });

        await logAction(req.superAdmin.username, 'SUPERADMIN_VIEW_DOCUMENTS_STATS',
            { period, startDate, endDate }, {}, req);

        res.json({ success: true, data: stats });
    } catch (error) {
        console.error('❌ Erreur documents/stats:', error);
        res.status(500).json({ success: false, message: "Erreur lors de la récupération des statistiques" });
    }
});

/**
 * GET /api/superadmin/documents/most-shared
 * Top 10 documents les plus partagés
 */
router.get('/documents/most-shared', requireSuperAdmin, async (req, res) => {
    try {
        const { period, startDate, endDate } = req.query;

        const result = await documentsModule.getMostSharedDocuments({
            period: period || 'all',
            startDate: startDate ? new Date(startDate) : null,
            endDate: endDate ? new Date(endDate) : null
        });

        res.json({ success: true, data: result });
    } catch (error) {
        console.error('❌ Erreur documents/most-shared:', error);
        res.status(500).json({ success: false, message: "Erreur lors de la récupération" });
    }
});

/**
 * GET /api/superadmin/documents/most-downloaded
 * Top 10 documents les plus téléchargés
 */
router.get('/documents/most-downloaded', requireSuperAdmin, async (req, res) => {
    try {
        const { period, startDate, endDate } = req.query;

        const result = await documentsModule.getMostDownloadedDocuments({
            period: period || 'all',
            startDate: startDate ? new Date(startDate) : null,
            endDate: endDate ? new Date(endDate) : null
        });

        res.json({ success: true, data: result });
    } catch (error) {
        console.error('❌ Erreur documents/most-downloaded:', error);
        res.status(500).json({ success: false, message: "Erreur lors de la récupération" });
    }
});

/**
 * GET /api/superadmin/documents/level1-deletions
 * Utilisateurs niveau 1 ayant supprimé des documents
 */
router.get('/documents/level1-deletions', requireSuperAdmin, async (req, res) => {
    try {
        const { period, startDate, endDate } = req.query;

        const result = await documentsModule.getLevel1Deletions({
            period: period || 'all',
            startDate: startDate ? new Date(startDate) : null,
            endDate: endDate ? new Date(endDate) : null
        });

        res.json({ success: true, data: result });
    } catch (error) {
        console.error('❌ Erreur documents/level1-deletions:', error);
        res.status(500).json({ success: false, message: "Erreur lors de la récupération" });
    }
});

/**
 * GET /api/superadmin/documents/deleted
 * Liste des documents supprimés
 */
router.get('/documents/deleted', requireSuperAdmin, async (req, res) => {
    try {
        const { period, startDate, endDate, page = 1, limit = 20 } = req.query;

        const result = await documentsModule.getDeletedDocuments({
            period: period || 'all',
            startDate: startDate ? new Date(startDate) : null,
            endDate: endDate ? new Date(endDate) : null,
            page: parseInt(page),
            limit: parseInt(limit)
        });

        res.json({ success: true, data: result });
    } catch (error) {
        console.error('❌ Erreur documents/deleted:', error);
        res.status(500).json({ success: false, message: "Erreur lors de la récupération" });
    }
});

/**
 * GET /api/superadmin/documents/locked
 * Liste des documents verrouillés
 */
router.get('/documents/locked', requireSuperAdmin, async (req, res) => {
    try {
        const { period, startDate, endDate, page = 1, limit = 20 } = req.query;

        const result = await documentsModule.getLockedDocuments({
            period: period || 'all',
            startDate: startDate ? new Date(startDate) : null,
            endDate: endDate ? new Date(endDate) : null,
            page: parseInt(page),
            limit: parseInt(limit)
        });

        res.json({ success: true, data: result });
    } catch (error) {
        console.error('❌ Erreur documents/locked:', error);
        res.status(500).json({ success: false, message: "Erreur lors de la récupération" });
    }
});

/**
 * GET /api/superadmin/documents/activity
 * Activité globale (création, suppression, téléchargement, partage)
 */
router.get('/documents/activity', requireSuperAdmin, async (req, res) => {
    try {
        const { period, startDate, endDate } = req.query;

        const result = await documentsModule.getDocumentsActivity({
            period: period || 'all',
            startDate: startDate ? new Date(startDate) : null,
            endDate: endDate ? new Date(endDate) : null
        });

        res.json({ success: true, data: result });
    } catch (error) {
        console.error('❌ Erreur documents/activity:', error);
        res.status(500).json({ success: false, message: "Erreur lors de la récupération" });
    }
});

/**
 * GET /api/superadmin/documents/timeline
 * Timeline des actions sur documents (pour graphique)
 */
router.get('/documents/timeline', requireSuperAdmin, async (req, res) => {
    try {
        const { period, startDate, endDate } = req.query;

        const result = await documentsModule.getDocumentTimeline({
            period: period || 'all',
            startDate: startDate ? new Date(startDate) : null,
            endDate: endDate ? new Date(endDate) : null
        });

        res.json({ success: true, data: result });
    } catch (error) {
        console.error('❌ Erreur documents/timeline:', error);
        res.status(500).json({ success: false, message: "Erreur lors de la récupération" });
    }
});

/**
 * GET /api/superadmin/documents/all
 * Liste tous les documents avec pagination
 */
router.get('/documents/all', requireSuperAdmin, async (req, res) => {
    try {
        const { period, startDate, endDate, page = 1, limit = 20, search = '' } = req.query;

        const result = await documentsModule.getAllDocuments({
            period: period || 'all',
            startDate: startDate ? new Date(startDate) : null,
            endDate: endDate ? new Date(endDate) : null,
            page: parseInt(page),
            limit: parseInt(limit),
            search
        });

        res.json({ success: true, data: result });
    } catch (error) {
        console.error('❌ Erreur documents/all:', error);
        res.status(500).json({ success: false, message: "Erreur lors de la récupération" });
    }
});

// ============================================
// MODULE 4 : GESTION DES DÉPARTEMENTS
// ============================================

/**
 * GET /api/superadmin/departments
 * Liste tous les départements
 */
router.get('/departments', requireSuperAdmin, async (req, res) => {
    try {
        const { search, type = 'all', page = 1 } = req.query;

        const filters = {
            search,
            type, // 'all', 'main', 'services'
            page: parseInt(page),
            limit: 50
        };

        const result = await departmentsModule.getAllDepartments(filters);

        await logAction(req.superAdmin.username, 'SUPERADMIN_VIEW_DEPARTMENTS',
            { filters }, {}, req);

        res.json({
            success: true,
            data: result
        });

    } catch (error) {
        console.error('❌ Erreur /departments:', error);
        res.status(500).json({
            success: false,
            message: "Erreur lors de la récupération des départements"
        });
    }
});

/**
 * GET /api/superadmin/departments/stats
 * Statistiques des départements
 */
router.get('/departments/stats', requireSuperAdmin, async (req, res) => {
    try {
        const stats = await departmentsModule.getStats();

        res.json({
            success: true,
            data: stats
        });

    } catch (error) {
        console.error('❌ Erreur /departments/stats:', error);
        res.status(500).json({
            success: false,
            message: "Erreur lors de la récupération des statistiques"
        });
    }
});

/**
 * POST /api/superadmin/departments
 * Créer un département principal
 */
router.post('/departments', requireSuperAdmin, async (req, res) => {
    try {
        const { nom, code, description } = req.body;

        if (!nom || !code) {
            return res.status(400).json({
                success: false,
                message: "Nom et code requis"
            });
        }

        const newDepartment = await departmentsModule.createDepartment(
            { nom, code, description },
            req.superAdmin.username
        );

        res.json({
            success: true,
            message: "Département créé avec succès",
            data: newDepartment
        });

    } catch (error) {
        console.error('❌ Erreur POST /departments:', error);
        res.status(400).json({
            success: false,
            message: error.message || "Erreur lors de la création du département"
        });
    }
});

/**
 * PUT /api/superadmin/departments/:id
 * Modifier un département
 */
router.put('/departments/:id', requireSuperAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const { nom, code, description } = req.body;

        if (!nom || !code) {
            return res.status(400).json({
                success: false,
                message: "Nom et code requis"
            });
        }

        const updatedDepartment = await departmentsModule.updateDepartment(
            id,
            { nom, code, description },
            req.superAdmin.username
        );

        res.json({
            success: true,
            message: "Département modifié avec succès",
            data: updatedDepartment
        });

    } catch (error) {
        console.error('❌ Erreur PUT /departments/:id:', error);
        res.status(400).json({
            success: false,
            message: error.message || "Erreur lors de la modification du département"
        });
    }
});

/**
 * DELETE /api/superadmin/departments/:id
 * Supprimer un département
 */
router.delete('/departments/:id', requireSuperAdmin, async (req, res) => {
    try {
        const { id } = req.params;

        await departmentsModule.deleteDepartment(id, req.superAdmin.username);

        res.json({
            success: true,
            message: "Département supprimé avec succès"
        });

    } catch (error) {
        console.error('❌ Erreur DELETE /departments/:id:', error);
        res.status(400).json({
            success: false,
            message: error.message || "Erreur lors de la suppression du département"
        });
    }
});

// ============================================
// ROUTES FUTURES (Commentées pour le POC)
// ============================================

// TODO: Module Audit
// router.get('/audit/logs', requireSuperAdmin, async (req, res) => { ... });
// router.get('/audit/history', requireSuperAdmin, async (req, res) => { ... });

// TODO: Module Sécurité
// router.get('/security/dashboard', requireSuperAdmin, async (req, res) => { ... });

// TODO: Module Performance
// router.get('/performance/metrics', requireSuperAdmin, async (req, res) => { ... });

// ============================================
// EXPORT
// ============================================

module.exports = {
    router,
    init
};
