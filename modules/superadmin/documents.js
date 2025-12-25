/**
 * ============================================
 * MODULE SUPER ADMIN - GESTION DES DOCUMENTS
 * ============================================
 *
 * Fournit les fonctionnalités de supervision et statistiques
 * sur les documents pour le dashboard Super Admin
 */

// Collections MongoDB
let documentsCollection;
let auditLogsCollection;
let departementsCollection;
let usersCollection;
let shareHistoryCollection;

/**
 * Initialiser le module avec les collections MongoDB
 */
function init(collections) {
    documentsCollection = collections.documents;
    auditLogsCollection = collections.auditLogs;
    departementsCollection = collections.departements;
    usersCollection = collections.users;
    shareHistoryCollection = collections.shareHistory;

    console.log('✅ Module Documents (Super Admin) initialisé');
}

/**
 * Helper : Calculer le filtre de dates basé sur la période
 * @param {string} period - Type de période ('today', '7days', '30days', 'all', 'custom')
 * @param {Date} customStart - Date de début pour période personnalisée
 * @param {Date} customEnd - Date de fin pour période personnalisée
 * @param {string} fieldName - Nom du champ de date à filtrer (par défaut 'createdAt')
 * @returns {Object} Filtre MongoDB
 */
function getPeriodFilter(period, customStart, customEnd, fieldName = 'createdAt') {
    const now = new Date();
    let startDate, endDate;

    switch (period) {
        case 'today':
            startDate = new Date(now.setHours(0, 0, 0, 0));
            endDate = new Date();
            break;
        case '7days':
            startDate = new Date();
            startDate.setDate(startDate.getDate() - 7);
            endDate = new Date();
            break;
        case '30days':
            startDate = new Date();
            startDate.setDate(startDate.getDate() - 30);
            endDate = new Date();
            break;
        case 'all':
            return {}; // Pas de filtre
        case 'custom':
            startDate = customStart;
            endDate = customEnd;
            break;
        default:
            return {};
    }

    const filter = {};
    if (startDate) filter.$gte = startDate;
    if (endDate) filter.$lte = endDate;

    return Object.keys(filter).length > 0 ? { [fieldName]: filter } : {};
}

/**
 * A. Obtenir les statistiques globales des documents
 */
async function getDocumentsStats(filters = {}) {
    try {
        const { period, startDate, endDate } = filters;
        const dateFilter = getPeriodFilter(period, startDate, endDate);

        // Stats globales
        const total = await documentsCollection.countDocuments(dateFilter);
        const locked = await documentsCollection.countDocuments({
            ...dateFilter,
            locked: true
        });
        const shared = await documentsCollection.countDocuments({
            ...dateFilter,
            sharedWith: { $exists: true, $ne: [] }
        });

        // Répartition par département
        const byDepartmentRaw = await documentsCollection.aggregate([
            { $match: dateFilter },
            { $group: {
                _id: "$idDepartement",
                count: { $sum: 1 }
            }},
            { $lookup: {
                from: "departements",
                localField: "_id",
                foreignField: "_id",
                as: "dept"
            }},
            { $unwind: { path: "$dept", preserveNullAndEmptyArrays: true } },
            { $project: {
                departement: { $ifNull: ["$dept.nom", "Sans département"] },
                count: 1
            }},
            { $sort: { count: -1 } }
        ]).toArray();

        // Formatter le résultat
        const byDepartment = byDepartmentRaw.map(item => ({
            departement: item.departement,
            count: item.count
        }));

        return {
            total,
            locked,
            shared,
            byDepartment
        };

    } catch (error) {
        console.error('❌ Erreur getDocumentsStats:', error);
        throw error;
    }
}

/**
 * B. Obtenir le top 10 des documents les plus partagés
 */
async function getMostSharedDocuments(filters = {}) {
    try {
        const { period, startDate, endDate } = filters;

        // Filtre de date pour shareHistory (utilise le champ 'sharedAt')
        const dateFilter = getPeriodFilter(period, startDate, endDate, 'sharedAt');

        const result = await shareHistoryCollection.aggregate([
            { $match: dateFilter },
            { $group: {
                _id: "$documentId",
                shareCount: { $sum: 1 },
                documentTitle: { $first: "$documentTitle" },
                documentIdDocument: { $first: "$documentIdDocument" },
                shares: { $push: {
                    sharedBy: "$sharedBy",
                    sharedByName: "$sharedByName",
                    sharedWith: "$sharedWith",
                    sharedWithName: "$sharedWithName",
                    sharedAt: "$sharedAt"
                }}
            }},
            { $sort: { shareCount: -1 } },
            { $limit: 10 },
            { $project: {
                documentId: "$_id",
                titre: "$documentTitle",
                idDocument: "$documentIdDocument",
                nombrePartages: "$shareCount",
                partages: "$shares"
            }}
        ]).toArray();

        return result;

    } catch (error) {
        console.error('❌ Erreur getMostSharedDocuments:', error);
        throw error;
    }
}

/**
 * C. Obtenir le top 10 des documents les plus téléchargés
 */
async function getMostDownloadedDocuments(filters = {}) {
    try {
        const { period, startDate, endDate } = filters;

        // Pour cette fonction, on ne filtre PAS les documents par date de création
        // On récupère tous les documents, puis on compte seulement les téléchargements dans la période
        const documents = await documentsCollection.find({}).toArray();

        // Extraire les dates de début et fin de la période
        let periodStart = new Date(0);
        let periodEnd = new Date();

        if (period !== 'all') {
            const now = new Date();
            switch (period) {
                case 'today':
                    periodStart = new Date(now.setHours(0, 0, 0, 0));
                    periodEnd = new Date();
                    break;
                case '7days':
                    periodStart = new Date();
                    periodStart.setDate(periodStart.getDate() - 7);
                    periodEnd = new Date();
                    break;
                case '30days':
                    periodStart = new Date();
                    periodStart.setDate(periodStart.getDate() - 30);
                    periodEnd = new Date();
                    break;
                case 'custom':
                    periodStart = startDate || new Date(0);
                    periodEnd = endDate || new Date();
                    break;
            }
        }

        // Calculer le nombre de téléchargements par document dans la période
        const withDownloadCount = documents.map(doc => {
            let downloadsList = [];

            if (doc.historiqueTelechargements && Array.isArray(doc.historiqueTelechargements)) {
                // Filtrer les téléchargements dans la période
                downloadsList = doc.historiqueTelechargements.filter(dl => {
                    const dlDate = new Date(dl.date);
                    return dlDate >= periodStart && dlDate <= periodEnd;
                }).map(dl => ({
                    utilisateur: dl.utilisateur,
                    nomComplet: dl.nomComplet || dl.utilisateur,
                    date: dl.date
                }));
            }

            return {
                documentId: doc._id,
                idDocument: doc.idDocument,
                titre: doc.titre,
                nombreTelechargements: downloadsList.length,
                telechargements: downloadsList  // Ajout de la liste complète
            };
        })
        .filter(doc => doc.nombreTelechargements > 0)
        .sort((a, b) => b.nombreTelechargements - a.nombreTelechargements)
        .slice(0, 10);

        return withDownloadCount;

    } catch (error) {
        console.error('❌ Erreur getMostDownloadedDocuments:', error);
        throw error;
    }
}

/**
 * D. Obtenir la liste des utilisateurs niveau 1 ayant supprimé des documents
 */
async function getLevel1Deletions(filters = {}) {
    try {
        const { period, startDate, endDate } = filters;

        // ✅ NOUVEAU: Lire depuis documents.deleted au lieu de auditLogs
        const periodFilter = getPeriodFilter(period, startDate, endDate, 'deletionInfo.deletedAt');
        const dateFilter = {
            deleted: true,
            'deletionInfo.deletedByLevel': 1,  // Seulement suppressions par niveau 1
            ...periodFilter
        };

        const deletions = await documentsCollection.aggregate([
            { $match: dateFilter },
            { $group: {
                _id: "$deletionInfo.deletedBy",
                count: { $sum: 1 },
                nom: { $first: "$deletionInfo.deletedByName" },
                email: { $first: "$deletionInfo.deletedByEmail" },
                deletedDocs: { $push: {
                    documentId: "$idDocument",
                    titre: "$titre",
                    timestamp: "$deletionInfo.deletedAt",
                    motif: "$deletionInfo.motif",
                    expiresAt: "$deletionInfo.expiresAt",
                    ip: "$deletionInfo.ip"
                }}
            }},
            { $project: {
                username: "$_id",
                nom: 1,
                email: 1,
                nombreSuppressions: "$count",
                documentsSupprimes: "$deletedDocs"
            }},
            { $sort: { nombreSuppressions: -1 } }
        ]).toArray();

        return deletions;

    } catch (error) {
        console.error('❌ Erreur getLevel1Deletions:', error);
        throw error;
    }
}

/**
 * E. Obtenir la liste des documents supprimés (paginée)
 */
async function getDeletedDocuments(filters = {}) {
    try {
        const { period, startDate, endDate, page = 1, limit = 20 } = filters;

        // ✅ NOUVEAU: Lire depuis documents.deleted au lieu de auditLogs
        const periodFilter = getPeriodFilter(period, startDate, endDate, 'deletionInfo.deletedAt');
        const dateFilter = {
            deleted: true,
            ...periodFilter
        };

        // Compter le total
        const total = await documentsCollection.countDocuments(dateFilter);

        // Récupérer les documents supprimés avec pagination
        const deletions = await documentsCollection.aggregate([
            { $match: dateFilter },
            { $sort: { "deletionInfo.deletedAt": -1 } },
            { $skip: (page - 1) * limit },
            { $limit: limit },
            { $project: {
                _id: 1,
                documentId: "$idDocument",
                titre: 1,
                supprimePar: "$deletionInfo.deletedBy",
                nomComplet: "$deletionInfo.deletedByName",
                email: "$deletionInfo.deletedByEmail",
                dateSuppression: "$deletionInfo.deletedAt",
                motif: "$deletionInfo.motif",
                departement: "$deletionInfo.departement",
                service: "$deletionInfo.service",
                categorie: "$deletionInfo.categorie",
                expiresAt: "$deletionInfo.expiresAt",
                ip: "$deletionInfo.ip",

                // ✅ NOUVEAU: Calculer si récupérable
                isRecoverable: {
                    $cond: {
                        if: { $gt: ["$deletionInfo.expiresAt", new Date()] },
                        then: true,
                        else: false
                    }
                },
                daysUntilExpiration: {
                    $divide: [
                        { $subtract: ["$deletionInfo.expiresAt", new Date()] },
                        86400000  // 1 jour en ms
                    ]
                }
            }}
        ]).toArray();

        return {
            deletions,
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit)
            }
        };

    } catch (error) {
        console.error('❌ Erreur getDeletedDocuments:', error);
        throw error;
    }
}

/**
 * F. Obtenir la liste des documents verrouillés (paginée)
 */
async function getLockedDocuments(filters = {}) {
    try {
        const { period, startDate, endDate, page = 1, limit = 20 } = filters;
        const dateFilter = getPeriodFilter(period, startDate, endDate);

        // Combiner avec le filtre locked
        const matchFilter = { locked: true, ...dateFilter };

        // Compter le total
        const total = await documentsCollection.countDocuments(matchFilter);

        // Récupérer les documents verrouillés avec pagination
        const lockedDocs = await documentsCollection.aggregate([
            { $match: matchFilter },
            { $sort: { "lockedBy.date": -1 } },
            { $skip: (page - 1) * limit },
            { $limit: limit },
            { $lookup: {
                from: "departements",
                localField: "idDepartement",
                foreignField: "_id",
                as: "dept"
            }},
            { $unwind: { path: "$dept", preserveNullAndEmptyArrays: true } },
            { $project: {
                idDocument: 1,
                titre: 1,
                categorie: 1,
                departement: "$dept.nom",
                verrouilléPar: "$lockedBy.utilisateur",
                verrouilleurNom: "$lockedBy.nomComplet",
                dateVerrouillage: "$lockedBy.date",
                createdAt: 1
            }}
        ]).toArray();

        return {
            locked: lockedDocs,
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit)
            }
        };

    } catch (error) {
        console.error('❌ Erreur getLockedDocuments:', error);
        throw error;
    }
}

/**
 * G. Obtenir l'activité globale sur les documents
 */
async function getDocumentsActivity(filters = {}) {
    try {
        const { period, startDate, endDate } = filters;

        // Filtre de date pour auditLogs (utilise le champ 'timestamp')
        const dateFilter = getPeriodFilter(period, startDate, endDate, 'timestamp');

        // Compter chaque type d'action
        const created = await auditLogsCollection.countDocuments({
            action: 'DOCUMENT_ARCHIVED',
            ...dateFilter
        });

        const deleted = await auditLogsCollection.countDocuments({
            action: 'DOCUMENT_DELETED',
            ...dateFilter
        });

        const downloaded = await auditLogsCollection.countDocuments({
            action: 'DOCUMENT_DOWNLOADED',
            ...dateFilter
        });

        const shared = await auditLogsCollection.countDocuments({
            action: 'DOCUMENT_SHARED',
            ...dateFilter
        });

        return {
            created,
            deleted,
            downloaded,
            shared
        };

    } catch (error) {
        console.error('❌ Erreur getDocumentsActivity:', error);
        throw error;
    }
}

/**
 * H. Obtenir la timeline des actions sur documents (pour graphiques)
 */
async function getDocumentTimeline(filters = {}) {
    try {
        const { period, startDate, endDate } = filters;

        // Filtre de date pour auditLogs (utilise le champ 'timestamp')
        const periodFilter = getPeriodFilter(period, startDate, endDate, 'timestamp');
        const dateFilter = {
            action: { $in: ['DOCUMENT_ARCHIVED', 'DOCUMENT_DELETED', 'DOCUMENT_DOWNLOADED', 'DOCUMENT_SHARED'] },
            ...periodFilter
        };

        const timeline = await auditLogsCollection.aggregate([
            { $match: dateFilter },
            { $project: {
                date: { $dateToString: { format: "%Y-%m-%d", date: "$timestamp" } },
                action: 1
            }},
            { $group: {
                _id: { date: "$date", action: "$action" },
                count: { $sum: 1 }
            }},
            { $project: {
                date: "$_id.date",
                action: "$_id.action",
                count: 1,
                _id: 0
            }},
            { $sort: { date: 1 } }
        ]).toArray();

        return timeline;

    } catch (error) {
        console.error('❌ Erreur getDocumentTimeline:', error);
        throw error;
    }
}

/**
 * I. Obtenir tous les documents avec pagination
 */
async function getAllDocuments(filters = {}) {
    try {
        const { period, startDate, endDate, page = 1, limit = 20, search = '' } = filters;
        const dateFilter = getPeriodFilter(period, startDate, endDate);

        // Ajouter recherche si présente
        const matchFilter = { ...dateFilter };
        if (search) {
            matchFilter.$or = [
                { titre: { $regex: search, $options: 'i' } },
                { idDocument: { $regex: search, $options: 'i' } },
                { categorie: { $regex: search, $options: 'i' } }
            ];
        }

        // Compter le total
        const total = await documentsCollection.countDocuments(matchFilter);

        // Récupérer les documents avec pagination
        const allDocs = await documentsCollection.aggregate([
            { $match: matchFilter },
            { $sort: { createdAt: -1 } },
            { $skip: (page - 1) * limit },
            { $limit: limit },
            { $lookup: {
                from: "departements",
                localField: "idDepartement",
                foreignField: "_id",
                as: "dept"
            }},
            { $unwind: { path: "$dept", preserveNullAndEmptyArrays: true } },
            { $lookup: {
                from: "users",
                localField: "createdBy",
                foreignField: "username",
                as: "creator"
            }},
            { $unwind: { path: "$creator", preserveNullAndEmptyArrays: true } },
            { $project: {
                idDocument: 1,
                titre: 1,
                categorie: 1,
                departement: "$dept.nom",
                departementCode: "$dept.code",
                createdBy: 1,
                creatorName: { $concat: ["$creator.nom", " ", "$creator.prenom"] },
                createdAt: 1,
                locked: 1,
                sharedWith: 1,
                downloadCount: { $size: { $ifNull: ["$downloads", []] } },
                shareCount: { $size: { $ifNull: ["$sharedWith", []] } }
            }}
        ]).toArray();

        return {
            documents: allDocs,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total,
                totalPages: Math.ceil(total / limit)
            }
        };

    } catch (error) {
        console.error('❌ Erreur getAllDocuments:', error);
        throw error;
    }
}

// ============================================
// EXPORTS
// ============================================

module.exports = {
    init,
    getDocumentsStats,
    getMostSharedDocuments,
    getMostDownloadedDocuments,
    getLevel1Deletions,
    getDeletedDocuments,
    getLockedDocuments,
    getDocumentsActivity,
    getDocumentTimeline,
    getAllDocuments
};
