// ============================================
// CONTROLLER DES UTILISATEURS
// Gestion des requêtes HTTP et réponses
// ============================================

const { validationResult } = require('express-validator');
const userService = require('../services/userService');
const { getCollections } = require('../config/database');
const constants = require('../utils/constants');

/**
 * POST /api/users/register - Inscription nouvel utilisateur
 */
async function register(req, res) {
    try {
        // Validation
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                success: false,
                message: 'Données invalides',
                errors: errors.array()
            });
        }

        const { nom, prenom, email, username, password, niveau, idDepartement, secretCode } = req.body;

        // Vérifier le code secret
        if (secretCode !== constants.EMAIL.REGISTRATION_SECRET_CODE) {
            return res.status(403).json({
                success: false,
                message: 'Code secret invalide'
            });
        }

        // Créer l'utilisateur
        const result = await userService.createUser({
            nom,
            prenom,
            email,
            username,
            password,
            idRole: niveau,  // Niveau correspond à idRole
            idDepartement
        });

        res.json({
            success: true,
            message: 'Compte créé avec succès. Vérifiez vos emails.',
            username: result.username
        });

    } catch (error) {
        console.error('❌ Erreur register:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Erreur serveur'
        });
    }
}

/**
 * GET /api/users - Liste utilisateurs (avec filtrage niveau)
 */
async function getUsers(req, res) {
    try {
        const requestingUser = req.session?.userId;

        if (!requestingUser) {
            return res.status(401).json({
                success: false,
                message: 'Non authentifié'
            });
        }

        // Obtenir la liste filtrée selon les permissions
        const users = await userService.getFilteredUsers(requestingUser);

        // Enrichir avec les informations de rôle et département
        const collections = getCollections();
        const enrichedUsers = await Promise.all(
            users.map(async (user) => {
                const role = user.idRole ? await collections.roles.findOne({ _id: user.idRole }) : null;
                const dept = user.idDepartement ? await collections.departements.findOne({ _id: user.idDepartement }) : null;

                return {
                    username: user.username,
                    nom: user.nom,
                    prenom: user.prenom,
                    email: user.email,
                    role: role ? role.libelle : 'Non défini',
                    niveau: role ? role.niveau : null,
                    departement: dept ? dept.nom : 'Aucun',
                    createdBy: user.createdBy,
                    createdAt: user.createdAt,
                    isOnline: user.isOnline,
                    blocked: user.blocked
                };
            })
        );

        // Désactiver le cache HTTP
        res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');

        res.json({
            success: true,
            users: enrichedUsers,
            total: enrichedUsers.length
        });

    } catch (error) {
        console.error('❌ Erreur getUsers:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Erreur serveur'
        });
    }
}

/**
 * GET /api/users/:username - Détail utilisateur
 */
async function getUserDetails(req, res) {
    try {
        const { username } = req.params;
        const requestingUser = req.session?.userId;

        // Vérifier les permissions
        const hasPermission = await userService.checkUserPermissions(requestingUser, username);
        if (!hasPermission) {
            return res.status(403).json({
                success: false,
                message: 'Accès refusé'
            });
        }

        // Récupérer l'utilisateur
        const user = await userService.findByUsername(username);
        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'Utilisateur non trouvé'
            });
        }

        // Enrichir avec rôle et département
        const collections = getCollections();
        const role = user.idRole ? await collections.roles.findOne({ _id: user.idRole }) : null;
        const dept = user.idDepartement ? await collections.departements.findOne({ _id: user.idDepartement }) : null;

        res.json({
            success: true,
            user: {
                username: user.username,
                nom: user.nom,
                prenom: user.prenom,
                email: user.email,
                role: role ? role.libelle : 'Non défini',
                niveau: role ? role.niveau : null,
                departement: dept ? dept.nom : 'Aucun',
                idDepartement: user.idDepartement,
                createdBy: user.createdBy,
                createdAt: user.createdAt,
                isOnline: user.isOnline,
                blocked: user.blocked,
                blockedReason: user.blockedReason
            }
        });

    } catch (error) {
        console.error('❌ Erreur getUserDetails:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Erreur serveur'
        });
    }
}

/**
 * POST /api/users - Créer utilisateur
 */
async function createUser(req, res) {
    try {
        // Validation
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                success: false,
                message: 'Données invalides',
                errors: errors.array()
            });
        }

        const createdBy = req.session?.userId;
        const { username, email, password, nom, prenom, idRole, idDepartement } = req.body;

        // Créer l'utilisateur
        const result = await userService.createUser({
            username,
            email,
            password,
            nom,
            prenom,
            idRole,
            idDepartement
        }, createdBy);

        res.json(result);

    } catch (error) {
        console.error('❌ Erreur createUser:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Erreur serveur'
        });
    }
}

/**
 * PUT /api/users/:username - Modifier utilisateur
 */
async function updateUser(req, res) {
    try {
        const { username } = req.params;
        const updatedBy = req.session?.userId;

        // Vérifier les permissions
        const hasPermission = await userService.checkUserPermissions(updatedBy, username);
        if (!hasPermission) {
            return res.status(403).json({
                success: false,
                message: 'Accès refusé'
            });
        }

        // Validation
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                success: false,
                message: 'Données invalides',
                errors: errors.array()
            });
        }

        // Mettre à jour
        await userService.updateUser(username, req.body, updatedBy);

        res.json({
            success: true,
            message: 'Utilisateur modifié avec succès'
        });

    } catch (error) {
        console.error('❌ Erreur updateUser:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Erreur serveur'
        });
    }
}

/**
 * DELETE /api/users/:username - Supprimer utilisateur
 */
async function deleteUser(req, res) {
    try {
        const { username } = req.params;
        const deletedBy = req.session?.userId;

        // Vérifier les permissions
        const hasPermission = await userService.checkUserPermissions(deletedBy, username);
        if (!hasPermission) {
            return res.status(403).json({
                success: false,
                message: 'Accès refusé'
            });
        }

        // Supprimer
        await userService.deleteUser(username, deletedBy);

        res.json({
            success: true,
            message: 'Utilisateur supprimé avec succès'
        });

    } catch (error) {
        console.error('❌ Erreur deleteUser:', error);

        if (error.message === 'Impossible de supprimer un compte Super Administrateur') {
            return res.status(403).json({
                success: false,
                message: error.message
            });
        }

        res.status(500).json({
            success: false,
            message: error.message || 'Erreur serveur'
        });
    }
}

/**
 * POST /api/users/:username/reset-password - Réinitialiser mot de passe
 */
async function resetPassword(req, res) {
    try {
        const { username } = req.params;
        const { newPassword } = req.body;

        if (!newPassword) {
            return res.status(400).json({
                success: false,
                message: 'Nouveau mot de passe requis'
            });
        }

        await userService.resetPassword(username, newPassword);

        res.json({
            success: true,
            message: 'Mot de passe réinitialisé avec succès'
        });

    } catch (error) {
        console.error('❌ Erreur resetPassword:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Erreur serveur'
        });
    }
}

/**
 * POST /api/users/:username/change-password - Changer mot de passe
 */
async function changePassword(req, res) {
    try {
        const { username } = req.params;
        const requestingUser = req.session?.userId;

        // Vérifier que l'utilisateur change son propre mot de passe
        if (requestingUser !== username) {
            return res.status(403).json({
                success: false,
                message: 'Vous ne pouvez changer que votre propre mot de passe'
            });
        }

        // Validation
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                success: false,
                message: 'Données invalides',
                errors: errors.array()
            });
        }

        const { currentPassword, newPassword } = req.body;

        await userService.changePassword(username, currentPassword, newPassword);

        res.json({
            success: true,
            message: 'Mot de passe modifié avec succès'
        });

    } catch (error) {
        console.error('❌ Erreur changePassword:', error);

        if (error.message === 'Mot de passe actuel incorrect') {
            return res.status(401).json({
                success: false,
                message: error.message
            });
        }

        res.status(500).json({
            success: false,
            message: error.message || 'Erreur serveur'
        });
    }
}

/**
 * GET /api/users/for-sharing/:userId - Liste users pour partage
 */
async function getUsersForSharing(req, res) {
    try {
        const { userId } = req.params;

        // Utiliser la fonction de filtrage
        const users = await userService.getFilteredUsers(userId);

        // Exclure l'utilisateur lui-même
        const filteredUsers = users.filter(u => u.username !== userId);

        // Format simplifié pour le partage
        const sharingUsers = filteredUsers.map(u => ({
            username: u.username,
            nom: u.nom,
            email: u.email
        }));

        // Désactiver le cache HTTP
        res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');

        res.json({
            success: true,
            users: sharingUsers,
            total: sharingUsers.length
        });

    } catch (error) {
        console.error('❌ Erreur getUsersForSharing:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Erreur serveur'
        });
    }
}

module.exports = {
    register,
    getUsers,
    getUserDetails,
    createUser,
    updateUser,
    deleteUser,
    resetPassword,
    changePassword,
    getUsersForSharing
};
