// ============================================
// SERVICE DE GESTION DES PERMISSIONS
// Logique d'accès aux documents selon les niveaux
// ============================================

const { getCollections } = require('../config/database');
const constants = require('../utils/constants');

/**
 * Récupérer les documents accessibles par un utilisateur selon son niveau
 * @param {string} userId - Username de l'utilisateur
 * @returns {Promise<Array>} - Liste des documents accessibles
 */
async function getAccessibleDocuments(userId) {
    const collections = getCollections();

    const user = await collections.users.findOne({ username: userId });
    if (!user) {
        console.log(`❌ Utilisateur non trouvé: ${userId}`);
        return [];
    }

    const userRole = await collections.roles.findOne({ _id: user.idRole });
    if (!userRole) return [];

    console.log(`📋 Récupération documents pour: ${userId} (niveau ${userRole.niveau}, dept: ${user.idDepartement})`);

    let accessibleDocs = [];

    // ✅ NIVEAU 0 : Super Admin - Voit TOUS les documents (lecture seule)
    if (userRole.niveau == constants.PERMISSIONS.SUPER_ADMIN) {
        const allDocs = await collections.documents.find({
            deleted: { $ne: true }
        }).toArray();
        accessibleDocs = allDocs;
        console.log(`✅ NIVEAU 0 (Super Admin): Accès à TOUS les documents en LECTURE SEULE (${accessibleDocs.length})`);
        return accessibleDocs;
    }

    // ✅ NIVEAU 1 : Voit les documents de SON département ET des services de ce département
    if (userRole.niveau == constants.PERMISSIONS.PRIMAIRE) {
        if (!user.idDepartement) {
            console.log(`⚠️ Utilisateur niveau 1 sans département: Aucun document accessible`);
            return [];
        }

        // Récupérer tous les services du département
        const services = await collections.services.find({
            idDepartement: user.idDepartement
        }).toArray();

        const serviceIds = services.map(s => s._id);
        console.log(`📋 Services trouvés pour le département: ${services.map(s => s.nom).join(', ')} (${serviceIds.length})`);

        // Documents du département principal + documents de tous ses services
        const deptDocs = await collections.documents.find({
            deleted: { $ne: true },
            $or: [
                { idDepartement: user.idDepartement },
                { idService: { $in: serviceIds } }
            ]
        }).toArray();

        accessibleDocs = deptDocs;
        console.log(`✅ NIVEAU 1: Accès aux documents du département + services (${accessibleDocs.length})`);
        return accessibleDocs;
    }

    // ✅ NIVEAU 2 : Voit TOUS les documents de son département
    if (userRole.niveau == constants.PERMISSIONS.SECONDAIRE) {
        if (!user.idDepartement) {
            console.log(`⚠️ Utilisateur niveau 2 sans département: Aucun document accessible`);
            return [];
        }

        // Tous les documents du même département
        const deptDocs = await collections.documents.find({
            idDepartement: user.idDepartement,
            deleted: { $ne: true }
        }).toArray();

        // + Documents partagés avec lui depuis d'autres départements
        const sharedDocs = await collections.documents.find({
            sharedWith: userId,
            idDepartement: { $ne: user.idDepartement },
            deleted: { $ne: true }
        }).toArray();

        accessibleDocs = [...deptDocs, ...sharedDocs];
        console.log(`✅ NIVEAU 2: Accès à TOUS les documents du département (${deptDocs.length}) + partagés (${sharedDocs.length})`);
        return accessibleDocs;
    }

    // ✅ NIVEAU 3 : Voit uniquement ses documents + documents des autres niveau 3 du département + documents partagés
    if (userRole.niveau == constants.PERMISSIONS.TERTIAIRE) {
        if (!user.idDepartement) {
            console.log(`⚠️ Utilisateur niveau 3 sans département: Aucun document accessible`);
            return [];
        }

        // Récupérer tous les utilisateurs niveau 3 du même département
        const niveau3Users = await collections.users.find({
            idDepartement: user.idDepartement,
            idRole: userRole._id
        }).toArray();

        const niveau3Usernames = niveau3Users.map(u => u.username);
        console.log(`📋 Utilisateurs niveau 3 du département: ${niveau3Usernames.join(', ')}`);

        // Documents des utilisateurs niveau 3 du département
        const niveau3Docs = await collections.documents.find({
            idDepartement: user.idDepartement,
            idUtilisateur: { $in: niveau3Usernames },
            deleted: { $ne: true }
        }).toArray();

        // + Documents partagés avec lui
        const sharedDocs = await collections.documents.find({
            sharedWith: userId,
            deleted: { $ne: true }
        }).toArray();

        accessibleDocs = [...niveau3Docs, ...sharedDocs];
        console.log(`✅ NIVEAU 3: Accès documents niveau 3 du département (${niveau3Docs.length}) + partagés (${sharedDocs.length})`);
        return accessibleDocs;
    }

    console.log(`⚠️ Niveau inconnu (${userRole.niveau}): Aucun document accessible`);
    return [];
}

/**
 * Vérifier si un utilisateur peut accéder à un document spécifique
 * @param {string} userId - Username de l'utilisateur
 * @param {string} docId - ID du document
 * @returns {Promise<boolean>} - true si l'utilisateur peut accéder au document
 */
async function canAccessDocument(userId, docId) {
    const accessibleDocs = await getAccessibleDocuments(userId);
    return accessibleDocs.some(doc => doc._id.toString() === docId || doc.idDocument === docId);
}

module.exports = {
    getAccessibleDocuments,
    canAccessDocument
};
