// ============================================
// SERVICE DE GESTION DES DOCUMENTS
// Logique métier pure pour les documents
// ============================================

const { ObjectId } = require('mongodb');
const { getCollections, getSecurityLogger } = require('../config/database');
const { getAccessibleDocuments } = require('./permissionsService');
const { generateDocumentId } = require('../utils/idGenerator');

/**
 * Créer un nouveau document
 */
async function createDocument(documentData, userId) {
    const collections = getCollections();

    // Vérifier l'utilisateur
    const user = await collections.users.findOne({ username: userId });
    if (!user) {
        throw new Error('Utilisateur non trouvé');
    }

    // Récupérer le rôle et le département
    const role = await collections.roles.findOne({ _id: user.idRole });
    const departement = user.idDepartement
        ? await collections.departements.findOne({ _id: user.idDepartement })
        : null;

    // Déterminer archivage (service ou département)
    const isNiveau123 = role && (role.niveau == 1 || role.niveau == 2 || role.niveau == 3);
    const idArchivage = documentData.departementArchivage || user.idDepartement;

    let serviceArchivage = null;
    let idServiceArchivage = null;
    let deptArchivage = null;
    let idDeptArchivage = null;

    if (isNiveau123 && idArchivage) {
        // Chercher dans les services
        try {
            const service = await collections.services.findOne({ _id: new ObjectId(idArchivage) });
            if (service) {
                serviceArchivage = service.nom;
                idServiceArchivage = idArchivage;
            }
        } catch (error) {
            console.error('Erreur recherche service:', error.message);
        }
    } else if (idArchivage) {
        // Chercher dans les départements
        try {
            const dept = await collections.departements.findOne({ _id: new ObjectId(idArchivage) });
            if (dept) {
                deptArchivage = dept.nom;
                idDeptArchivage = idArchivage;
            }
        } catch (error) {
            console.error('Erreur recherche département:', error.message);
        }
    }

    // Générer ID unique
    const idDocument = await generateDocumentId(collections.documents);

    // Créer le document
    const document = {
        idDocument,
        idUtilisateur: userId,
        titre: documentData.titre,
        categorie: documentData.categorie,
        date: documentData.date || new Date(),
        description: documentData.description,
        tags: documentData.tags,
        nomFichier: documentData.nomFichier,
        taille: documentData.taille,
        type: documentData.type,
        contenu: documentData.contenu,
        idDepartement: user.idDepartement,
        createdAt: new Date(),
        departementArchivage: deptArchivage,
        idDepartementArchivage: idDeptArchivage,
        serviceArchivage: serviceArchivage,
        idService: idServiceArchivage ? new ObjectId(idServiceArchivage) : null,
        archivePar: {
            utilisateur: userId,
            nomComplet: user.nom,
            email: user.email,
            niveau: role ? role.niveau : null,
            role: role ? role.libelle : null,
            departement: departement ? departement.nom : null,
            dateArchivage: new Date()
        },
        locked: documentData.locked || false,
        sharedWith: [],
        accessLog: [],
        downloadCount: 0
    };

    const result = await collections.documents.insertOne(document);

    console.log(`✅ Document créé: ${idDocument} par ${userId}`);

    return {
        success: true,
        documentId: idDocument,
        _id: result.insertedId
    };
}

/**
 * Récupérer un document spécifique
 */
async function getDocument(userId, docId) {
    const collections = getCollections();
    const accessibleDocs = await getAccessibleDocuments(userId);

    const document = accessibleDocs.find(
        doc => doc._id.toString() === docId || doc.idDocument === docId
    );

    if (!document) {
        throw new Error('Document non trouvé ou accès refusé');
    }

    return document;
}

/**
 * Supprimer un document (soft delete)
 */
async function deleteDocument(userId, docId, motif) {
    const collections = getCollections();

    // Vérifier l'accès
    const document = await getDocument(userId, docId);

    // Mettre à jour le document (soft delete)
    await collections.documents.updateOne(
        { _id: document._id },
        {
            $set: {
                deleted: true,
                deletedAt: new Date(),
                deletedBy: userId,
                deletionMotif: motif,
                expiresAt: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000) // 60 jours
            }
        }
    );

    // Logger
    await collections.auditLogs.insertOne({
        timestamp: new Date(),
        user: userId,
        action: 'DOCUMENT_DELETED',
        details: {
            documentId: document.idDocument,
            titre: document.titre,
            motif
        }
    });

    console.log(`🗑️ Document supprimé (soft delete): ${document.idDocument}`);

    return { success: true };
}

/**
 * Partager un document
 */
async function shareDocument(userId, docId, usersToShare) {
    const collections = getCollections();

    // Vérifier l'accès
    const document = await getDocument(userId, docId);

    // Ajouter les utilisateurs au partage
    await collections.documents.updateOne(
        { _id: document._id },
        {
            $addToSet: { sharedWith: { $each: usersToShare } }
        }
    );

    // Historique de partage
    await collections.shareHistory.insertOne({
        documentId: document.idDocument,
        sharedBy: userId,
        sharedWith: usersToShare,
        date: new Date()
    });

    console.log(`📤 Document partagé: ${document.idDocument} avec ${usersToShare.join(', ')}`);

    return { success: true };
}

/**
 * Retirer le partage
 */
async function unshareDocument(userId, docId, userToRemove) {
    const collections = getCollections();

    // Vérifier l'accès
    const document = await getDocument(userId, docId);

    await collections.documents.updateOne(
        { _id: document._id },
        {
            $pull: { sharedWith: userToRemove }
        }
    );

    console.log(`📥 Partage retiré: ${document.idDocument} pour ${userToRemove}`);

    return { success: true };
}

/**
 * Verrouiller/Déverrouiller un document (niveau 1 uniquement)
 */
async function toggleLock(userId, docId) {
    const collections = getCollections();

    // Vérifier niveau 1
    const user = await collections.users.findOne({ username: userId });
    const userRole = await collections.roles.findOne({ _id: user.idRole });

    if (userRole.niveau !== 1) {
        throw new Error('Seuls les utilisateurs niveau 1 peuvent verrouiller des documents');
    }

    // Vérifier l'accès
    const document = await getDocument(userId, docId);

    const newLockedState = !document.locked;

    await collections.documents.updateOne(
        { _id: document._id },
        {
            $set: {
                locked: newLockedState,
                lockedBy: newLockedState ? userId : null,
                lockedAt: newLockedState ? new Date() : null
            }
        }
    );

    console.log(`🔒 Document ${newLockedState ? 'verrouillé' : 'déverrouillé'}: ${document.idDocument}`);

    return {
        success: true,
        locked: newLockedState
    };
}

/**
 * Enregistrer un téléchargement
 */
async function recordDownload(userId, docId) {
    const collections = getCollections();

    // Vérifier l'accès
    const document = await getDocument(userId, docId);

    await collections.documents.updateOne(
        { _id: document._id },
        {
            $inc: { downloadCount: 1 },
            $push: {
                accessLog: {
                    user: userId,
                    action: 'download',
                    date: new Date()
                }
            }
        }
    );

    return { success: true };
}

/**
 * Restaurer un document depuis la corbeille
 */
async function restoreDocument(userId, docId) {
    const collections = getCollections();

    const document = await collections.documents.findOne({
        $or: [
            { _id: new ObjectId(docId) },
            { idDocument: docId }
        ]
    });

    if (!document) {
        throw new Error('Document non trouvé');
    }

    await collections.documents.updateOne(
        { _id: document._id },
        {
            $unset: {
                deleted: "",
                deletedAt: "",
                deletedBy: "",
                deletionMotif: "",
                expiresAt: ""
            }
        }
    );

    console.log(`♻️ Document restauré: ${document.idDocument}`);

    return { success: true };
}

/**
 * Suppression définitive
 */
async function permanentDelete(userId, docId) {
    const collections = getCollections();

    const document = await collections.documents.findOne({
        $or: [
            { _id: new ObjectId(docId) },
            { idDocument: docId }
        ]
    });

    if (!document) {
        throw new Error('Document non trouvé');
    }

    await collections.documents.deleteOne({ _id: document._id });

    await collections.auditLogs.insertOne({
        timestamp: new Date(),
        user: userId,
        action: 'DOCUMENT_PERMANENT_DELETE',
        details: {
            documentId: document.idDocument,
            titre: document.titre
        }
    });

    console.log(`💀 Document supprimé définitivement: ${document.idDocument}`);

    return { success: true };
}

/**
 * Supprimer tous les documents accessibles
 */
async function deleteAll(userId, motif) {
    const collections = getCollections();

    const accessibleDocs = await getAccessibleDocuments(userId);

    const updatePromises = accessibleDocs.map(doc =>
        collections.documents.updateOne(
            { _id: doc._id },
            {
                $set: {
                    deleted: true,
                    deletedAt: new Date(),
                    deletedBy: userId,
                    deletionMotif: motif,
                    expiresAt: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000)
                }
            }
        )
    );

    await Promise.all(updatePromises);

    console.log(`🗑️ ${accessibleDocs.length} documents supprimés par ${userId}`);

    return {
        success: true,
        count: accessibleDocs.length
    };
}

module.exports = {
    createDocument,
    getDocument,
    deleteDocument,
    shareDocument,
    unshareDocument,
    toggleLock,
    recordDownload,
    restoreDocument,
    permanentDelete,
    deleteAll
};
