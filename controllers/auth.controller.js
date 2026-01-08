// ============================================
// CONTROLLER D'AUTHENTIFICATION
// Gestion des requêtes HTTP et réponses
// ============================================

const authService = require('../services/authService');

/**
 * Login - POST /api/login
 */
async function login(req, res) {
    try {
        const { username, password } = req.body;

        // Validation
        if (!username || !password) {
            return res.status(400).json({
                success: false,
                message: 'Username et password requis'
            });
        }

        // Métadonnées de la requête
        const metadata = {
            ip: req.ip,
            userAgent: req.headers['user-agent']
        };

        // Appeler le service d'authentification
        const result = await authService.authenticateUser(username, password, metadata);

        if (!result.success) {
            return res.status(401).json(result);
        }

        // 🔒 BLOQUER les Super Admins (niveau 0) - ils doivent utiliser /api/admin-login
        if (result.user.niveau === 0) {
            const { getCollections } = require('../config/database');
            const collections = getCollections();

            // Logger la tentative bloquée
            await collections.auditLogs.insertOne({
                timestamp: new Date(),
                user: username,
                action: 'TENTATIVE_CONNEXION_SUPERADMIN_BLOQUEE',
                details: {
                    ip: req.ip,
                    userAgent: req.headers['user-agent'],
                    statut: 'REFUSÉ - Doit utiliser /api/admin-login'
                },
                ip: req.ip,
                userAgent: req.headers['user-agent']
            });

            console.log(`🔒 TENTATIVE BLOQUÉE: Super Admin "${username}" a tenté de se connecter via /api/login`);

            return res.status(403).json({
                success: false,
                message: '🔒 Les comptes Super Administrateurs doivent se connecter via l\'interface dédiée'
            });
        }

        // Créer la session
        req.session.userId = username;
        req.session.userLevel = result.user.niveau;

        // Sauvegarder la session avant de répondre
        await new Promise((resolve, reject) => {
            req.session.save((err) => {
                if (err) {
                    console.error('❌ Erreur sauvegarde session:', err);
                    reject(err);
                } else {
                    console.log(`✅ Session créée pour: ${username} (niveau ${req.session.userLevel})`);
                    resolve();
                }
            });
        });

        res.json({
            success: true,
            message: 'Connexion réussie',
            user: result.user
        });

    } catch (error) {
        console.error('❌ Erreur login:', error);
        res.status(500).json({
            success: false,
            message: 'Erreur serveur'
        });
    }
}

/**
 * Logout - POST /api/logout
 */
async function logout(req, res) {
    try {
        const username = req.session?.userId;

        if (username) {
            await authService.logoutUser(username);
        }

        // Détruire la session
        req.session.destroy((err) => {
            if (err) {
                console.error('❌ Erreur destruction session:', err);
                return res.status(500).json({
                    success: false,
                    message: 'Erreur lors de la déconnexion'
                });
            }

            res.json({
                success: true,
                message: 'Déconnexion réussie'
            });
        });

    } catch (error) {
        console.error('❌ Erreur logout:', error);
        res.status(500).json({
            success: false,
            message: 'Erreur serveur'
        });
    }
}

/**
 * Vérifier le statut de session - GET /api/session-check
 */
function checkSession(req, res) {
    if (req.session && req.session.userId) {
        res.json({
            authenticated: true,
            username: req.session.userId
        });
    } else {
        res.json({
            authenticated: false,
            username: null
        });
    }
}

/**
 * Obtenir les informations de l'utilisateur connecté - GET /api/user-info
 */
async function getUserInfo(req, res) {
    try {
        if (!req.session || !req.session.userId) {
            return res.status(401).json({
                success: false,
                message: 'Non authentifié'
            });
        }

        const { getCollections } = require('../config/database');
        const collections = getCollections();

        const user = await collections.users.findOne({ username: req.session.userId });
        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'Utilisateur non trouvé'
            });
        }

        const userRole = await collections.roles.findOne({ _id: user.idRole });
        const departement = user.idDepartement
            ? await collections.departements.findOne({ _id: user.idDepartement })
            : null;

        res.json({
            success: true,
            username: user.username,
            nom: user.nom,
            email: user.email,
            niveau: userRole ? userRole.niveau : null,
            role: userRole ? userRole.libelle : null,
            departement: departement ? departement.nom : null,
            idDepartement: user.idDepartement
        });

    } catch (error) {
        console.error('❌ Erreur getUserInfo:', error);
        res.status(500).json({
            success: false,
            message: 'Erreur serveur'
        });
    }
}

/**
 * Admin Login - POST /api/admin-login
 * Endpoint dédié pour la connexion des Super Administrateurs (niveau 0)
 */
async function adminLogin(req, res) {
    try {
        const { username, password } = req.body;

        // Validation
        if (!username || !password) {
            return res.status(400).json({
                success: false,
                message: 'Username et password requis'
            });
        }

        // Métadonnées de la requête
        const metadata = {
            ip: req.ip,
            userAgent: req.headers['user-agent']
        };

        // Appeler le service d'authentification
        const result = await authService.authenticateUser(username, password, metadata);

        if (!result.success) {
            return res.status(401).json(result);
        }

        // Vérifier que l'utilisateur est bien un Super Admin (niveau 0)
        if (result.user.niveau !== 0) {
            const { getCollections } = require('../config/database');
            const collections = getCollections();

            // Logger la tentative d'accès non autorisée
            await collections.auditLogs.insertOne({
                timestamp: new Date(),
                user: username,
                action: 'TENTATIVE_ACCES_ADMIN_LOGIN_REFUSE',
                details: {
                    ip: req.ip,
                    userAgent: req.headers['user-agent'],
                    niveau: result.user.niveau,
                    statut: 'REFUSÉ'
                },
                ip: req.ip,
                userAgent: req.headers['user-agent']
            });

            console.log(`🔒 TENTATIVE BLOQUÉE: "${username}" (niveau ${result.user.niveau}) a tenté d'accéder à /api/admin-login`);

            return res.status(403).json({
                success: false,
                message: 'Accès refusé. Cette interface est réservée aux Super Administrateurs.'
            });
        }

        // Créer la session
        req.session.userId = username;
        req.session.userLevel = 0;
        req.session.isAuthenticated = true;

        // Sauvegarder la session avant de répondre
        await new Promise((resolve, reject) => {
            req.session.save(async (err) => {
                if (err) {
                    console.error('❌ Erreur sauvegarde session:', err);
                    reject(err);
                } else {
                    // Logger le succès de connexion
                    const { getCollections } = require('../config/database');
                    const collections = getCollections();

                    await collections.auditLogs.insertOne({
                        timestamp: new Date(),
                        user: username,
                        action: 'SUCCES_CONNEXION_SUPERADMIN',
                        details: {
                            ip: req.ip,
                            userAgent: req.headers['user-agent'],
                            statut: 'Connexion réussie via /api/admin-login'
                        },
                        ip: req.ip,
                        userAgent: req.headers['user-agent']
                    });

                    console.log(`✅ SUCCÈS CONNEXION SUPER ADMIN: ${username} depuis ${req.ip} via /api/admin-login`);
                    resolve();
                }
            });
        });

        res.json({
            success: true,
            message: 'Connexion Super Admin réussie',
            user: result.user
        });

    } catch (error) {
        console.error('❌ Erreur admin-login:', error);
        res.status(500).json({
            success: false,
            message: 'Erreur serveur'
        });
    }
}

/**
 * Verify Session - POST /api/verify-session
 * Vérifier et restaurer la session après un refresh
 */
async function verifySession(req, res) {
    try {
        const { username } = req.body;

        if (!username) {
            return res.status(400).json({
                success: false,
                message: 'Username requis'
            });
        }

        const { getCollections } = require('../config/database');
        const collections = getCollections();

        // Vérifier que l'utilisateur existe toujours
        const user = await collections.users.findOne({ username });

        if (!user) {
            return res.status(401).json({
                success: false,
                message: 'Session invalide'
            });
        }

        // Récupérer les infos complètes
        const role = await collections.roles.findOne({ _id: user.idRole });
        const departement = user.idDepartement
            ? await collections.departements.findOne({ _id: user.idDepartement })
            : null;

        res.json({
            success: true,
            user: {
                username: user.username,
                nom: user.nom,
                email: user.email,
                role: role ? role.libelle : 'Non défini',
                niveau: role ? role.niveau : 0,
                departement: departement ? departement.nom : 'Aucun (Admin Principal)',
                idDepartement: user.idDepartement,
                idRole: user.idRole
            }
        });

    } catch (error) {
        console.error('❌ Erreur vérification session:', error);
        res.status(500).json({
            success: false,
            message: 'Erreur serveur'
        });
    }
}

module.exports = {
    login,
    logout,
    checkSession,
    getUserInfo,
    adminLogin,
    verifySession
};
