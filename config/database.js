// ============================================
// CONFIGURATION BASE DE DONNÉES MONGODB
// ============================================

const { MongoClient } = require('mongodb');
const { SecurityLogger } = require('../security-logger');
const constants = require('../utils/constants');

let db;
let collections = {};
let securityLogger;

/**
 * Connexion à MongoDB et initialisation des collections
 */
async function connectDB(retryCount = 0) {
    const maxRetries = 2;
    const retryDelay = 3000;

    try {
        console.log('🔄 Connexion à MongoDB...');
        if (retryCount > 0) {
            console.log(`🔄 Tentative ${retryCount + 1}/${maxRetries + 1}`);
        }

        // Masquer le mot de passe dans les logs
        const safeUri = constants.MONGO_URI.replace(/\/\/([^:]+):([^@]+)@/, '//***:***@');
        console.log(`📍 URI: ${safeUri}`);

        // Options de connexion
        const connectionOptions = {
            serverSelectionTimeoutMS: 10000,
            connectTimeoutMS: 10000,
            socketTimeoutMS: 45000
        };

        // Connexion
        const client = await MongoClient.connect(constants.MONGO_URI, connectionOptions);
        db = client.db(constants.DB_NAME);

        // Initialiser toutes les collections
        collections.users = db.collection(constants.COLLECTIONS.USERS);
        collections.documents = db.collection(constants.COLLECTIONS.DOCUMENTS);
        collections.categories = db.collection(constants.COLLECTIONS.CATEGORIES);
        collections.roles = db.collection(constants.COLLECTIONS.ROLES);
        collections.departements = db.collection(constants.COLLECTIONS.DEPARTEMENTS);
        collections.services = db.collection(constants.COLLECTIONS.SERVICES);
        collections.messages = db.collection(constants.COLLECTIONS.MESSAGES);
        collections.messageDeletionRequests = db.collection(constants.COLLECTIONS.MESSAGE_DELETION_REQUESTS);
        collections.shareHistory = db.collection(constants.COLLECTIONS.SHARE_HISTORY);
        collections.auditLogs = db.collection(constants.COLLECTIONS.AUDIT_LOGS);
        collections.ipRules = db.collection(constants.COLLECTIONS.IP_RULES);
        collections.systemSettings = db.collection(constants.COLLECTIONS.SYSTEM_SETTINGS);

        // Initialiser le SecurityLogger
        securityLogger = new SecurityLogger(db);
        console.log('✅ SecurityLogger initialisé');

        // Créer les index
        await createIndexes();

        console.log('✅ Connexion à MongoDB réussie');
        console.log(`📊 Base de données: ${constants.DB_NAME}`);

        return { db, collections, securityLogger };

    } catch (error) {
        console.error('❌ Erreur connexion MongoDB:', error.message);

        if (retryCount < maxRetries) {
            console.log(`⏳ Nouvelle tentative dans ${retryDelay / 1000}s...`);
            await new Promise(resolve => setTimeout(resolve, retryDelay));
            return connectDB(retryCount + 1);
        } else {
            console.error('💀 Échec connexion MongoDB après plusieurs tentatives');
            process.exit(1);
        }
    }
}

/**
 * Créer les index sur les collections
 */
async function createIndexes() {
    try {
        // Index documents
        await collections.documents.createIndex({ idUtilisateur: 1, dateAjout: -1 });
        await collections.documents.createIndex({ idDepartement: 1 });

        // Index users
        await collections.users.createIndex({ username: 1 }, { unique: true });
        await collections.users.createIndex({ email: 1 }, { unique: true });

        // Index audit logs
        await collections.auditLogs.createIndex({ timestamp: -1 });
        await collections.auditLogs.createIndex({ user: 1 });
        await collections.auditLogs.createIndex({ action: 1 });

        console.log('✅ Index MongoDB créés');
    } catch (error) {
        console.error('⚠️ Erreur création index:', error.message);
    }
}

/**
 * Obtenir la base de données
 */
function getDB() {
    if (!db) {
        throw new Error('Base de données non initialisée. Appelez connectDB() d\'abord.');
    }
    return db;
}

/**
 * Obtenir toutes les collections
 */
function getCollections() {
    if (!collections.users) {
        throw new Error('Collections non initialisées. Appelez connectDB() d\'abord.');
    }
    return collections;
}

/**
 * Obtenir le SecurityLogger
 */
function getSecurityLogger() {
    if (!securityLogger) {
        throw new Error('SecurityLogger non initialisé. Appelez connectDB() d\'abord.');
    }
    return securityLogger;
}

module.exports = {
    connectDB,
    getDB,
    getCollections,
    getSecurityLogger
};
