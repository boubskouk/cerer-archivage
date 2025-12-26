// ============================================
// SERVEUR NODE.JS + MONGODB - ARCHIVAGE C.E.R.E.R
// Adapté au MCD avec ROLES et DEPARTEMENTS
// ============================================

// ✅ Charger les variables d'environnement depuis .env
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const { MongoClient, ObjectId } = require('mongodb');
const os = require('os');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcrypt'); // SÉCURITÉ: Hachage des mots de passe
const OfficeEditor = require('./office-editor'); // Module d'édition Office

// ✅ NOUVEAU: Modules de sécurité
const session = require('express-session');
const MongoStore = require('connect-mongo');
const { body, validationResult } = require('express-validator');
const security = require('./security-config');

// ✅ NOUVEAU: Validation domaines universitaires et envoi email
const { validateUniversityEmail } = require('./config/allowedDomains');
const { sendWelcomeEmail } = require('./services/emailService');

// ✅ NOUVEAU: Service de nettoyage automatique de la corbeille
const trashCleanup = require('./services/trashCleanup');

const app = express();

// ✅ CONFIGURATION: Trust proxy (nécessaire derrière reverse proxy comme Render, Heroku, etc.)
app.set('trust proxy', 1);

// Configuration
const PORT = process.env.PORT || 4000;

// ✅ MEILLEURE PRATIQUE: URI MongoDB depuis variable d'environnement avec fallback local
const MONGO_URI = process.env.MONGODB_URI ||
    "mongodb://localhost:27017/cerer_archivage?retryWrites=true&w=majority";

const DB_NAME = process.env.MONGODB_DB_NAME || 'cerer_archivage';

let db;
let usersCollection;
let documentsCollection;
let categoriesCollection;
let rolesCollection;
let departementsCollection;
let servicesCollection; // ✅ NOUVEAU: Collection services (créés par niveau 1)
let messagesCollection;
let messageDeletionRequestsCollection;
let shareHistoryCollection;
// ✅ NIVEAU 0: Collections Super Admin
let auditLogsCollection;
let ipRulesCollection;
let systemSettingsCollection;

// ============================================
// MIDDLEWARE
// ============================================

// ✅ SÉCURITÉ: Headers de sécurité avec Helmet
app.use(security.helmetConfig);

// ✅ SÉCURITÉ: Compression des réponses
app.use(security.compressionConfig);

// CORS et parsing - ✅ Activer credentials pour les cookies de session
app.use(cors({
    origin: function (origin, callback) {
        // Permettre localhost et les requêtes sans origin (Postman, etc.)
        const allowedOrigins = ['http://localhost:4000', 'http://127.0.0.1:4000'];
        if (!origin || allowedOrigins.includes(origin)) {
            callback(null, true);
        } else {
            callback(null, true); // En développement, on accepte tout
        }
    },
    credentials: true, // ✅ CRITIQUE: Permet l'envoi de cookies
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ limit: '100mb', extended: true }));

// ✅ SESSIONS: Configuration MongoStore (persistance MongoDB - AVANT les routes !)
app.use(session({
    secret: process.env.SESSION_SECRET || 'changez_ce_secret_en_production',
    resave: false,
    saveUninitialized: false,
    rolling: true,
    store: MongoStore.create({
        mongoUrl: MONGO_URI,
        dbName: DB_NAME,
        collectionName: 'sessions',
        touchAfter: 24 * 3600, // Limiter les mises à jour de session à 1x par 24h (optimisation)
        crypto: {
            secret: process.env.SESSION_CRYPTO_SECRET || 'changez_ce_secret_crypto_en_production'
        }
    }),
    cookie: {
        secure: process.env.NODE_ENV === 'production',
        httpOnly: true,
        maxAge: 24 * 60 * 60 * 1000
    },
    name: 'sessionId'
}));
console.log('✅ Sessions configurées (MongoStore - PRODUCTION)');

// ✅ MIDDLEWARE DE SÉCURITÉ: Vérifier isOnline et forcer la déconnexion si false
app.use(async (req, res, next) => {
    // Ignorer pour les routes publiques et la route de vérification de session
    if (req.path === '/api/login' ||
        req.path === '/api/logout' ||
        req.path === '/api/check-session-status' ||
        req.path.startsWith('/api/superadmin/login') ||
        !req.path.startsWith('/api/') ||
        !req.session.userId) {
        return next();
    }

    try {
        // Vérifier si l'utilisateur a isOnline=false
        const user = await usersCollection.findOne({
            username: req.session.userId
        });

        if (user && user.isOnline === false) {
            console.log(`⚠️ Utilisateur ${req.session.userId} déconnecté (isOnline=false) - destruction de la session`);

            // Détruire la session
            return req.session.destroy((err) => {
                if (err) {
                    console.error('❌ Erreur destruction session:', err);
                }
                res.status(401).json({
                    success: false,
                    message: 'Votre session a été fermée par un administrateur',
                    forceLogout: true
                });
            });
        }

        next();
    } catch (error) {
        console.error('❌ Erreur middleware isOnline:', error);
        next(); // Continuer même en cas d'erreur pour ne pas bloquer l'app
    }
});

// ✅ SÉCURITÉ: Protection contre les injections NoSQL
app.use(security.sanitizeConfig);

// ✅ SÉCURITÉ: Logger les requêtes HTTP
app.use(security.requestLogger);

// ✅ SÉCURITÉ: Rate limiting général (100 requêtes/15min)
app.use('/api/', security.generalLimiter);

// Fichiers statiques
app.use(express.static(path.join(__dirname, 'public')));

// ============================================
// GÉNÉRATEUR D'ID UNIQUE POUR LES DOCUMENTS
// ============================================

// ✅ NOUVEAU: Fonction pour générer un ID UNIQUE avec HMST (Heure-Minute-Seconde-Tierce)
// Format: DOC-YYYYMMDD-HHMMSSTTT-RRRR
// - YYYYMMDD: Date complète
// - HH: Heures (00-23)
// - MM: Minutes (00-59)
// - SS: Secondes (00-59)
// - TTT: Millisecondes (000-999) - "Tierce"
// - RRRR: Identifiant aléatoire sur 4 chiffres pour garantir l'unicité absolue
async function generateDocumentId() {
    let attempts = 0;
    const maxAttempts = 10;

    while (attempts < maxAttempts) {
        const now = new Date();

        // Date: YYYYMMDD
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        const datePrefix = `${year}${month}${day}`;

        // Heure: HHMMSSTTT (Heure-Minute-Seconde-Tierce/Millisecondes)
        const hours = String(now.getHours()).padStart(2, '0');
        const minutes = String(now.getMinutes()).padStart(2, '0');
        const seconds = String(now.getSeconds()).padStart(2, '0');
        const milliseconds = String(now.getMilliseconds()).padStart(3, '0');
        const hmst = `${hours}${minutes}${seconds}${milliseconds}`;

        // Identifiant aléatoire pour garantir l'unicité absolue
        const randomId = String(Math.floor(Math.random() * 10000)).padStart(4, '0');

        const documentId = `DOC-${datePrefix}-${hmst}-${randomId}`;

        // Vérifier que cet ID n'existe pas déjà dans la base
        const existingDoc = await documentsCollection.findOne({ idDocument: documentId });

        if (!existingDoc) {
            console.log(`✅ ID unique généré: ${documentId}`);
            return documentId;
        }

        console.warn(`⚠️ Collision détectée pour ${documentId}, nouvelle tentative...`);
        attempts++;

        // Attendre 1ms avant de réessayer
        await new Promise(resolve => setTimeout(resolve, 1));
    }

    // Si après 10 tentatives on n'a pas trouvé d'ID unique, utiliser un timestamp complet
    const timestamp = Date.now();
    const fallbackId = `DOC-${timestamp}-${String(Math.floor(Math.random() * 10000)).padStart(4, '0')}`;
    console.warn(`⚠️ Utilisation d'un ID de secours: ${fallbackId}`);
    return fallbackId;
}

// ============================================
// GESTION DES PERMISSIONS
// ============================================

// Vérifier si un utilisateur peut accéder à un document
// ✅ NOUVELLE LOGIQUE : Si le document est dans la liste accessible, l'utilisateur peut l'ouvrir
async function canAccessDocument(userId, documentId) {
    const user = await usersCollection.findOne({ username: userId });
    const document = await documentsCollection.findOne({
        _id: new ObjectId(documentId),
        deleted: { $ne: true }  // ✅ Exclure documents supprimés
    });

    if (!user || !document) return false;

    // Récupérer tous les documents accessibles pour cet utilisateur
    const accessibleDocs = await getAccessibleDocuments(userId);

    // Vérifier si le document demandé est dans la liste des documents accessibles
    const isAccessible = accessibleDocs.some(doc =>
        doc._id.toString() === documentId.toString()
    );

    if (isAccessible) {
        console.log(`✅ ${userId} peut accéder au document ${documentId} (présent dans sa liste accessible)`);
        return true;
    }

    console.log(`❌ ${userId} ne peut PAS accéder au document ${documentId} (absent de sa liste accessible)`);
    return false;
}

// Récupérer les documents accessibles pour un utilisateur
async function getAccessibleDocuments(userId) {
    const user = await usersCollection.findOne({ username: userId });
    if (!user) return [];

    const userRole = await rolesCollection.findOne({ _id: user.idRole });
    if (!userRole) return [];

    console.log(`📋 Récupération documents pour: ${userId} (niveau ${userRole.niveau}, dept: ${user.idDepartement})`);

    let accessibleDocs = [];

    // ✅ NIVEAU 0 : Super Admin - Voit TOUS les documents (lecture seule)
    if (userRole.niveau == 0) {
        const allDocs = await documentsCollection.find({
            deleted: { $ne: true }  // ✅ Exclure documents supprimés
        }).toArray();
        accessibleDocs = allDocs;
        console.log(`✅ NIVEAU 0 (Super Admin): Accès à TOUS les documents en LECTURE SEULE (${accessibleDocs.length})`);
        return accessibleDocs;
    }

    // ✅ NIVEAU 1 : Voit les documents de SON département ET des services de ce département
    if (userRole.niveau == 1) {
        // Vérifier que l'utilisateur a un département
        if (!user.idDepartement) {
            console.log(`⚠️ Utilisateur niveau 1 sans département: Aucun document accessible`);
            return [];
        }

        // ✅ NOUVEAU: Récupérer tous les services du département depuis la collection services
        const services = await servicesCollection.find({
            idDepartement: user.idDepartement
        }).toArray();

        const serviceIds = services.map(s => s._id);
        console.log(`📋 Services trouvés pour le département: ${services.map(s => s.nom).join(', ')} (${serviceIds.length})`);

        // Documents du département principal + documents de tous ses services
        const deptDocs = await documentsCollection.find({
            deleted: { $ne: true },  // ✅ Exclure documents supprimés
            $or: [
                { idDepartement: user.idDepartement }, // Documents du département principal
                { idService: { $in: serviceIds } }  // ✅ CORRIGÉ: Documents des services (utilise idService)
            ]
        }).toArray();

        accessibleDocs = deptDocs;
        console.log(`✅ NIVEAU 1: Accès aux documents du département + services (${accessibleDocs.length})`);
        return accessibleDocs;
    }

    // ✅ NIVEAU 2 : Voit TOUS les documents de son département
    if (userRole.niveau == 2) {
        // Vérifier que l'utilisateur a un département
        if (!user.idDepartement) {
            console.log(`⚠️ Utilisateur niveau 2 sans département: Aucun document accessible`);
            return [];
        }

        // Tous les documents du même département
        const deptDocs = await documentsCollection.find({
            idDepartement: user.idDepartement,
            deleted: { $ne: true }  // ✅ Exclure documents supprimés
        }).toArray();

        // + Documents partagés avec lui depuis d'autres départements
        const sharedDocs = await documentsCollection.find({
            sharedWith: userId,
            idDepartement: { $ne: user.idDepartement },
            deleted: { $ne: true }  // ✅ Exclure documents supprimés
        }).toArray();

        accessibleDocs = [...deptDocs, ...sharedDocs];
        console.log(`✅ NIVEAU 2: Accès à TOUS les documents du département (${deptDocs.length}) + partagés (${sharedDocs.length})`);
        return accessibleDocs;
    }

    // ✅ NIVEAU 3 : Voit uniquement ses documents + documents des autres niveau 3 du département + documents partagés
    if (userRole.niveau == 3) {
        // Vérifier que l'utilisateur a un département
        if (!user.idDepartement) {
            console.log(`⚠️ Utilisateur niveau 3 sans département: Aucun document accessible`);
            return [];
        }

        // Récupérer tous les utilisateurs niveau 3 du même département
        const niveau3Users = await usersCollection.find({
            idDepartement: user.idDepartement,
            idRole: userRole._id // Même rôle (niveau 3)
        }).toArray();

        const niveau3Usernames = niveau3Users.map(u => u.username);
        console.log(`📋 Utilisateurs niveau 3 du département: ${niveau3Usernames.join(', ')}`);

        // Documents des utilisateurs niveau 3 du département
        const niveau3Docs = await documentsCollection.find({
            idDepartement: user.idDepartement,
            idUtilisateur: { $in: niveau3Usernames },
            deleted: { $ne: true }  // ✅ Exclure documents supprimés
        }).toArray();

        // + Documents partagés avec lui (de n'importe quel département)
        const sharedDocs = await documentsCollection.find({
            sharedWith: userId,
            deleted: { $ne: true }  // ✅ Exclure documents supprimés
        }).toArray();

        accessibleDocs = [...niveau3Docs, ...sharedDocs];
        console.log(`✅ NIVEAU 3: Accès documents niveau 3 du département (${niveau3Docs.length}) + partagés (${sharedDocs.length})`);
        return accessibleDocs;
    }

    // Par défaut : aucun document
    console.log(`⚠️ Niveau inconnu (${userRole.niveau}): Aucun document accessible`);
    return [];
}

// ============================================
// CONNEXION À MONGODB
// ============================================
async function connectDB(retryCount = 0) {
    const maxRetries = 2;
    const retryDelay = 3000; // 3 secondes

    try {
        console.log('🔄 Connexion à MongoDB...');
        if (retryCount > 0) {
            console.log(`🔄 Tentative ${retryCount + 1}/${maxRetries + 1}`);
        }

        // Masquer le mot de passe dans les logs
        const safeUri = MONGO_URI.replace(/\/\/([^:]+):([^@]+)@/, '//***:***@');
        console.log(`📍 URI: ${safeUri}`);

        // Options compatibles avec MongoDB Driver v6.3.0
        const connectionOptions = {
            serverSelectionTimeoutMS: 10000,
            connectTimeoutMS: 10000,
            socketTimeoutMS: 45000
        };

        // Connexion simple et directe
        const client = await MongoClient.connect(MONGO_URI, connectionOptions);

        db = client.db(DB_NAME);
        usersCollection = db.collection('users');
        documentsCollection = db.collection('documents');
        categoriesCollection = db.collection('categories');
        rolesCollection = db.collection('roles');
        departementsCollection = db.collection('departements');
        servicesCollection = db.collection('services'); // ✅ NOUVEAU: Collection services
        messagesCollection = db.collection('messages');
        messageDeletionRequestsCollection = db.collection('messageDeletionRequests');
        shareHistoryCollection = db.collection('shareHistory');

        // ✅ NIVEAU 0: Collections Super Admin
        auditLogsCollection = db.collection('auditLogs');
        ipRulesCollection = db.collection('ipRules');
        systemSettingsCollection = db.collection('systemSettings');

        // Créer des index
        await documentsCollection.createIndex({ idUtilisateur: 1, dateAjout: -1 });
        await documentsCollection.createIndex({ idDepartement: 1 });
        await usersCollection.createIndex({ username: 1 }, { unique: true });
        await usersCollection.createIndex({ email: 1 }, { unique: true }); // ✅ Email unique

        // ✅ NIVEAU 0: Index pour collections Super Admin
        await auditLogsCollection.createIndex({ timestamp: -1 });
        await auditLogsCollection.createIndex({ user: 1 });
        await auditLogsCollection.createIndex({ action: 1 });

        console.log('✅ Connexion à MongoDB réussie');
        console.log(`📊 Base de données: ${DB_NAME}`);

        // ✅ NOUVEAU: Initialiser le service de nettoyage automatique de la corbeille
        trashCleanup.init({
            documents: documentsCollection,
            auditLogs: auditLogsCollection,
            db: db
        });

        // Démarrer le cron job UNIQUEMENT sur l'instance 0 (évite duplication en mode cluster)
        if (process.env.NODE_APP_INSTANCE === '0' || !process.env.NODE_APP_INSTANCE) {
            trashCleanup.startCronJob();
            console.log('✅ Cron job nettoyage corbeille actif (instance principale)');
        } else {
            console.log('⏭️  Cron job désactivé (instance secondaire)');
        }

        await initializeDefaultData();

        // ✅ Module Services (séparé de départements)
        const servicesModule = require('./modules/services');
        servicesModule.init(db);

        // ✅ NIVEAU 0: Initialiser les modules Super Admin
        const superAdminAuth = require('./middleware/superAdminAuth');
        const superAdminRoutes = require('./routes/superadmin');

        superAdminAuth.init({
            users: usersCollection,
            roles: rolesCollection,
            auditLogs: auditLogsCollection
        });

        superAdminRoutes.init(db, {
            users: usersCollection,
            documents: documentsCollection,
            categories: categoriesCollection, // ✅ Collection categories
            roles: rolesCollection,
            departements: departementsCollection,
            services: servicesCollection, // ✅ NOUVEAU: Collection services
            auditLogs: auditLogsCollection,
            systemSettings: systemSettingsCollection,
            shareHistory: shareHistoryCollection
        });

        // Charger les routes Super Admin
        app.use('/api/superadmin', superAdminRoutes.router);
        console.log('✅ Routes Super Admin (Niveau 0) chargées');

        // ============================================
        // ROUTES D'AUTHENTIFICATION (après le middleware de session)
        // ============================================

        // Route de login (REMPLACE l'ancienne route /api/login qui est en dehors de connectDB)
        app.post('/api/login', security.loginLimiter, async (req, res) => {
            try {
                const { username, password } = req.body;

                if (!username || !password) {
                    security.logLoginFailure(username || 'unknown', req.ip, req.headers['user-agent'], 'missing_credentials');
                    return res.status(400).json({
                        success: false,
                        message: 'Username et password requis'
                    });
                }

                // Chercher l'utilisateur
                const user = await usersCollection.findOne({ username });

                if (!user) {
                    security.logLoginFailure(username, req.ip, req.headers['user-agent'], 'user_not_found');
                    return res.status(401).json({
                        success: false,
                        message: 'Identifiants incorrects'
                    });
                }

                // 🛡️ VÉRIFIER SI C'EST UN COMPTE SUPER ADMIN (NIVEAU 0)
                const userRole = await rolesCollection.findOne({ _id: user.idRole });
                const isSuperAdminAttempt = userRole && userRole.niveau == 0;

                if (isSuperAdminAttempt) {
                    // Logger TOUTE tentative de connexion à un compte Super Admin
                    await auditLogsCollection.insertOne({
                        timestamp: new Date(),
                        user: username,
                        action: 'TENTATIVE_CONNEXION_SUPERADMIN',
                        details: {
                            ip: req.ip,
                            userAgent: req.headers['user-agent'],
                            statut: 'En tentative'
                        },
                        ip: req.ip,
                        userAgent: req.headers['user-agent']
                    });
                    console.log(`🛡️  TENTATIVE DE CONNEXION AU SUPER ADMIN: ${username} depuis ${req.ip}`);
                }

                // Vérifier le mot de passe
                let isValidPassword = false;
                const isBcryptHash = /^\$2[aby]\$/.test(user.password);

                if (isBcryptHash) {
                    isValidPassword = await bcrypt.compare(password, user.password);
                } else {
                    isValidPassword = (password === user.password);
                    if (isValidPassword) {
                        const hashedPassword = await bcrypt.hash(password, 10);
                        await usersCollection.updateOne(
                            { _id: user._id },
                            { $set: { password: hashedPassword } }
                        );
                    }
                }

                if (!isValidPassword) {
                    security.logLoginFailure(username, req.ip, req.headers['user-agent'], 'wrong_password');

                    // 🛡️ Logger échec Super Admin
                    if (isSuperAdminAttempt) {
                        await auditLogsCollection.insertOne({
                            timestamp: new Date(),
                            user: username,
                            action: 'ECHEC_CONNEXION_SUPERADMIN',
                            details: {
                                ip: req.ip,
                                userAgent: req.headers['user-agent'],
                                raison: 'Mot de passe incorrect'
                            },
                            ip: req.ip,
                            userAgent: req.headers['user-agent']
                        });
                        console.log(`🚫 ÉCHEC CONNEXION SUPER ADMIN: ${username} (mot de passe incorrect)`);
                    }

                    return res.status(401).json({
                        success: false,
                        message: 'Identifiants incorrects'
                    });
                }

                // VÉRIFIER SI L'UTILISATEUR EST BLOQUÉ
                if (user.blocked === true) {
                    security.logLoginFailure(username, req.ip, req.headers['user-agent'], 'user_blocked');

                    // 🛡️ Logger tentative sur compte Super Admin bloqué
                    if (isSuperAdminAttempt) {
                        await auditLogsCollection.insertOne({
                            timestamp: new Date(),
                            user: username,
                            action: 'CONNEXION_SUPERADMIN_BLOQUE',
                            details: {
                                ip: req.ip,
                                userAgent: req.headers['user-agent'],
                                raison: 'Compte bloqué',
                                raisonBlocage: user.blockedReason || 'Non spécifié'
                            },
                            ip: req.ip,
                            userAgent: req.headers['user-agent']
                        });
                        console.log(`🚫 TENTATIVE CONNEXION SUPER ADMIN BLOQUÉ: ${username}`);
                    }

                    return res.status(403).json({
                        success: false,
                        message: 'Votre compte a été bloqué. Contactez un administrateur.',
                        blocked: true,
                        blockedReason: user.blockedReason || 'Non spécifié'
                    });
                }

                // 🔧 VÉRIFIER LE MODE MAINTENANCE (sauf pour Super Admin)
                if (!isSuperAdminAttempt) {
                    const maintenanceSettings = await systemSettingsCollection.findOne({ _id: 'maintenance' });
                    if (maintenanceSettings && maintenanceSettings.enabled === true) {
                        // Vérifier si l'utilisateur est dans la whitelist de maintenance
                        const whitelist = maintenanceSettings.whitelist || [];
                        const isWhitelisted = whitelist.includes(username);

                        if (!isWhitelisted) {
                            // Bloquer tous les utilisateurs qui ne sont pas dans la whitelist
                            security.logLoginFailure(username, req.ip, req.headers['user-agent'], 'maintenance_mode');
                            return res.status(503).json({
                                success: false,
                                maintenance: true,
                                message: 'Logiciel d\'archivage en maintenance. Veuillez contacter le super admin pour plus de précision.'
                            });
                        }

                        // L'utilisateur est dans la whitelist, il peut se connecter
                        console.log(`✅ Mode maintenance actif mais utilisateur ${username} autorisé (dans la whitelist)`);
                    }
                }

                // Récupérer les infos complètes (role déjà récupéré plus haut)
                const role = userRole;
                const departement = user.idDepartement ? await departementsCollection.findOne({ _id: user.idDepartement }) : null;

                // Vérifier première connexion
                const isFirstLogin = user.firstLogin === true;
                const mustChangePassword = user.mustChangePassword === true || isFirstLogin;

                if (isFirstLogin && !user.datePremiereConnexion) {
                    await usersCollection.updateOne(
                        { _id: user._id },
                        { $set: { datePremiereConnexion: new Date() } }
                    );
                }

                // Logger la connexion réussie
                security.logLoginSuccess(username, req.ip, req.headers['user-agent']);

                // 📝 Logger TOUTES les connexions réussies dans auditLogs
                await auditLogsCollection.insertOne({
                    timestamp: new Date(),
                    user: username,
                    action: 'LOGIN_SUCCESS',
                    details: {
                        ip: req.ip,
                        userAgent: req.headers['user-agent'],
                        niveau: userRole ? userRole.niveau : null,
                        role: userRole ? userRole.nom : null
                    },
                    ip: req.ip,
                    userAgent: req.headers['user-agent']
                });

                // 🛡️ Logger succès connexion Super Admin (log supplémentaire)
                if (isSuperAdminAttempt) {
                    await auditLogsCollection.insertOne({
                        timestamp: new Date(),
                        user: username,
                        action: 'SUCCES_CONNEXION_SUPERADMIN',
                        details: {
                            ip: req.ip,
                            userAgent: req.headers['user-agent'],
                            statut: 'Connexion réussie'
                        },
                        ip: req.ip,
                        userAgent: req.headers['user-agent']
                    });
                    console.log(`✅ SUCCÈS CONNEXION SUPER ADMIN: ${username} depuis ${req.ip}`);
                }

                // DEBUG: Vérifier que req.session existe
                console.log('🔍 DEBUG: req.session =', req.session);
                console.log('🔍 DEBUG: typeof req.session =', typeof req.session);

                if (!req.session) {
                    console.error('❌ ERREUR CRITIQUE: req.session est undefined !');
                    return res.status(500).json({
                        success: false,
                        message: 'Erreur de configuration de session'
                    });
                }

                // CRÉER LA SESSION
                req.session.userId = username;
                req.session.userLevel = role ? role.niveau : 0;

                // Sauvegarder la session
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

                // ✅ Mettre à jour lastActivity pour le statut de connexion + stocker sessionID
                console.log(`🟢 Mise à jour isOnline=true pour: ${username}`);
                console.log(`🔑 Stockage sessionID: ${req.sessionID}`);
                const updateResult = await usersCollection.updateOne(
                    { username },
                    {
                        $set: {
                            lastActivity: new Date(),
                            isOnline: true,
                            sessionID: req.sessionID // ✅ Stocker l'ID de session
                        }
                    }
                );
                console.log(`✅ isOnline mis à jour: ${updateResult.modifiedCount} document(s) modifié(s)`);

                res.json({
                    success: true,
                    username,
                    mustChangePassword,
                    firstLogin: isFirstLogin,
                    user: {
                        username: user.username,
                        nom: user.nom,
                        email: user.email,
                        role: role ? role.libelle : 'Non défini',
                        niveau: role ? role.niveau : 0,
                        departement: departement ? departement.nom : 'Aucun (Admin Principal)',
                        idDepartement: user.idDepartement // ✅ AJOUTÉ: ID du département pour création de services
                    }
                });

            } catch (error) {
                console.error('❌ Erreur login:', error);
                res.status(500).json({ success: false, message: 'Erreur serveur' });
            }
        });

        // Route de logout (REMPLACE l'ancienne route /api/logout qui est en dehors de connectDB)
        app.post('/api/logout', async (req, res) => {
            const username = req.session.userId || 'unknown';

            // Logger la déconnexion dans auditLogs avec heure système
            if (username !== 'unknown') {
                try {
                    await auditLogsCollection.insertOne({
                        timestamp: new Date(), // Heure système
                        user: username,
                        action: 'LOGOUT',
                        details: {
                            ip: req.ip,
                            userAgent: req.headers['user-agent']
                        },
                        ip: req.ip,
                        userAgent: req.headers['user-agent']
                    });

                    // ✅ Mettre à jour le statut de connexion + supprimer sessionID
                    console.log(`🔴 Mise à jour isOnline=false pour: ${username}`);
                    const logoutUpdate = await usersCollection.updateOne(
                        { username },
                        {
                            $set: {
                                lastActivity: new Date(),
                                isOnline: false
                            },
                            $unset: {
                                sessionID: "" // ✅ Supprimer l'ID de session
                            }
                        }
                    );
                    console.log(`✅ isOnline=false mis à jour: ${logoutUpdate.modifiedCount} document(s) modifié(s)`);
                } catch (error) {
                    console.error('❌ Erreur lors du logging de la déconnexion:', error);
                }
            }

            req.session.destroy((err) => {
                if (err) {
                    console.error('❌ Erreur destruction session:', err);
                    return res.status(500).json({
                        success: false,
                        message: 'Erreur lors de la déconnexion'
                    });
                }

                console.log(`👋 Déconnexion de: ${username} à ${new Date().toLocaleString('fr-FR')}`);
                res.json({
                    success: true,
                    message: 'Déconnexion réussie'
                });
            });
        });

        console.log('✅ Routes d\'authentification avec session configurées');

        // ============================================
        // ROUTE CATCH-ALL (DOIT ÊTRE EN DERNIER)
        // ============================================
        // Route catch-all pour servir index.html (après toutes les autres routes)
        app.get('*', (req, res) => {
            res.sendFile(path.join(__dirname, 'public', 'index.html'));
        });
        console.log('✅ Route catch-all configurée');

    } catch (error) {
        console.error('❌ Erreur connexion MongoDB:', error.message);

        // Retry si on n'a pas atteint le max et que ce n'est pas une erreur DNS
        const isDnsError = error.message.includes('querySrv') || error.message.includes('ENOTFOUND');

        if (retryCount < maxRetries && !isDnsError) {
            console.log(`⏳ Nouvelle tentative dans ${retryDelay/1000}s...`);
            await new Promise(resolve => setTimeout(resolve, retryDelay));
            return connectDB(retryCount + 1);
        }

        if (!isDnsError) {
            console.error('\n' + '='.repeat(60));
            console.error('❌ IMPOSSIBLE DE SE CONNECTER À MONGODB');
            console.error('='.repeat(60));
            console.error('💡 Vérifications à faire:');
            console.error('   1. La variable MONGODB_URI est bien définie');
            console.error('   2. Les identifiants sont corrects');
            console.error('   3. L\'adresse IP du serveur est autorisée sur MongoDB Atlas');
            console.error('      → Network Access → Add IP Address → Allow from Anywhere');
            console.error('   4. Le réseau permet l\'accès à MongoDB (pas de firewall)');
            console.error('='.repeat(60) + '\n');
        }

        process.exit(1);
    }
}

// ============================================
// INITIALISATION DES DONNÉES PAR DÉFAUT
// ============================================
async function initializeDefaultData() {
    // 1. RÔLES
    const defaultRoles = [
        { libelle: 'primaire', niveau: 1, description: 'Accès complet à tous les départements' },
        { libelle: 'secondaire', niveau: 2, description: 'Accès à tous les documents de son département' },
        { libelle: 'tertiaire', niveau: 3, description: 'Accès à ses documents et ceux des autres niveau 3 du département' }
    ];
    
    for (const role of defaultRoles) {
        const exists = await rolesCollection.findOne({ libelle: role.libelle });
        if (!exists) {
            await rolesCollection.insertOne(role);
            console.log(`✅ Rôle créé: ${role.libelle}`);
        }
    }
    
    // 2. DÉPARTEMENTS - Désactivé (aucun département par défaut)
    // Les départements seront créés manuellement selon les besoins

    // 3. UTILISATEURS
    const primaryRole = await rolesCollection.findOne({ libelle: 'primaire' });
    const secondaryRole = await rolesCollection.findOne({ libelle: 'secondaire' });
    const tertiaryRole = await rolesCollection.findOne({ libelle: 'tertiaire' });

    // ✅ Utilisateur par défaut: JBK uniquement (sans département)
    const defaultUsers = [
        {
            username: 'jbk',
            password: await bcrypt.hash('0811', 10),
            nom: 'JBK',
            email: 'jbk@cerer.sn',
            idRole: primaryRole._id,
            idDepartement: null // Pas de département par défaut
        }
    ];
    
    for (const user of defaultUsers) {
        const exists = await usersCollection.findOne({ username: user.username });
        if (!exists) {
            await usersCollection.insertOne({
                ...user,
                dateCreation: new Date()
            });
            console.log(`✅ Utilisateur créé: ${user.username}`);
        }
    }

    // 4. CATÉGORIES pour chaque utilisateur - DÉSACTIVÉ
    // ✅ Les catégories ne sont PLUS créées automatiquement
    // Les catégories sont maintenant gérées manuellement par chaque utilisateur
    // et partagées au niveau du département

    /*
    const categories = [
        { id: 'factures', nom: 'Factures', couleur: 'bg-blue-100 text-blue-800', icon: '🧾' },
        { id: 'contrats', nom: 'Contrats', couleur: 'bg-purple-100 text-purple-800', icon: '📜' },
        { id: 'fiscalite', nom: 'Fiscalité', couleur: 'bg-green-100 text-green-800', icon: '💰' },
        { id: 'assurance', nom: 'Assurance', couleur: 'bg-orange-100 text-orange-800', icon: '🛡️' },
        { id: 'identite', nom: 'Identité', couleur: 'bg-red-100 text-red-800', icon: '🪪' },
        { id: 'medical', nom: 'Médical', couleur: 'bg-pink-100 text-pink-800', icon: '🏥' },
        { id: 'juridique', nom: 'Juridique', couleur: 'bg-indigo-100 text-indigo-800', icon: '⚖️' },
        { id: 'autre', nom: 'Autre', couleur: 'bg-gray-100 text-gray-800', icon: '📄' }
    ];

    for (const user of defaultUsers) {
        for (const cat of categories) {
            const exists = await categoriesCollection.findOne({
                idUtilisateur: user.username,
                id: cat.id
            });
            if (!exists) {
                await categoriesCollection.insertOne({
                    idUtilisateur: user.username,
                    ...cat
                });
            }
        }
    }
    */
}

// ============================================
// ROUTES API
// ============================================

// Health check
app.get('/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        timestamp: new Date(),
        database: db ? 'connected' : 'disconnected'
    });
});

// ============================================
// ANCIENNE ROUTE - DÉSACTIVÉE (remplacée par la route dans connectDB())
// ============================================
/*
// Login - ✅ SÉCURITÉ: Rate limiting strict (5 tentatives/15min)
app.post('/api/login', security.loginLimiter, async (req, res) => {
    try {
        const { username, password } = req.body;

        if (!username || !password) {
            security.logLoginFailure(username || 'unknown', req.ip, req.headers['user-agent'], 'missing_credentials');
            return res.status(400).json({
                success: false,
                message: 'Username et password requis'
            });
        }
        
        // SÉCURITÉ: Chercher l'utilisateur par username uniquement
        const user = await usersCollection.findOne({ username });

        if (!user) {
            security.logLoginFailure(username, req.ip, req.headers['user-agent'], 'user_not_found');
            return res.status(401).json({
                success: false,
                message: 'Identifiants incorrects'
            });
        }

        // SÉCURITÉ: Comparer le mot de passe avec bcrypt
        let isValidPassword = false;

        // Vérifier si c'est un hash bcrypt (commence par $2a$, $2b$, ou $2y$)
        const isBcryptHash = /^\$2[aby]\$/.test(user.password);

        if (isBcryptHash) {
            // Nouveau format : utiliser bcrypt
            isValidPassword = await bcrypt.compare(password, user.password);
        } else {
            // ⚠️ ANCIEN FORMAT : comparaison directe (TEMPORAIRE - À MIGRER)
            isValidPassword = (password === user.password);

            // Si connexion réussie, mettre à jour le mot de passe vers bcrypt
            if (isValidPassword) {
                console.log(`⚠️ Migration auto du mot de passe pour: ${username}`);
                const hashedPassword = await bcrypt.hash(password, 10);
                await usersCollection.updateOne(
                    { _id: user._id },
                    { $set: { password: hashedPassword } }
                );
            }
        }

        if (!isValidPassword) {
            security.logLoginFailure(username, req.ip, req.headers['user-agent'], 'wrong_password');
            return res.status(401).json({
                success: false,
                message: 'Identifiants incorrects'
            });
        }
        
        // Récupérer les infos complètes
        const role = await rolesCollection.findOne({ _id: user.idRole });
        const departement = user.idDepartement ? await departementsCollection.findOne({ _id: user.idDepartement }) : null;

        // ✅ NOUVEAU: Vérifier si c'est la première connexion
        const isFirstLogin = user.firstLogin === true;
        const mustChangePassword = user.mustChangePassword === true || isFirstLogin;

        // Logger si c'est la première connexion (mais ne pas marquer comme non-première encore)
        if (isFirstLogin && !user.datePremiereConnexion) {
            await usersCollection.updateOne(
                { _id: user._id },
                { $set: { datePremiereConnexion: new Date() } }
            );
            console.log(`🎉 Première connexion de ${username} - Changement de mot de passe requis`);
        }

        // ✅ SÉCURITÉ: Logger la connexion réussie
        security.logLoginSuccess(username, req.ip, req.headers['user-agent']);

        // ✅ CRÉER LA SESSION pour l'utilisateur connecté
        req.session.userId = username;
        req.session.userLevel = role ? role.niveau : 0;

        // Sauvegarder la session avant de répondre
        req.session.save((err) => {
            if (err) {
                console.error('❌ Erreur sauvegarde session:', err);
            } else {
                console.log(`✅ Session créée pour: ${username} (niveau ${req.session.userLevel})`);
            }
        });

        res.json({
            success: true,
            username,
            mustChangePassword, // ✅ Indiquer si l'utilisateur doit changer son mot de passe
            firstLogin: isFirstLogin, // ✅ NOUVEAU: Indiquer si c'est la première connexion
            user: {
                username: user.username,
                nom: user.nom,
                email: user.email,
                role: role ? role.libelle : 'Non défini',
                niveau: role ? role.niveau : 0,
                departement: departement ? departement.nom : 'Aucun (Admin Principal)',
                idDepartement: user.idDepartement // ✅ AJOUTÉ: ID du département pour création de services
            }
        });
        
    } catch (error) {
        console.error('Erreur login:', error);
        res.status(500).json({ success: false, message: 'Erreur serveur' });
    }
});
*/

// ============================================
// ANCIENNE ROUTE - DÉSACTIVÉE (remplacée par la route dans connectDB())
// ============================================
/*
// LOGOUT - Destruction de la session
// ============================================
app.post('/api/logout', (req, res) => {
    const username = req.session.userId || 'unknown';

    req.session.destroy((err) => {
        if (err) {
            console.error('❌ Erreur destruction session:', err);
            return res.status(500).json({
                success: false,
                message: 'Erreur lors de la déconnexion'
            });
        }

        console.log(`👋 Déconnexion de: ${username}`);
        res.json({
            success: true,
            message: 'Déconnexion réussie'
        });
    });
});
*/

// ============================================
// Changement de mot de passe (première connexion ou changement forcé)
// ============================================
app.post('/api/change-password', [
    body('username').trim().notEmpty().withMessage('Username requis'),
    body('oldPassword').notEmpty().withMessage('Ancien mot de passe requis'),
    body('newPassword')
        .notEmpty().withMessage('Nouveau mot de passe requis')
        .isLength({ min: 4 }).withMessage('Le nouveau mot de passe doit contenir au moins 4 caractères'),
    body('confirmPassword').notEmpty().withMessage('Confirmation requise')
        .custom((value, { req }) => {
            if (value !== req.body.newPassword) {
                throw new Error('Les mots de passe ne correspondent pas');
            }
            return true;
        })
], async (req, res) => {
    try {
        // Vérifier les erreurs de validation
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            const errorMessages = errors.array().map(err => err.msg).join(', ');
            return res.status(400).json({
                success: false,
                message: errorMessages
            });
        }

        const { username, oldPassword, newPassword } = req.body;

        // Trouver l'utilisateur
        const user = await usersCollection.findOne({ username });
        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'Utilisateur introuvable'
            });
        }

        // Vérifier l'ancien mot de passe
        let isValidOldPassword = false;
        const isBcryptHash = /^\$2[aby]\$/.test(user.password);

        if (isBcryptHash) {
            isValidOldPassword = await bcrypt.compare(oldPassword, user.password);
        } else {
            // Format ancien (comparaison directe)
            isValidOldPassword = (oldPassword === user.password);
        }

        if (!isValidOldPassword) {
            return res.status(401).json({
                success: false,
                message: 'Ancien mot de passe incorrect'
            });
        }

        // Vérifier que le nouveau mot de passe est différent de l'ancien
        if (oldPassword === newPassword) {
            return res.status(400).json({
                success: false,
                message: 'Le nouveau mot de passe doit être différent de l\'ancien'
            });
        }

        // Hacher le nouveau mot de passe
        const hashedPassword = await bcrypt.hash(newPassword, 10);

        // Mettre à jour le mot de passe et marquer firstLogin comme false
        await usersCollection.updateOne(
            { _id: user._id },
            {
                $set: {
                    password: hashedPassword,
                    firstLogin: false,
                    mustChangePassword: false,
                    dateChangementMotDePasse: new Date()
                }
            }
        );

        console.log(`✅ Mot de passe changé pour: ${username}`);

        res.json({
            success: true,
            message: 'Mot de passe modifié avec succès'
        });

    } catch (error) {
        console.error('Erreur changement mot de passe:', error);
        res.status(500).json({
            success: false,
            message: 'Erreur serveur lors du changement de mot de passe'
        });
    }
});

// Vérifier la session (pour restaurer la session après un refresh)
app.post('/api/verify-session', async (req, res) => {
    try {
        const { username } = req.body;

        if (!username) {
            return res.status(400).json({
                success: false,
                message: 'Username requis'
            });
        }

        // Vérifier que l'utilisateur existe toujours
        const user = await usersCollection.findOne({ username });

        if (!user) {
            return res.status(401).json({
                success: false,
                message: 'Session invalide'
            });
        }

        // Récupérer les infos complètes
        const role = await rolesCollection.findOne({ _id: user.idRole });
        const departement = user.idDepartement ? await departementsCollection.findOne({ _id: user.idDepartement }) : null;

        res.json({
            success: true,
            user: {
                username: user.username,
                nom: user.nom,
                email: user.email,
                role: role ? role.libelle : 'Non défini',
                niveau: role ? role.niveau : 0,
                departement: departement ? departement.nom : 'Aucun (Admin Principal)'
            }
        });

    } catch (error) {
        console.error('Erreur vérification session:', error);
        res.status(500).json({ success: false, message: 'Erreur serveur' });
    }
});

// ✅ NOUVEAU: Route dédiée pour vérifier si l'utilisateur est toujours connecté
// Utilisée par le polling côté client pour détecter la déconnexion forcée
app.get('/api/check-session-status', async (req, res) => {
    try {
        // Vérifier si l'utilisateur a une session active
        if (!req.session || !req.session.userId) {
            return res.status(401).json({
                success: false,
                message: 'Aucune session active',
                forceLogout: true
            });
        }

        // Vérifier si l'utilisateur existe et est toujours en ligne
        const user = await usersCollection.findOne({
            username: req.session.userId
        });

        if (!user) {
            console.log(`⚠️ Utilisateur ${req.session.userId} introuvable - session invalide`);
            return res.status(401).json({
                success: false,
                message: 'Utilisateur introuvable',
                forceLogout: true
            });
        }

        // Vérifier si l'utilisateur a été déconnecté de force
        if (user.isOnline === false) {
            console.log(`⚠️ Utilisateur ${req.session.userId} a isOnline=false - déconnexion forcée`);

            // Détruire la session
            req.session.destroy((err) => {
                if (err) {
                    console.error('❌ Erreur destruction session:', err);
                }
            });

            return res.status(401).json({
                success: false,
                message: 'Votre session a été fermée par un administrateur',
                forceLogout: true
            });
        }

        // Session valide
        res.json({
            success: true,
            isOnline: true
        });

    } catch (error) {
        console.error('❌ Erreur check-session-status:', error);
        res.status(500).json({
            success: false,
            message: 'Erreur serveur'
        });
    }
});

// Register - ✅ SÉCURITÉ: Validation stricte des entrées
app.post('/api/register', [
    // Validation username
    body('username')
        .trim()
        .notEmpty().withMessage('Username requis')
        .isLength({ min: 3, max: 50 }).withMessage('Username: 3-50 caractères')
        .matches(/^[a-zA-Z0-9_-]+$/).withMessage('Username: uniquement lettres, chiffres, _ et -'),

    // Validation password
    body('password')
        .notEmpty().withMessage('Mot de passe requis')
        .isLength({ min: 4 }).withMessage('Mot de passe: minimum 4 caractères'),

    // Validation nom
    body('nom')
        .trim()
        .notEmpty().withMessage('Nom requis')
        .isLength({ min: 2, max: 100 }).withMessage('Nom: 2-100 caractères')
        .escape(),

    // ✅ VALIDATION EMAIL STRICTE + DOMAINE UNIVERSITAIRE
    body('email')
        .trim()
        .notEmpty().withMessage('Email requis')
        .isEmail().withMessage('Email invalide (format attendu: exemple@domaine.com)')
        .normalizeEmail() // Normalise l'email (lowercase, supprime espaces)
        .isLength({ max: 255 }).withMessage('Email trop long (max 255 caractères)')
        .matches(/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/)
            .withMessage('Format email invalide')
        .custom(async (email) => {
            // ✅ NOUVEAU: Vérifier que le domaine est autorisé (universités sénégalaises)
            const domainValidation = validateUniversityEmail(email);
            if (!domainValidation.valid) {
                const errorMsg = domainValidation.suggestion
                    ? `${domainValidation.error}. Vouliez-vous dire: ${domainValidation.suggestion}?`
                    : domainValidation.error;
                throw new Error(errorMsg);
            }

            // Vérifier si l'email existe déjà
            const existingUser = await usersCollection.findOne({ email: email.toLowerCase() });
            if (existingUser) {
                throw new Error('Cet email est déjà utilisé');
            }
            return true;
        })
], async (req, res) => {
    try {
        // ✅ SÉCURITÉ: Vérifier les erreurs de validation
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            const errorMessages = errors.array().map(err => err.msg).join(', ');
            return res.status(400).json({
                success: false,
                message: errorMessages,
                errors: errors.array()
            });
        }

        const { username, password, nom, email, idRole, idDepartement } = req.body;

        // ✅ NOUVEAU: Sauvegarder le mot de passe en clair pour l'email (avant hachage)
        const plaintextPassword = password;

        // ✅ NOUVEAU: Récupérer le nom de l'université pour l'email
        const domainValidation = validateUniversityEmail(email);
        const universityName = domainValidation.valid ? domainValidation.university : null;

        const exists = await usersCollection.findOne({ username });
        if (exists) {
            return res.status(400).json({
                success: false,
                message: 'Utilisateur existe déjà'
            });
        }

        // Rôle et département par défaut si non spécifiés
        let roleId = idRole;
        let deptId = idDepartement;

        if (!roleId) {
            const defaultRole = await rolesCollection.findOne({ libelle: 'tertiaire' });
            if (!defaultRole) {
                return res.status(400).json({
                    success: false,
                    message: 'Rôle par défaut introuvable. Veuillez spécifier un rôle.'
                });
            }
            roleId = defaultRole._id;
        }

        // Vérifier le niveau du rôle pour déterminer si un département est nécessaire
        const selectedRole = await rolesCollection.findOne({ _id: new ObjectId(roleId) });
        if (!selectedRole) {
            return res.status(400).json({
                success: false,
                message: 'Rôle invalide'
            });
        }
        const isNiveau0 = selectedRole.niveau == 0;

        // 🛡️ SÉCURITÉ: INTERDIRE la création de niveau 0 via l'API
        // Les Super Admins (niveau 0) ne peuvent être créés QUE via un script dédié
        if (isNiveau0) {
            return res.status(403).json({
                success: false,
                message: '❌ ACCÈS REFUSÉ : Les Super Administrateurs (niveau 0) ne peuvent pas être créés via cette interface. Utilisez le script dédié : npm run create-superadmin'
            });
        }

        // ✅ NOUVEAU: Vérifier si un utilisateur est connecté et appliquer les restrictions
        if (req.session && req.session.userId) {
            const creator = await usersCollection.findOne({ username: req.session.userId });
            if (creator) {
                const creatorRole = await rolesCollection.findOne({ _id: creator.idRole });
                if (creatorRole && creatorRole.niveau == 1) {
                    // Un niveau 1 ne peut créer QUE des utilisateurs niveau 2 ou 3
                    if (selectedRole.niveau !== 2 && selectedRole.niveau !== 3) {
                        return res.status(403).json({
                            success: false,
                            message: 'En tant qu\'administrateur départemental (niveau 1), vous ne pouvez créer que des utilisateurs de niveau 2 ou 3.'
                        });
                    }
                    // Forcer le département à celui du créateur (niveau 1)
                    deptId = creator.idDepartement;
                }
                // Si c'est un niveau 0 qui crée un utilisateur, vérifier qu'il ne crée pas un niveau 0
                else if (creatorRole && creatorRole.niveau == 0) {
                    if (selectedRole.niveau == 0) {
                        return res.status(403).json({
                            success: false,
                            message: '❌ ACCÈS REFUSÉ : Même les Super Administrateurs ne peuvent pas créer d\'autres Super Administrateurs via l\'interface. Utilisez le script dédié : npm run create-superadmin'
                        });
                    }
                }
            }
        }

        // Seul le niveau 0 (Super Admin) n'a pas besoin de département
        // Niveaux 1, 2, 3 DOIVENT avoir un département
        if (!isNiveau0 && !deptId) {
            const defaultDept = await departementsCollection.findOne({ nom: 'Direction' });
            if (!defaultDept) {
                return res.status(400).json({
                    success: false,
                    message: 'Département par défaut introuvable. Veuillez spécifier un département.'
                });
            }
            deptId = defaultDept._id;
        }

        // SÉCURITÉ: Hacher le mot de passe avec bcrypt (10 rounds)
        const hashedPassword = await bcrypt.hash(password, 10);

        // Construire l'objet utilisateur selon le niveau
        const newUser = {
            username,
            password: hashedPassword, // ✅ Mot de passe sécurisé
            nom,
            email: email.toLowerCase().trim(), // ✅ Email normalisé (lowercase)
            idRole: new ObjectId(roleId),
            dateCreation: new Date(),
            firstLogin: true // ✅ NOUVEAU: Marquer comme première connexion
        };

        // Ajouter le département seulement si ce n'est pas un niveau 0 (Super Admin)
        if (!isNiveau0 && deptId) {
            newUser.idDepartement = new ObjectId(deptId);
        } else if (isNiveau0) {
            newUser.idDepartement = null; // Niveau 0 (Super Admin) : pas de département
        }

        // ✅ NOUVEAU: Ajouter le créateur de l'utilisateur (pour filtrage Niveau 1)
        if (req.session && req.session.userId) {
            newUser.createdBy = req.session.userId;
        } else {
            newUser.createdBy = null; // Pas de créateur (création initiale ou import)
        }

        await usersCollection.insertOne(newUser);

        // ✅ Les catégories ne sont PLUS créées automatiquement
        // Les catégories sont maintenant gérées au niveau du département
        // par les utilisateurs niveau 1

        // ✅ NOUVEAU: Envoyer l'email de bienvenue avec les identifiants
        try {
            const emailResult = await sendWelcomeEmail({
                nom,
                username,
                password: plaintextPassword, // Mot de passe en clair (avant hachage)
                email: email.toLowerCase().trim(),
                university: universityName
            });

            if (emailResult.success) {
                console.log(`✅ Email de bienvenue envoyé à ${email}`);
            } else {
                // L'email n'a pas pu être envoyé, mais on ne bloque pas la création
                console.warn(`⚠️  Email non envoyé à ${email}: ${emailResult.error}`);
                console.warn('   L\'utilisateur a été créé, mais sans notification par email');
            }
        } catch (emailError) {
            // Erreur lors de l'envoi, mais on continue
            console.error(`❌ Erreur envoi email pour ${email}:`, emailError.message);
            console.warn('   L\'utilisateur a été créé malgré l\'échec de l\'email');
        }

        res.json({ success: true });
        
    } catch (error) {
        console.error('Erreur register:', error);
        res.status(500).json({ success: false, message: 'Erreur serveur' });
    }
});

// Récupérer les informations d'un utilisateur
app.get('/api/users/:username', async (req, res) => {
    try {
        const { username } = req.params;
        const { ObjectId } = require('mongodb');

        const user = await usersCollection.findOne({ username });
        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'Utilisateur non trouvé'
            });
        }

        // Verifier que l'utilisateur connecte a le droit de voir cet utilisateur
        if (req.session && req.session.userId) {
            const currentUser = await usersCollection.findOne({ username: req.session.userId });
            if (currentUser) {
                const roleId = typeof currentUser.idRole === 'string'
                    ? new ObjectId(currentUser.idRole)
                    : currentUser.idRole;
                const currentUserRole = await rolesCollection.findOne({ _id: roleId });

                // Si niveau 1, verifier que l'utilisateur cible est dans son departement ou services
                if (currentUserRole && currentUserRole.niveau == 1) {
                    if (currentUser.idDepartement) {
                        const deptId = typeof currentUser.idDepartement === 'string'
                            ? new ObjectId(currentUser.idDepartement)
                            : currentUser.idDepartement;

                        // Recuperer les services du departement
                        const services = await servicesCollection.find({
                            idDepartement: deptId
                        }).toArray();
                        const serviceIds = services.map(s => s._id.toString());

                        // Verifier si l'utilisateur cible est autorise
                        const userDeptId = user.idDepartement ? user.idDepartement.toString() : null;
                        const userServiceId = user.idService ? user.idService.toString() : null;

                        const isInDepartment = userDeptId === deptId.toString();
                        const isInService = userServiceId && serviceIds.includes(userServiceId);

                        if (!isInDepartment && !isInService) {
                            return res.status(403).json({
                                success: false,
                                message: 'Acces non autorise a cet utilisateur'
                            });
                        }
                    } else {
                        return res.status(403).json({
                            success: false,
                            message: 'Niveau 1 sans departement ne peut acceder aux utilisateurs'
                        });
                    }
                }
            }
        }

        const role = await rolesCollection.findOne({ _id: user.idRole });
        const departement = user.idDepartement ? await departementsCollection.findOne({ _id: user.idDepartement }) : null;
        const service = user.idService ? await servicesCollection.findOne({ _id: user.idService }) : null;

        res.json({
            success: true,
            user: {
                username: user.username,
                nom: user.nom,
                email: user.email,
                role: role ? role.libelle : 'Non defini',
                roleNiveau: role ? role.niveau : null,
                departement: departement ? departement.nom : (service ? 'Via service' : 'Aucun (Admin Principal)'),
                service: service ? service.nom : null,
                idRole: user.idRole,
                idDepartement: user.idDepartement,
                idService: user.idService
            }
        });

    } catch (error) {
        console.error('Erreur récupération utilisateur:', error);
        res.status(500).json({ success: false, message: 'Erreur serveur' });
    }
});

// Modifier un utilisateur
app.put('/api/users/:username', async (req, res) => {
    try {
        const { username } = req.params;
        const { nom, email, idRole, idDepartement } = req.body;

        if (!nom || !email || !idRole) {
            return res.status(400).json({ success: false, message: 'Nom, email et rôle sont requis' });
        }

        // Recuperer l'utilisateur cible
        const targetUser = await usersCollection.findOne({ username });
        if (!targetUser) {
            return res.status(404).json({ success: false, message: 'Utilisateur non trouve' });
        }

        // Verifier les droits du niveau 1
        if (req.session && req.session.userId) {
            const currentUser = await usersCollection.findOne({ username: req.session.userId });
            if (currentUser) {
                const roleId = typeof currentUser.idRole === 'string'
                    ? new ObjectId(currentUser.idRole)
                    : currentUser.idRole;
                const currentUserRole = await rolesCollection.findOne({ _id: roleId });

                // Si niveau 1, verifier que l'utilisateur cible est dans son departement ou services
                if (currentUserRole && currentUserRole.niveau == 1) {
                    if (currentUser.idDepartement) {
                        const deptId = typeof currentUser.idDepartement === 'string'
                            ? new ObjectId(currentUser.idDepartement)
                            : currentUser.idDepartement;

                        // Recuperer les services du departement
                        const services = await servicesCollection.find({
                            idDepartement: deptId
                        }).toArray();
                        const serviceIds = services.map(s => s._id.toString());

                        // Verifier si l'utilisateur cible est autorise
                        const userDeptId = targetUser.idDepartement ? targetUser.idDepartement.toString() : null;
                        const userServiceId = targetUser.idService ? targetUser.idService.toString() : null;

                        const isInDepartment = userDeptId === deptId.toString();
                        const isInService = userServiceId && serviceIds.includes(userServiceId);

                        if (!isInDepartment && !isInService) {
                            return res.status(403).json({
                                success: false,
                                message: 'Vous ne pouvez modifier que les utilisateurs de votre departement'
                            });
                        }

                        // Le niveau 1 ne peut pas modifier vers un autre departement que le sien
                        if (idDepartement && idDepartement !== deptId.toString()) {
                            return res.status(403).json({
                                success: false,
                                message: 'Vous ne pouvez affecter un utilisateur qu\'a votre departement'
                            });
                        }
                    } else {
                        return res.status(403).json({
                            success: false,
                            message: 'Niveau 1 sans departement ne peut modifier les utilisateurs'
                        });
                    }
                }
            }
        }

        // Vérifier que le rôle existe
        const role = await rolesCollection.findOne({ _id: new ObjectId(idRole) });
        if (!role) {
            return res.status(404).json({ success: false, message: 'Rôle non trouvé' });
        }

        // Vérifier que le département existe si fourni
        let departementId = null;
        if (idDepartement) {
            const departement = await departementsCollection.findOne({ _id: new ObjectId(idDepartement) });
            if (!departement) {
                return res.status(404).json({ success: false, message: 'Département non trouvé' });
            }
            departementId = new ObjectId(idDepartement);
        }

        await usersCollection.updateOne(
            { username },
            {
                $set: {
                    nom,
                    email,
                    idRole: new ObjectId(idRole),
                    idDepartement: departementId,
                    roleNiveau: role.niveau,
                    updatedAt: new Date()
                }
            }
        );

        res.json({ success: true });
    } catch (error) {
        console.error('Erreur modification utilisateur:', error);
        res.status(500).json({ success: false, message: 'Erreur serveur' });
    }
});

// Supprimer un utilisateur
app.delete('/api/users/:username', async (req, res) => {
    try {
        const { username } = req.params;

        // Ne pas permettre la suppression de l'utilisateur jbk
        if (username === 'jbk') {
            return res.status(403).json({ success: false, message: 'Impossible de supprimer l\'utilisateur jbk' });
        }

        // Recuperer l'utilisateur cible
        const targetUser = await usersCollection.findOne({ username });
        if (!targetUser) {
            return res.status(404).json({ success: false, message: 'Utilisateur non trouve' });
        }

        // Verifier les droits du niveau 1
        if (req.session && req.session.userId) {
            const currentUser = await usersCollection.findOne({ username: req.session.userId });
            if (currentUser) {
                const roleId = typeof currentUser.idRole === 'string'
                    ? new ObjectId(currentUser.idRole)
                    : currentUser.idRole;
                const currentUserRole = await rolesCollection.findOne({ _id: roleId });

                // Recuperer le role de l'utilisateur cible pour verifier son niveau
                const targetRoleId = typeof targetUser.idRole === 'string'
                    ? new ObjectId(targetUser.idRole)
                    : targetUser.idRole;
                const targetUserRole = await rolesCollection.findOne({ _id: targetRoleId });

                // Si niveau 1, verifier que l'utilisateur cible est dans son departement ou services
                if (currentUserRole && currentUserRole.niveau == 1) {
                    // Le niveau 1 ne peut pas supprimer un autre niveau 1 ou un niveau 0
                    if (targetUserRole && (targetUserRole.niveau == 0 || targetUserRole.niveau == 1)) {
                        return res.status(403).json({
                            success: false,
                            message: 'Vous ne pouvez pas supprimer un administrateur de niveau superieur ou egal'
                        });
                    }

                    if (currentUser.idDepartement) {
                        const deptId = typeof currentUser.idDepartement === 'string'
                            ? new ObjectId(currentUser.idDepartement)
                            : currentUser.idDepartement;

                        // Recuperer les services du departement
                        const services = await servicesCollection.find({
                            idDepartement: deptId
                        }).toArray();
                        const serviceIds = services.map(s => s._id.toString());

                        // Verifier si l'utilisateur cible est autorise
                        const userDeptId = targetUser.idDepartement ? targetUser.idDepartement.toString() : null;
                        const userServiceId = targetUser.idService ? targetUser.idService.toString() : null;

                        const isInDepartment = userDeptId === deptId.toString();
                        const isInService = userServiceId && serviceIds.includes(userServiceId);

                        if (!isInDepartment && !isInService) {
                            return res.status(403).json({
                                success: false,
                                message: 'Vous ne pouvez supprimer que les utilisateurs de votre departement'
                            });
                        }
                    } else {
                        return res.status(403).json({
                            success: false,
                            message: 'Niveau 1 sans departement ne peut supprimer les utilisateurs'
                        });
                    }
                }
            }
        }

        // Supprimer tous les documents de l'utilisateur
        await documentsCollection.deleteMany({ idUtilisateur: username });

        // ✅ NE SUPPRIMER QUE LES CATÉGORIES PERSONNELLES (sans département)
        // Les catégories du département doivent persister même après suppression de l'utilisateur
        await categoriesCollection.deleteMany({
            idUtilisateur: username,
            idDepartement: { $exists: false } // Seulement les catégories sans département
        });

        // Supprimer l'utilisateur
        await usersCollection.deleteOne({ username });

        res.json({ success: true });
    } catch (error) {
        console.error('Erreur suppression utilisateur:', error);
        res.status(500).json({ success: false, message: 'Erreur serveur' });
    }
});

// Réinitialiser le mot de passe d'un utilisateur
app.post('/api/users/:username/reset-password', async (req, res) => {
    try {
        const { username } = req.params;
        const { newPassword } = req.body;

        if (!newPassword || newPassword.length < 4) {
            return res.status(400).json({ success: false, message: 'Le mot de passe doit contenir au moins 4 caractères' });
        }

        // Recuperer l'utilisateur cible
        const targetUser = await usersCollection.findOne({ username });
        if (!targetUser) {
            return res.status(404).json({ success: false, message: 'Utilisateur non trouve' });
        }

        // Verifier les droits du niveau 1
        if (req.session && req.session.userId) {
            const currentUser = await usersCollection.findOne({ username: req.session.userId });
            if (currentUser) {
                const roleId = typeof currentUser.idRole === 'string'
                    ? new ObjectId(currentUser.idRole)
                    : currentUser.idRole;
                const currentUserRole = await rolesCollection.findOne({ _id: roleId });

                // Si niveau 1, verifier que l'utilisateur cible est dans son departement ou services
                if (currentUserRole && currentUserRole.niveau == 1) {
                    if (currentUser.idDepartement) {
                        const deptId = typeof currentUser.idDepartement === 'string'
                            ? new ObjectId(currentUser.idDepartement)
                            : currentUser.idDepartement;

                        // Recuperer les services du departement
                        const services = await servicesCollection.find({
                            idDepartement: deptId
                        }).toArray();
                        const serviceIds = services.map(s => s._id.toString());

                        // Verifier si l'utilisateur cible est autorise
                        const userDeptId = targetUser.idDepartement ? targetUser.idDepartement.toString() : null;
                        const userServiceId = targetUser.idService ? targetUser.idService.toString() : null;

                        const isInDepartment = userDeptId === deptId.toString();
                        const isInService = userServiceId && serviceIds.includes(userServiceId);

                        if (!isInDepartment && !isInService) {
                            return res.status(403).json({
                                success: false,
                                message: 'Vous ne pouvez reinitialiser que le mot de passe des utilisateurs de votre departement'
                            });
                        }
                    } else {
                        return res.status(403).json({
                            success: false,
                            message: 'Niveau 1 sans departement ne peut reinitialiser les mots de passe'
                        });
                    }
                }
            }
        }

        const hashedPassword = await bcrypt.hash(newPassword, 10);

        await usersCollection.updateOne(
            { username },
            { $set: { password: hashedPassword, updatedAt: new Date() } }
        );

        res.json({ success: true, message: 'Mot de passe réinitialisé avec succès' });
    } catch (error) {
        console.error('Erreur réinitialisation mot de passe:', error);
        res.status(500).json({ success: false, message: 'Erreur serveur' });
    }
});

// ✅ NOUVEAU: Changement de mot de passe par l'utilisateur (avec vérification ancien mot de passe)
app.post('/api/users/:username/change-password', [
    body('currentPassword').notEmpty().withMessage('Mot de passe actuel requis'),
    body('newPassword').isLength({ min: 4 }).withMessage('Le nouveau mot de passe doit contenir au moins 4 caractères')
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                success: false,
                message: errors.array().map(err => err.msg).join(', ')
            });
        }

        const { username } = req.params;
        const { currentPassword, newPassword } = req.body;

        // Récupérer l'utilisateur
        const user = await usersCollection.findOne({ username });
        if (!user) {
            return res.status(404).json({ success: false, message: 'Utilisateur non trouvé' });
        }

        // Vérifier l'ancien mot de passe
        const isBcryptHash = /^\$2[aby]\$/.test(user.password);
        let isValidPassword = false;

        if (isBcryptHash) {
            isValidPassword = await bcrypt.compare(currentPassword, user.password);
        } else {
            isValidPassword = (currentPassword === user.password);
        }

        if (!isValidPassword) {
            return res.status(401).json({
                success: false,
                message: 'Mot de passe actuel incorrect'
            });
        }

        // Hasher le nouveau mot de passe
        const hashedPassword = await bcrypt.hash(newPassword, 10);

        // Mettre à jour le mot de passe
        await usersCollection.updateOne(
            { username },
            { $set: {
                password: hashedPassword,
                updatedAt: new Date(),
                passwordChangedAt: new Date()
            }}
        );

        console.log(`🔑 Mot de passe changé pour: ${username}`);

        res.json({
            success: true,
            message: 'Mot de passe changé avec succès'
        });

    } catch (error) {
        console.error('Erreur changement mot de passe:', error);
        res.status(500).json({ success: false, message: 'Erreur serveur' });
    }
});

// ============================================
// ROUTES DOCUMENTS (avec permissions)
// ============================================

// Ajouter un document - ✅ SÉCURITÉ: Rate limiting (10 uploads/heure)
app.post('/api/documents', security.uploadLimiter, [
    body('userId').trim().notEmpty().isLength({ min: 3, max: 50 }),
    body('titre').trim().notEmpty().isLength({ min: 3, max: 200 }).escape(),
    body('nomFichier').trim().notEmpty().isLength({ max: 255 }),
    body('description').optional().trim().isLength({ max: 2000 }).escape(),
    body('tags').optional().trim().isLength({ max: 500 })
], async (req, res) => {
    try {
        // ✅ SÉCURITÉ: Vérifier les erreurs de validation
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                success: false,
                message: 'Données invalides',
                errors: errors.array()
            });
        }

        const { userId, titre, categorie, date, description, tags, nomFichier, taille, type, contenu, departementArchivage, locked } = req.body;
        
        if (!userId || !titre || !nomFichier) {
            return res.status(400).json({
                success: false,
                message: 'Données manquantes'
            });
        }

        // Validation des extensions autorisées (sécurité côté serveur)
        const allowedExtensions = [
            '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.txt',
            '.odt', '.ods', '.odp', '.rtf', '.csv',
            '.jpg', '.jpeg', '.png', '.gif', '.bmp', '.svg', '.webp',
            '.zip', '.rar'
        ];

        const fileName = nomFichier.toLowerCase();
        const isAllowed = allowedExtensions.some(ext => fileName.endsWith(ext));

        if (!isAllowed) {
            const ext = fileName.substring(fileName.lastIndexOf('.'));
            return res.status(400).json({
                success: false,
                message: `Extension "${ext}" non autorisée. Seuls les documents, images et archives sont acceptés.`
            });
        }

        // Bloquer explicitement les fichiers dangereux
        const blockedExtensions = [
            '.mp4', '.avi', '.mov', '.mkv', '.flv', '.wmv', '.webm',
            '.mp3', '.wav', '.ogg', '.m4a',
            '.exe', '.bat', '.sh', '.msi', '.cmd', '.vbs', '.ps1'
        ];
        const isBlocked = blockedExtensions.some(ext => fileName.endsWith(ext));

        if (isBlocked) {
            const ext = fileName.substring(fileName.lastIndexOf('.'));
            return res.status(403).json({
                success: false,
                message: `Les fichiers ${ext} (vidéos, audio, exécutables) ne sont pas autorisés pour des raisons de sécurité`
            });
        }

        const user = await usersCollection.findOne({ username: userId });
        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'Utilisateur non trouvé'
            });
        }

        // Récupérer le rôle et le département de l'utilisateur
        const role = await rolesCollection.findOne({ _id: new ObjectId(user.idRole) });
        const departement = user.idDepartement ? await departementsCollection.findOne({ _id: new ObjectId(user.idDepartement) }) : null;

        // ✅ NOUVEAU: Déterminer si c'est un service ou un département
        const isNiveau123 = role && (role.niveau == 1 || role.niveau == 2 || role.niveau == 3);
        const idArchivage = departementArchivage || user.idDepartement;

        let serviceArchivage = null;
        let idServiceArchivage = null;
        let deptArchivage = null;
        let idDeptArchivage = null;

        if (isNiveau123 && idArchivage) {
            // Niveaux 1/2/3 : chercher dans les services
            const service = await servicesCollection.findOne({ _id: new ObjectId(idArchivage) });
            if (service) {
                serviceArchivage = service.nom;
                idServiceArchivage = idArchivage;
            }
        } else if (idArchivage) {
            // Niveau 0 : chercher dans les départements
            const dept = await departementsCollection.findOne({ _id: new ObjectId(idArchivage) });
            if (dept) {
                deptArchivage = dept.nom;
                idDeptArchivage = idArchivage;
            }
        }

        // Générer l'ID unique du document
        const idDocument = await generateDocumentId();

        const document = {
            idDocument,  // ID unique généré par le serveur
            idUtilisateur: userId,
            titre,
            categorie: categorie,  // ✅ CORRECTION: categorie au lieu de idCategorie
            date: date || new Date(),
            description,
            tags,
            nomFichier,
            taille,
            type,
            contenu,
            idDepartement: user.idDepartement,
            createdAt: new Date(),
            // ✅ Département d'archivage (niveau 0)
            departementArchivage: deptArchivage,
            idDepartementArchivage: idDeptArchivage,
            // ✅ Service d'archivage (niveaux 1/2/3)
            serviceArchivage: serviceArchivage,
            idService: idServiceArchivage ? new ObjectId(idServiceArchivage) : null,
            // ✅ Informations de l'archiveur
            archivePar: {
                utilisateur: userId,
                nomComplet: user.nom,
                email: user.email,
                niveau: role ? role.niveau : null,
                role: role ? role.libelle : null,
                departement: departement ? departement.nom : null,
                date: new Date()
            },
            // ✅ Initialiser les champs de téléchargement et consultation
            dernierTelechargement: null,
            historiqueTelechargements: [],
            derniereConsultation: null,
            historiqueConsultations: [],
            // ✅ Verrouillage du document (niveau 1 uniquement)
            locked: locked === true && role && role.niveau == 1 ? true : false,
            lockedBy: locked === true && role && role.niveau == 1 ? {
                utilisateur: userId,
                nomComplet: user.nom,
                email: user.email,
                date: new Date()
            } : null
        };
        
        const result = await documentsCollection.insertOne(document);

        // 📝 Logger l'archivage dans auditLogs
        await auditLogsCollection.insertOne({
            timestamp: new Date(),
            user: userId,
            action: 'DOCUMENT_ARCHIVED',
            details: {
                documentId: document.idDocument,  // Utiliser idDocument (ID lisible)
                titre: document.titre,
                categorie: document.categorie,
                ip: req.ip,
                userAgent: req.headers['user-agent']
            },
            documentId: document.idDocument,  // Utiliser idDocument (ID lisible)
            ip: req.ip,
            userAgent: req.headers['user-agent']
        });

        res.json({
            success: true,
            document: { ...document, _id: result.insertedId }
        });

    } catch (error) {
        console.error('Erreur ajout document:', error);
        res.status(500).json({ success: false, message: 'Erreur serveur' });
    }
});

// Récupérer les documents accessibles
app.get('/api/documents/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        const { full } = req.query;

        const documents = await getAccessibleDocuments(userId);

        // ✅ TRI PAR DÉFAUT : Plus récents en haut (dateAjout décroissant)
        documents.sort((a, b) => {
            const dateA = a.dateAjout ? new Date(a.dateAjout) : new Date(0);
            const dateB = b.dateAjout ? new Date(b.dateAjout) : new Date(0);
            return dateB - dateA; // Décroissant (plus récent en premier)
        });

        // Retirer le contenu si full=false
        if (full !== 'true') {
            documents.forEach(doc => delete doc.contenu);
        }

        res.json(documents);

    } catch (error) {
        console.error('Erreur récupération documents:', error);
        res.status(500).json({ message: 'Erreur serveur' });
    }
});

// Récupérer un document spécifique
app.get('/api/documents/:userId/:docId', async (req, res) => {
    try {
        const { userId, docId } = req.params;

        const canAccess = await canAccessDocument(userId, docId);
        if (!canAccess) {
            return res.status(403).json({
                message: 'Accès refusé à ce document'
            });
        }

        const document = await documentsCollection.findOne({
            _id: new ObjectId(docId),
            deleted: { $ne: true }  // ✅ Exclure documents supprimés
        });

        if (!document) {
            return res.status(404).json({ message: 'Document non trouvé' });
        }

        // Vérifier si le document est verrouillé
        const user = await usersCollection.findOne({ username: userId });
        if (document.locked) {
            // Seuls les utilisateurs niveau 1 peuvent accéder aux documents verrouillés
            const role = user ? await rolesCollection.findOne({ _id: new ObjectId(user.idRole) }) : null;
            if (!role || role.niveau !== 1) {
                return res.status(403).json({
                    success: false,
                    message: 'Document verrouillé',
                    locked: true,
                    lockedBy: document.lockedBy
                });
            }
        }

        // Enregistrer la consultation
        if (user) {
            const role = await rolesCollection.findOne({ _id: new ObjectId(user.idRole) });
            const departement = user.idDepartement ? await departementsCollection.findOne({ _id: new ObjectId(user.idDepartement) }) : null;

            const consultationInfo = {
                utilisateur: userId,
                nomComplet: user.nom,
                email: user.email,
                niveau: role ? role.niveau : null,
                role: role ? role.libelle : null,
                departement: departement ? departement.nom : null,
                date: new Date()
            };

            await documentsCollection.updateOne(
                { _id: new ObjectId(docId) },
                {
                    $set: {
                        derniereConsultation: consultationInfo
                    },
                    $push: {
                        historiqueConsultations: consultationInfo
                    }
                }
            );

            // 📝 Logger la consultation dans auditLogs
            await auditLogsCollection.insertOne({
                timestamp: new Date(),
                user: userId,
                action: 'DOCUMENT_VIEWED',
                details: {
                    documentId: document.idDocument || docId,  // Utiliser idDocument (ID lisible)
                    titre: document.titre,
                    ip: req.ip,
                    userAgent: req.headers['user-agent']
                },
                documentId: document.idDocument || docId,  // Utiliser idDocument (ID lisible)
                ip: req.ip,
                userAgent: req.headers['user-agent']
            });

            console.log(`👁️ Consultation enregistrée: ${user.nom} (${user.email}, niveau ${role?.niveau}) a consulté le document ${docId}`);
        }

        // ✅ Récupérer l'historique des partages depuis la collection shareHistory
        const shareHistory = await shareHistoryCollection
            .find({ documentId: new ObjectId(docId) })
            .sort({ sharedAt: -1 })
            .toArray();

        // Enrichir l'historique des partages avec les informations des utilisateurs
        const enrichedShareHistory = await Promise.all(shareHistory.map(async (share) => {
            const sharedByUser = await usersCollection.findOne({ username: share.sharedBy });
            const sharedWithUser = await usersCollection.findOne({ username: share.sharedWith });

            const sharedByRole = sharedByUser ? await rolesCollection.findOne({ _id: sharedByUser.idRole }) : null;
            const sharedWithRole = sharedWithUser ? await rolesCollection.findOne({ _id: sharedWithUser.idRole }) : null;

            const sharedByDept = sharedByUser ? await departementsCollection.findOne({ _id: sharedByUser.idDepartement }) : null;
            const sharedWithDept = sharedWithUser ? await departementsCollection.findOne({ _id: sharedWithUser.idDepartement }) : null;

            return {
                ...share,
                sharedByRole: sharedByRole ? sharedByRole.libelle : null,
                sharedByNiveau: sharedByRole ? sharedByRole.niveau : null,
                sharedByDepartement: sharedByDept ? sharedByDept.nom : null,
                sharedWithRole: sharedWithRole ? sharedWithRole.libelle : null,
                sharedWithNiveau: sharedWithRole ? sharedWithRole.niveau : null,
                sharedWithDepartement: sharedWithDept ? sharedWithDept.nom : null
            };
        }));

        // Ajouter l'historique des partages au document
        const documentWithShareHistory = {
            ...document,
            historiquePartages: enrichedShareHistory
        };

        res.json(documentWithShareHistory);

    } catch (error) {
        console.error('Erreur récupération document:', error);
        res.status(500).json({ message: 'Erreur serveur' });
    }
});

// Enregistrer un téléchargement de document
app.post('/api/documents/:userId/:docId/download', async (req, res) => {
    try {
        const { userId, docId } = req.params;

        const canAccess = await canAccessDocument(userId, docId);
        if (!canAccess) {
            return res.status(403).json({
                success: false,
                message: 'Accès refusé à ce document'
            });
        }

        const user = await usersCollection.findOne({ username: userId });
        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'Utilisateur non trouvé'
            });
        }

        // Récupérer le document pour avoir accès à idDocument
        const document = await documentsCollection.findOne({
            _id: new ObjectId(docId),
            deleted: { $ne: true }  // ✅ Exclure documents supprimés
        });
        if (!document) {
            return res.status(404).json({
                success: false,
                message: 'Document non trouvé'
            });
        }

        // Récupérer le rôle de l'utilisateur pour avoir le niveau
        const userRole = await rolesCollection.findOne({ _id: user.idRole });

        // Enregistrer le téléchargement avec nom, email et niveau
        const now = new Date();
        const downloadInfo = {
            date: now,
            utilisateur: userId,
            nomComplet: user.nom,
            email: user.email,
            niveau: userRole ? userRole.niveau : null,
            role: userRole ? userRole.libelle : null
        };

        await documentsCollection.updateOne(
            { _id: new ObjectId(docId) },
            {
                $set: {
                    dernierTelechargement: downloadInfo
                },
                $push: {
                    historiqueTelechargements: downloadInfo
                }
            }
        );

        // 📝 Logger le téléchargement dans auditLogs
        await auditLogsCollection.insertOne({
            timestamp: new Date(),
            user: userId,
            action: 'DOCUMENT_DOWNLOADED',
            details: {
                documentId: document.idDocument || docId,  // Utiliser idDocument (ID lisible)
                titre: document.titre,
                ip: req.ip,
                userAgent: req.headers['user-agent']
            },
            documentId: document.idDocument || docId,  // Utiliser idDocument (ID lisible)
            ip: req.ip,
            userAgent: req.headers['user-agent']
        });

        console.log(`📥 Téléchargement enregistré: ${user.nom} (${user.email}, niveau ${downloadInfo.niveau}) a téléchargé le document ${docId}`);

        res.json({ success: true });

    } catch (error) {
        console.error('Erreur enregistrement téléchargement:', error);
        res.status(500).json({ success: false, message: 'Erreur serveur' });
    }
});

// ============================================
// PARTAGE DE DOCUMENT
// ============================================

// Partager un document avec un ou plusieurs utilisateurs
app.post('/api/documents/:userId/:docId/share', async (req, res) => {
    try {
        const { userId, docId } = req.params;
        const { targetUsers } = req.body; // Array de usernames

        if (!targetUsers || !Array.isArray(targetUsers) || targetUsers.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'Liste d\'utilisateurs invalide'
            });
        }

        // Vérifier que le document existe
        const document = await documentsCollection.findOne({
            _id: new ObjectId(docId),
            deleted: { $ne: true }  // ✅ Exclure documents supprimés
        });
        if (!document) {
            return res.status(404).json({
                success: false,
                message: 'Document non trouvé'
            });
        }

        // Vérifier que l'utilisateur a accès au document
        // Un utilisateur peut partager si :
        // 1. Le document est du même département que lui
        // 2. Le document lui a été partagé
        const user = await usersCollection.findOne({ username: userId });
        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'Utilisateur non trouvé'
            });
        }

        const documentOwner = await usersCollection.findOne({ username: document.idUtilisateur });

        // Vérifier que l'utilisateur est du même département que le document
        const sameDepartment = (
            documentOwner &&
            user.idDepartement &&
            documentOwner.idDepartement &&
            documentOwner.idDepartement.toString() === user.idDepartement.toString()
        );
        const hasSharedAccess = document.sharedWith && document.sharedWith.includes(userId);

        if (!sameDepartment && !hasSharedAccess) {
            return res.status(403).json({
                success: false,
                message: 'Vous n\'avez pas accès à ce document'
            });
        }

        // Vérifier que tous les utilisateurs cibles existent
        const targetUsersExist = await usersCollection.find({
            username: { $in: targetUsers }
        }).toArray();

        if (targetUsersExist.length !== targetUsers.length) {
            return res.status(404).json({
                success: false,
                message: 'Un ou plusieurs utilisateurs n\'existent pas'
            });
        }

        // Ajouter les utilisateurs à la liste de partage (sans doublons)
        const currentSharedWith = document.sharedWith || [];
        const newSharedWith = [...new Set([...currentSharedWith, ...targetUsers])];

        await documentsCollection.updateOne(
            { _id: new ObjectId(docId) },
            { $set: { sharedWith: newSharedWith } }
        );

        // ✅ NOUVEAU: Enregistrer l'historique des partages ET envoyer un message
        const sharer = await usersCollection.findOne({ username: userId });
        for (const targetUser of targetUsers) {
            // Ne pas enregistrer si déjà partagé précédemment
            if (!currentSharedWith.includes(targetUser)) {
                const targetUserInfo = await usersCollection.findOne({ username: targetUser });
                await shareHistoryCollection.insertOne({
                    documentId: new ObjectId(docId),
                    documentTitle: document.titre,
                    documentIdDocument: document.idDocument,
                    sharedBy: userId,
                    sharedByName: sharer ? sharer.nom : userId,
                    sharedWith: targetUser,
                    sharedWithName: targetUserInfo ? targetUserInfo.nom : targetUser,
                    sharedAt: new Date()
                });

                // 📧 Envoyer un message automatique de notification de partage
                const sharerName = sharer ? sharer.nom : userId;
                await messagesCollection.insertOne({
                    from: userId,
                    fromName: sharerName,
                    to: targetUser,
                    toName: targetUserInfo ? targetUserInfo.nom : targetUser,
                    subject: `📄 Document partagé avec vous : ${document.titre}`,
                    body: `Bonjour,\n\n${sharerName} a partagé le document "${document.titre}" (${document.idDocument}) avec vous.\n\nVous pouvez maintenant consulter ce document dans votre espace de documents partagés.\n\n---\nNotification automatique - C.E.R.E.R`,
                    type: 'document-share',
                    read: false,
                    createdAt: new Date(),
                    relatedData: {
                        documentId: docId,
                        documentTitle: document.titre,
                        sharedBy: userId
                    }
                });
            }
        }

        // 📝 Logger l'action de partage dans auditLogs
        await auditLogsCollection.insertOne({
            timestamp: new Date(),
            user: userId,
            action: 'DOCUMENT_SHARED',
            details: {
                documentId: document.idDocument || docId,  // Utiliser idDocument (ID lisible)
                titre: document.titre,
                sharedWith: targetUsers,
                ip: req.ip,
                userAgent: req.headers['user-agent']
            },
            documentId: document.idDocument || docId,  // Utiliser idDocument (ID lisible)
            ip: req.ip,
            userAgent: req.headers['user-agent']
        });

        console.log(`📤 Document ${docId} partagé par ${userId} avec ${targetUsers.join(', ')}`);

        res.json({
            success: true,
            message: 'Document partagé avec succès',
            sharedWith: newSharedWith
        });

    } catch (error) {
        console.error('Erreur partage document:', error);
        res.status(500).json({ success: false, message: 'Erreur serveur' });
    }
});

// Retirer le partage d'un document pour un utilisateur
app.post('/api/documents/:userId/:docId/unshare', async (req, res) => {
    try {
        const { userId, docId } = req.params;
        const { targetUser } = req.body;

        if (!targetUser) {
            return res.status(400).json({
                success: false,
                message: 'Utilisateur cible manquant'
            });
        }

        // Vérifier que l'utilisateur est propriétaire du document
        const document = await documentsCollection.findOne({ _id: new ObjectId(docId) });
        if (!document) {
            return res.status(404).json({
                success: false,
                message: 'Document non trouvé'
            });
        }

        if (document.idUtilisateur !== userId) {
            return res.status(403).json({
                success: false,
                message: 'Seul le propriétaire peut modifier le partage'
            });
        }

        // Retirer l'utilisateur de la liste de partage
        const updatedSharedWith = (document.sharedWith || []).filter(u => u !== targetUser);

        await documentsCollection.updateOne(
            { _id: new ObjectId(docId) },
            { $set: { sharedWith: updatedSharedWith } }
        );

        console.log(`🔒 Partage retiré: ${docId} n'est plus partagé avec ${targetUser}`);

        res.json({
            success: true,
            message: 'Partage retiré avec succès',
            sharedWith: updatedSharedWith
        });

    } catch (error) {
        console.error('Erreur retrait partage:', error);
        res.status(500).json({ success: false, message: 'Erreur serveur' });
    }
});

// Récupérer la liste des utilisateurs avec qui un document est partagé
app.get('/api/documents/:userId/:docId/shared-users', async (req, res) => {
    try {
        const { userId, docId } = req.params;

        const document = await documentsCollection.findOne({ _id: new ObjectId(docId) });
        if (!document) {
            return res.status(404).json({
                success: false,
                message: 'Document non trouvé'
            });
        }

        // Seul le propriétaire peut voir avec qui le document est partagé
        if (document.idUtilisateur !== userId) {
            return res.status(403).json({
                success: false,
                message: 'Accès refusé'
            });
        }

        const sharedWith = document.sharedWith || [];

        // Récupérer les informations des utilisateurs
        const sharedUsers = await usersCollection.find({
            username: { $in: sharedWith }
        }).toArray();

        res.json({
            success: true,
            sharedWith: sharedUsers.map(u => ({
                username: u.username,
                nom: u.nom,
                email: u.email
            }))
        });

    } catch (error) {
        console.error('Erreur récupération utilisateurs partagés:', error);
        res.status(500).json({ success: false, message: 'Erreur serveur' });
    }
});

// Verrouiller/Déverrouiller un document (niveau 1 uniquement)
app.post('/api/documents/:userId/:docId/toggle-lock', async (req, res) => {
    try {
        const { userId, docId } = req.params;

        // Vérifier que l'utilisateur est de niveau 1
        const user = await usersCollection.findOne({ username: userId });
        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'Utilisateur non trouvé'
            });
        }

        const role = await rolesCollection.findOne({ _id: new ObjectId(user.idRole) });
        if (!role || role.niveau !== 1) {
            return res.status(403).json({
                success: false,
                message: 'Seuls les administrateurs niveau 1 peuvent verrouiller/déverrouiller des documents'
            });
        }

        // Récupérer le document
        const document = await documentsCollection.findOne({ _id: new ObjectId(docId) });
        if (!document) {
            return res.status(404).json({
                success: false,
                message: 'Document non trouvé'
            });
        }

        // Inverser l'état de verrouillage
        const newLockedState = !document.locked;

        const updateData = {
            locked: newLockedState,
            lockedBy: newLockedState ? {
                utilisateur: userId,
                nomComplet: user.nom,
                email: user.email,
                date: new Date()
            } : null
        };

        await documentsCollection.updateOne(
            { _id: new ObjectId(docId) },
            { $set: updateData }
        );

        // Logger l'action dans auditLogs avec heure système
        await auditLogsCollection.insertOne({
            timestamp: new Date(),
            user: userId,
            action: newLockedState ? 'DOCUMENT_VERROUILLE' : 'DOCUMENT_DEVERROUILLE',
            details: {
                documentId: document.idDocument || docId,  // Utiliser idDocument (ID lisible)
                titre: document.titre,
                ip: req.ip,
                userAgent: req.headers['user-agent']
            },
            documentId: document.idDocument || docId,  // Utiliser idDocument (ID lisible)
            ip: req.ip,
            userAgent: req.headers['user-agent']
        });

        console.log(`🔒 Document ${docId} ${newLockedState ? 'verrouillé' : 'déverrouillé'} par ${userId}`);

        res.json({
            success: true,
            message: newLockedState ? 'Document verrouillé' : 'Document déverrouillé',
            locked: newLockedState,
            lockedBy: updateData.lockedBy
        });

    } catch (error) {
        console.error('Erreur verrouillage/déverrouillage document:', error);
        res.status(500).json({ success: false, message: 'Erreur serveur' });
    }
});

// Récupérer tous les utilisateurs (avec filtrage pour Niveau 1)
app.get('/api/users', async (req, res) => {
    try {
        const { ObjectId } = require('mongodb');
        let allUsers = [];

        // Vérifier si l'utilisateur connecté est de niveau 1
        if (req.session && req.session.userId) {
            const currentUser = await usersCollection.findOne({ username: req.session.userId });
            if (currentUser) {
                // 🔒 SÉCURITÉ: Convertir idRole en ObjectId pour la comparaison
                const roleId = typeof currentUser.idRole === 'string'
                    ? new ObjectId(currentUser.idRole)
                    : currentUser.idRole;

                const currentUserRole = await rolesCollection.findOne({ _id: roleId });

                console.log(`🔍 VÉRIFICATION NIVEAU - User: ${req.session.userId}, Role trouvé: ${currentUserRole?.nom}, Niveau: ${currentUserRole?.niveau} (type: ${typeof currentUserRole?.niveau})`);
                console.log(`🔍 TEST COMPARAISON - currentUserRole exists: ${!!currentUserRole}, niveau value: ${currentUserRole?.niveau}, niveau == 1: ${currentUserRole?.niveau == 1}, niveau === 1: ${currentUserRole?.niveau === 1}`);

                // ✅ Si niveau 1, filtrer pour ne montrer QUE les utilisateurs de son département ET services
                // 🔒 SÉCURITÉ CRITIQUE: Utiliser == au lieu de === pour gérer String "1" et Number 1
                if (currentUserRole && currentUserRole.niveau == 1) {
                    if (currentUser.idDepartement) {
                        // Convertir en ObjectId pour la comparaison
                        const deptId = typeof currentUser.idDepartement === 'string'
                            ? new ObjectId(currentUser.idDepartement)
                            : currentUser.idDepartement;

                        // 1. Récupérer tous les services du département du niveau 1
                        // ✅ CORRECTION: Chercher avec ObjectId ET String pour compatibilité
                        const services = await servicesCollection.find({
                            $or: [
                                { idDepartement: deptId },
                                { idDepartement: deptId.toString() }
                            ]
                        }).toArray();
                        const serviceIds = services.map(s => s._id);
                        const serviceIdsStr = serviceIds.map(s => s.toString());

                        console.log(`📋 Services du département: ${services.map(s => s.nom).join(', ')} (${serviceIds.length})`);

                        // 2. Récupérer les utilisateurs avec:
                        //    - idDepartement = département du niveau 1 (ObjectId OU String)
                        //    - OU idService dans la liste des services (ObjectId OU String)
                        const query = {
                            $or: [
                                { idDepartement: deptId },  // ObjectId
                                { idDepartement: deptId.toString() },  // String (compatibilité)
                                { idService: { $in: serviceIds } },  // ObjectId
                                { idService: { $in: serviceIdsStr } }  // String (compatibilité)
                            ]
                        };

                        allUsers = await usersCollection.find(query).toArray();

                        console.log(`🔒 SÉCURITÉ - Niveau 1 (${req.session.userId}) - Filtrage par département + services`);
                        console.log(`📊 Résultat: ${allUsers.length} utilisateur(s) trouvé(s)`);
                    } else {
                        // 🔴 SÉCURITÉ CRITIQUE: Niveau 1 sans département = AUCUN ACCÈS
                        console.log(`🔴 SÉCURITÉ CRITIQUE - Niveau 1 (${req.session.userId}) SANS DÉPARTEMENT - Retour liste vide`);
                        return res.json([]); // Retourner immédiatement une liste vide
                    }
                // 🔒 SÉCURITÉ CRITIQUE: Niveaux 2 et 3 doivent AUSSI être filtrés par département!
                } else if (currentUserRole && (currentUserRole.niveau == 2 || currentUserRole.niveau == 3)) {
                    if (currentUser.idDepartement) {
                        // Utilisateur de niveau 2 ou 3 avec département
                        const deptId = typeof currentUser.idDepartement === 'string'
                            ? new ObjectId(currentUser.idDepartement)
                            : currentUser.idDepartement;

                        const services = await servicesCollection.find({
                            $or: [
                                { idDepartement: deptId },
                                { idDepartement: deptId.toString() }
                            ]
                        }).toArray();
                        const serviceIds = services.map(s => s._id);
                        const serviceIdsStr = serviceIds.map(s => s.toString());

                        const query = {
                            $or: [
                                { idDepartement: deptId },
                                { idDepartement: deptId.toString() },
                                { idService: { $in: serviceIds } },
                                { idService: { $in: serviceIdsStr } }
                            ]
                        };

                        allUsers = await usersCollection.find(query).toArray();
                        console.log(`🔒 SÉCURITÉ - Niveau ${currentUserRole.niveau} (${req.session.userId}) - Filtrage par département`);
                    } else if (currentUser.idService) {
                        // Utilisateur dans un service: ne voir que les utilisateurs du même service
                        const serviceId = typeof currentUser.idService === 'string'
                            ? new ObjectId(currentUser.idService)
                            : currentUser.idService;

                        allUsers = await usersCollection.find({
                            $or: [
                                { idService: serviceId },
                                { idService: serviceId.toString() }
                            ]
                        }).toArray();
                        console.log(`🔒 SÉCURITÉ - Niveau ${currentUserRole.niveau} (${req.session.userId}) - Filtrage par service`);
                    } else {
                        // Niveau 2/3 sans département ni service = AUCUN ACCÈS
                        console.log(`🔴 SÉCURITÉ CRITIQUE - Niveau ${currentUserRole.niveau} (${req.session.userId}) SANS DÉPARTEMENT - Retour liste vide`);
                        return res.json([]);
                    }
                } else if (currentUserRole && currentUserRole.niveau == 0) {
                    // SEULEMENT Niveau 0 (Super Admin): accès à tous les utilisateurs
                    console.log(`✅ Super Admin ${req.session.userId} - Accès à tous les utilisateurs`);
                    allUsers = await usersCollection.find({}).toArray();
                } else {
                    // Niveau inconnu: pas d'accès
                    console.log(`🔴 Niveau inconnu pour ${req.session.userId} - Retour liste vide`);
                    return res.json([]);
                }
            } else {
                // Utilisateur non trouvé
                return res.json([]);
            }
        } else {
            // Pas de session
            return res.json([]);
        }

        console.log(`📊 RÉSULTAT /api/users - ${allUsers.length} utilisateur(s) retourné(s) pour ${req.session.userId}`);

        // Enrichir avec les informations du rôle, département et service
        const usersWithInfo = await Promise.all(allUsers.map(async (user) => {
            const role = await rolesCollection.findOne({ _id: user.idRole });
            const dept = user.idDepartement ? await departementsCollection.findOne({ _id: user.idDepartement }) : null;
            const service = user.idService ? await servicesCollection.findOne({ _id: user.idService }) : null;
            return {
                username: user.username,
                nom: user.nom,
                email: user.email,
                role: role ? role.libelle : 'Non défini',
                niveau: role ? role.niveau : null,
                departement: dept ? dept.nom : (service ? 'Via service' : 'Aucun (Admin Principal)'),
                service: service ? service.nom : null,
                idRole: user.idRole,
                idDepartement: user.idDepartement,
                idService: user.idService
            };
        }));

        console.log(`✅ Envoi de ${usersWithInfo.length} utilisateur(s) au client`);
        res.json(usersWithInfo);
    } catch (error) {
        console.error('Erreur récupération utilisateurs:', error);
        res.status(500).json({ success: false, message: 'Erreur serveur' });
    }
});

// Récupérer tous les utilisateurs disponibles pour le partage
app.get('/api/users-for-sharing/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        const { ObjectId } = require('mongodb');
        let allUsers = [];

        // Vérifier si l'utilisateur actuel est de niveau 1
        const currentUser = await usersCollection.findOne({ username: userId });
        if (currentUser) {
            // 🔒 SÉCURITÉ: Convertir idRole en ObjectId pour la comparaison
            const roleId = typeof currentUser.idRole === 'string'
                ? new ObjectId(currentUser.idRole)
                : currentUser.idRole;

            const currentUserRole = await rolesCollection.findOne({ _id: roleId });

            console.log(`🔍 VÉRIFICATION PARTAGE - User: ${userId}, Role: ${currentUserRole?.nom}, Niveau: ${currentUserRole?.niveau} (type: ${typeof currentUserRole?.niveau})`);

            // Si niveau 1, ne montrer que les utilisateurs de son département + services
            // 🔒 SÉCURITÉ CRITIQUE: Utiliser == au lieu de === pour gérer String "1" et Number 1
            if (currentUserRole && currentUserRole.niveau == 1) {
                if (currentUser.idDepartement) {
                    // Convertir en ObjectId pour la comparaison
                    const deptId = typeof currentUser.idDepartement === 'string'
                        ? new ObjectId(currentUser.idDepartement)
                        : currentUser.idDepartement;

                    // 1. Récupérer tous les services du département du niveau 1
                    // ✅ CORRECTION: Chercher avec ObjectId ET String pour compatibilité
                    const services = await servicesCollection.find({
                        $or: [
                            { idDepartement: deptId },
                            { idDepartement: deptId.toString() }
                        ]
                    }).toArray();
                    const serviceIds = services.map(s => s._id);
                    const serviceIdsStr = serviceIds.map(s => s.toString());

                    console.log(`📋 Services du département pour partage: ${services.map(s => s.nom).join(', ')} (${serviceIds.length})`);

                    // 2. Récupérer les utilisateurs (excluant l'utilisateur courant) avec:
                    //    - idDepartement = département du niveau 1 (ObjectId OU String)
                    //    - OU idService dans la liste des services (ObjectId OU String)
                    const query = {
                        username: { $ne: userId },  // Exclure l'utilisateur courant
                        $or: [
                            { idDepartement: deptId },  // ObjectId
                            { idDepartement: deptId.toString() },  // String
                            { idService: { $in: serviceIds } },  // ObjectId
                            { idService: { $in: serviceIdsStr } }  // String
                        ]
                    };

                    allUsers = await usersCollection.find(query).toArray();

                    console.log(`🔒 SÉCURITÉ PARTAGE - Niveau 1 (${userId}) - Filtrage par département + services`);
                    console.log(`📊 Résultat partage: ${allUsers.length} utilisateur(s) disponible(s)`);
                } else {
                    // 🔴 SÉCURITÉ CRITIQUE: Niveau 1 sans département = AUCUN PARTAGE POSSIBLE
                    console.log(`🔴 SÉCURITÉ PARTAGE - Niveau 1 (${userId}) SANS DÉPARTEMENT - Retour liste vide`);
                    return res.json({ success: true, users: [] });
                }
            // 🔒 SÉCURITÉ CRITIQUE: Niveaux 2 et 3 doivent AUSSI être filtrés!
            } else if (currentUserRole && (currentUserRole.niveau == 2 || currentUserRole.niveau == 3)) {
                if (currentUser.idDepartement) {
                    const deptId = typeof currentUser.idDepartement === 'string'
                        ? new ObjectId(currentUser.idDepartement)
                        : currentUser.idDepartement;

                    const services = await servicesCollection.find({
                        $or: [
                            { idDepartement: deptId },
                            { idDepartement: deptId.toString() }
                        ]
                    }).toArray();
                    const serviceIds = services.map(s => s._id);
                    const serviceIdsStr = serviceIds.map(s => s.toString());

                    const query = {
                        username: { $ne: userId },
                        $or: [
                            { idDepartement: deptId },
                            { idDepartement: deptId.toString() },
                            { idService: { $in: serviceIds } },
                            { idService: { $in: serviceIdsStr } }
                        ]
                    };

                    allUsers = await usersCollection.find(query).toArray();
                    console.log(`🔒 SÉCURITÉ PARTAGE - Niveau ${currentUserRole.niveau} (${userId}) - Filtrage par département`);
                } else if (currentUser.idService) {
                    const serviceId = typeof currentUser.idService === 'string'
                        ? new ObjectId(currentUser.idService)
                        : currentUser.idService;

                    allUsers = await usersCollection.find({
                        username: { $ne: userId },
                        $or: [
                            { idService: serviceId },
                            { idService: serviceId.toString() }
                        ]
                    }).toArray();
                    console.log(`🔒 SÉCURITÉ PARTAGE - Niveau ${currentUserRole.niveau} (${userId}) - Filtrage par service`);
                } else {
                    console.log(`🔴 SÉCURITÉ PARTAGE - Niveau ${currentUserRole.niveau} (${userId}) SANS DÉPARTEMENT - Retour liste vide`);
                    return res.json({ success: true, users: [] });
                }
            } else if (currentUserRole && currentUserRole.niveau == 0) {
                // SEULEMENT Niveau 0: accès à tous les utilisateurs sauf soi-même
                console.log(`✅ Super Admin ${userId} - Accès à tous pour partage`);
                allUsers = await usersCollection.find({ username: { $ne: userId } }).toArray();
            } else {
                // Niveau inconnu: pas d'accès
                console.log(`🔴 PARTAGE - Niveau inconnu pour ${userId} - Retour liste vide`);
                return res.json({ success: true, users: [] });
            }
        } else {
            return res.json({ success: true, users: [] });
        }

        // Enrichir avec les informations du rôle, département et service
        const usersWithInfo = await Promise.all(allUsers.map(async (user) => {
            const role = await rolesCollection.findOne({ _id: user.idRole });
            const dept = user.idDepartement ? await departementsCollection.findOne({ _id: user.idDepartement }) : null;
            const service = user.idService ? await servicesCollection.findOne({ _id: user.idService }) : null;
            return {
                username: user.username,
                nom: user.nom,
                email: user.email,
                role: role ? role.libelle : 'Non défini',
                niveau: role ? role.niveau : 0,
                departement: dept ? dept.nom : (service ? 'Via service' : 'Aucun'),
                service: service ? service.nom : null
            };
        }));

        res.json({
            success: true,
            users: usersWithInfo
        });

    } catch (error) {
        console.error('Erreur récupération utilisateurs:', error);
        res.status(500).json({ success: false, message: 'Erreur serveur' });
    }
});

// Supprimer tous les documents accessibles de l'utilisateur
// ⚠️ IMPORTANT: Cette route DOIT être AVANT /api/documents/:userId/:docId
app.delete('/api/documents/:userId/delete-all', async (req, res) => {
    try {
        const { userId } = req.params;
        console.log('🗑️ Demande de suppression pour:', userId);

        const user = await usersCollection.findOne({ username: userId });
        if (!user) {
            console.log('❌ Utilisateur non trouvé:', userId);
            return res.status(404).json({
                success: false,
                message: 'Utilisateur non trouvé'
            });
        }

        console.log('✅ Utilisateur trouvé:', user.username, 'Département:', user.idDepartement);

        const userRole = await rolesCollection.findOne({ _id: user.idRole });
        if (!userRole) {
            console.log('❌ Rôle non trouvé pour:', user.idRole);
            return res.status(404).json({
                success: false,
                message: 'Rôle utilisateur non trouvé'
            });
        }

        console.log('✅ Rôle utilisateur:', userRole.libelle, 'Niveau:', userRole.niveau);

        let result;
        let query;

        if (userRole.niveau == 1) {
            // ✅ NIVEAU 1 : Supprimer TOUS les documents de SON département uniquement
            query = { idDepartement: user.idDepartement };
            console.log('📋 Suppression niveau 1 (ADMIN) - TOUS les documents de SON département');
        } else if (userRole.niveau == 2) {
            // ✅ NIVEAU 2 : Supprimer TOUS les documents de son département
            query = { idDepartement: user.idDepartement };
            console.log('📋 Suppression niveau 2 - Documents du département:', user.idDepartement);
        } else {
            // ✅ NIVEAU 3 : Uniquement ses propres documents
            query = { idUtilisateur: userId };
            console.log('📋 Suppression niveau 3 - Documents de l\'utilisateur:', userId);
        }

        // Compter avant suppression
        const countBefore = await documentsCollection.countDocuments(query);
        console.log('📊 Documents à supprimer:', countBefore);

        // Afficher quelques documents pour debug
        const sampleDocs = await documentsCollection.find(query).limit(3).toArray();
        console.log('📄 Exemples de documents:', sampleDocs.map(d => ({
            _id: d._id,
            titre: d.titre,
            idUtilisateur: d.idUtilisateur,
            idDepartement: d.idDepartement
        })));

        result = await documentsCollection.deleteMany(query);
        console.log('✅ Documents supprimés:', result.deletedCount);

        res.json({
            success: true,
            deletedCount: result.deletedCount
        });

    } catch (error) {
        console.error('❌ Erreur suppression en masse:', error);
        res.status(500).json({ success: false, message: 'Erreur serveur' });
    }
});

// Supprimer un document
// ============================================
// NOUVEAU SYSTÈME DE CORBEILLE (Soft Delete)
// ============================================
app.delete('/api/documents/:userId/:docId', async (req, res) => {
    try {
        const { userId, docId } = req.params;
        const { motif, departement, service, categorie } = req.body;

        // VALIDATION MOTIF OBLIGATOIRE
        if (!motif || motif.trim() === '') {
            return res.status(400).json({
                success: false,
                message: 'Le motif de suppression est obligatoire'
            });
        }

        const canAccess = await canAccessDocument(userId, docId);
        if (!canAccess) {
            return res.status(403).json({
                success: false,
                message: 'Accès refusé'
            });
        }

        // Récupérer utilisateur et document
        const user = await usersCollection.findOne({ username: userId });
        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'Utilisateur non trouvé'
            });
        }

        const userRole = await rolesCollection.findOne({ _id: user.idRole });
        if (!userRole) {
            return res.status(404).json({
                success: false,
                message: 'Rôle utilisateur non trouvé'
            });
        }

        const document = await documentsCollection.findOne({ _id: new ObjectId(docId) });
        if (!document) {
            return res.status(404).json({
                success: false,
                message: 'Document non trouvé'
            });
        }

        // Vérifier droits: niveau 3 ne peut supprimer que ses propres documents
        if (userRole.niveau == 3 && document.idUtilisateur !== userId) {
            return res.status(403).json({
                success: false,
                message: 'Vous ne pouvez supprimer que vos propres documents'
            });
        }

        // Calculer date d'expiration (2 mois)
        const deletedAt = new Date();
        const expiresAt = new Date(deletedAt);
        expiresAt.setMonth(expiresAt.getMonth() + 2);

        // SOFT DELETE - Mise en corbeille
        const result = await documentsCollection.updateOne(
            { _id: new ObjectId(docId) },
            {
                $set: {
                    deleted: true,
                    deletionInfo: {
                        deletedAt: deletedAt,
                        deletedBy: userId,
                        deletedByName: user.nom,
                        deletedByEmail: user.email,
                        deletedByLevel: userRole.niveau,
                        motif: motif.trim(),
                        departement: departement || document.departementArchivage || 'Non spécifié',
                        idDepartement: document.idDepartement,
                        service: service || document.serviceArchivage || 'Non spécifié',
                        idService: document.idService,
                        categorie: categorie || document.categorie || 'Non spécifié',
                        ip: req.ip,
                        userAgent: req.headers['user-agent'],
                        expiresAt: expiresAt
                    }
                }
            }
        );

        if (result.modifiedCount === 0) {
            return res.status(500).json({
                success: false,
                message: 'Erreur lors de la mise en corbeille'
            });
        }

        // Logger la mise en corbeille
        await auditLogsCollection.insertOne({
            timestamp: deletedAt,
            user: userId,
            action: 'DOCUMENT_MOVED_TO_TRASH',
            details: {
                documentId: document.idDocument || docId,
                titre: document.titre,
                motif: motif.trim(),
                expiresAt: expiresAt,
                niveau: userRole.niveau
            },
            documentId: document.idDocument || docId,
            ip: req.ip,
            userAgent: req.headers['user-agent']
        });

        console.log(`🗑️ Document mis en corbeille par ${userId} (niveau ${userRole.niveau}): ${document.idDocument}, expire le ${expiresAt.toISOString()}`);

        res.json({
            success: true,
            message: 'Document déplacé vers la corbeille (récupérable pendant 2 mois)',
            expiresAt: expiresAt,
            daysUntilExpiration: 60
        });

    } catch (error) {
        console.error('Erreur suppression document:', error);
        res.status(500).json({ success: false, message: 'Erreur serveur' });
    }
});

// ============================================
// RESTAURER UN DOCUMENT DEPUIS LA CORBEILLE
// ============================================
app.post('/api/documents/restore/:docId', async (req, res) => {
    try {
        const { docId } = req.params;
        const { userId } = req.body;

        // Vérifier Super Admin (niveau 0)
        const user = await usersCollection.findOne({ username: userId });
        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'Utilisateur non trouvé'
            });
        }

        const userRole = await rolesCollection.findOne({ _id: user.idRole });
        if (!userRole || userRole.niveau !== 0) {
            return res.status(403).json({
                success: false,
                message: 'Seul le Super Admin peut restaurer des documents'
            });
        }

        // Récupérer le document supprimé
        const document = await documentsCollection.findOne({
            _id: new ObjectId(docId),
            deleted: true
        });

        if (!document) {
            return res.status(404).json({
                success: false,
                message: 'Document non trouvé dans la corbeille'
            });
        }

        // Vérifier si le document n'est pas expiré
        if (document.deletionInfo && document.deletionInfo.expiresAt < new Date()) {
            return res.status(400).json({
                success: false,
                message: 'Ce document a expiré et ne peut plus être restauré'
            });
        }

        // Restaurer le document
        const result = await documentsCollection.updateOne(
            { _id: new ObjectId(docId) },
            {
                $set: { deleted: false },
                $unset: { deletionInfo: "" }
            }
        );

        if (result.modifiedCount === 0) {
            return res.status(500).json({
                success: false,
                message: 'Erreur lors de la restauration'
            });
        }

        // Logger la restauration
        await auditLogsCollection.insertOne({
            timestamp: new Date(),
            user: userId,
            action: 'DOCUMENT_RESTORED',
            details: {
                documentId: document.idDocument || docId,
                titre: document.titre,
                deletedAt: document.deletionInfo?.deletedAt,
                deletedBy: document.deletionInfo?.deletedBy,
                restoredAt: new Date()
            },
            documentId: document.idDocument || docId,
            ip: req.ip,
            userAgent: req.headers['user-agent']
        });

        console.log(`♻️ Document restauré par Super Admin ${userId}: ${document.idDocument}`);

        res.json({
            success: true,
            message: 'Document restauré avec succès',
            document: {
                idDocument: document.idDocument,
                titre: document.titre
            }
        });

    } catch (error) {
        console.error('Erreur restauration document:', error);
        res.status(500).json({
            success: false,
            message: 'Erreur serveur'
        });
    }
});

// ============================================
// SUPPRESSION DÉFINITIVE MANUELLE
// ============================================
app.delete('/api/documents/permanent/:docId', async (req, res) => {
    try {
        const { docId } = req.params;
        const { userId } = req.body;

        // Vérifier Super Admin (niveau 0)
        const user = await usersCollection.findOne({ username: userId });
        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'Utilisateur non trouvé'
            });
        }

        const userRole = await rolesCollection.findOne({ _id: user.idRole });
        if (!userRole || userRole.niveau !== 0) {
            return res.status(403).json({
                success: false,
                message: 'Seul le Super Admin peut supprimer définitivement'
            });
        }

        // Récupérer le document (doit être dans la corbeille)
        const document = await documentsCollection.findOne({
            _id: new ObjectId(docId),
            deleted: true
        });

        if (!document) {
            return res.status(404).json({
                success: false,
                message: 'Document non trouvé dans la corbeille'
            });
        }

        // Suppression définitive (hard delete)
        const result = await documentsCollection.deleteOne({
            _id: new ObjectId(docId)
        });

        if (result.deletedCount === 0) {
            return res.status(500).json({
                success: false,
                message: 'Erreur lors de la suppression'
            });
        }

        // Logger la suppression définitive
        await auditLogsCollection.insertOne({
            timestamp: new Date(),
            user: userId,
            action: 'DOCUMENT_PERMANENTLY_DELETED',
            details: {
                documentId: document.idDocument || docId,
                titre: document.titre,
                deletedAt: document.deletionInfo?.deletedAt,
                reason: `Manual deletion by Super Admin ${userId}`
            },
            documentId: document.idDocument || docId,
            ip: req.ip,
            userAgent: req.headers['user-agent']
        });

        console.log(`💀 Document supprimé DÉFINITIVEMENT par Super Admin ${userId}: ${document.idDocument}`);

        res.json({
            success: true,
            message: 'Document supprimé définitivement'
        });

    } catch (error) {
        console.error('Erreur suppression permanente:', error);
        res.status(500).json({
            success: false,
            message: 'Erreur serveur'
        });
    }
});

// Import en masse de documents
app.post('/api/documents/bulk', async (req, res) => {
    try {
        const { userId, documents } = req.body;

        if (!userId || !Array.isArray(documents)) {
            return res.status(400).json({
                success: false,
                message: 'Données invalides'
            });
        }

        const user = await usersCollection.findOne({ username: userId });
        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'Utilisateur non trouvé'
            });
        }

        // Validation des extensions autorisées pour tous les documents
        const allowedExtensions = [
            '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.txt',
            '.odt', '.ods', '.odp', '.rtf', '.csv',
            '.jpg', '.jpeg', '.png', '.gif', '.bmp', '.svg', '.webp',
            '.zip', '.rar'
        ];

        const blockedExtensions = [
            '.mp4', '.avi', '.mov', '.mkv', '.flv', '.wmv', '.webm',
            '.mp3', '.wav', '.ogg', '.m4a',
            '.exe', '.bat', '.sh', '.msi', '.cmd', '.vbs', '.ps1'
        ];

        // Filtrer les documents pour ne garder que ceux avec extensions valides
        const validDocs = documents.filter(doc => {
            if (!doc.nomFichier) return false;
            const fileName = doc.nomFichier.toLowerCase();
            const isAllowed = allowedExtensions.some(ext => fileName.endsWith(ext));
            const isBlocked = blockedExtensions.some(ext => fileName.endsWith(ext));
            return isAllowed && !isBlocked;
        });

        if (validDocs.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'Aucun document valide à importer. Seuls les documents, images et archives sont autorisés.'
            });
        }

        // Ajouter idDepartement à tous les documents valides
        const now = new Date();
        const docsToInsert = validDocs.map(doc => ({
            ...doc,
            idUtilisateur: userId,
            idDepartement: user.idDepartement,
            // ✅ S'assurer que dateAjout existe toujours
            dateAjout: doc.dateAjout || now,
            // ✅ S'assurer que date existe (date du document)
            date: doc.date || now,
            createdAt: now,
            // ✅ Informations de l'archiveur (celui qui importe)
            archivePar: doc.archivePar || {
                utilisateur: userId,
                nomComplet: user.nom,
                date: now
            },
            // ✅ Initialiser les champs de téléchargement s'ils n'existent pas
            dernierTelechargement: doc.dernierTelechargement || null,
            historiqueTelechargements: doc.historiqueTelechargements || []
        }));

        console.log(`📥 Import de ${docsToInsert.length} documents pour ${userId}`);
        console.log(`📅 Exemple de dates: dateAjout=${docsToInsert[0]?.dateAjout}, date=${docsToInsert[0]?.date}`);

        const result = await documentsCollection.insertMany(docsToInsert);

        res.json({
            success: true,
            insertedCount: result.insertedCount
        });

    } catch (error) {
        console.error('Erreur import en masse:', error);
        res.status(500).json({ success: false, message: 'Erreur serveur' });
    }
});

// ============================================
// ROUTES DE MESSAGERIE INTERNE
// ============================================

// Envoyer un message
app.post('/api/messages', async (req, res) => {
    try {
        const { from, to, subject, body, type, relatedData } = req.body;

        if (!from || !to || !body) {
            return res.status(400).json({ success: false, message: 'Données manquantes' });
        }

        // Vérifier que l'expéditeur et le destinataire existent
        const sender = await usersCollection.findOne({ username: from });
        const recipient = await usersCollection.findOne({ username: to });

        if (!sender || !recipient) {
            return res.status(404).json({ success: false, message: 'Utilisateur non trouvé' });
        }

        const message = {
            from,
            fromName: sender.nom,
            to,
            toName: recipient.nom,
            subject,
            body,
            type: type || 'normal', // normal, deletion-request, deletion-response
            relatedData: relatedData || null, // Pour stocker l'ID de la demande de suppression, etc.
            read: false,
            createdAt: new Date()
        };

        const result = await messagesCollection.insertOne(message);

        res.json({ success: true, messageId: result.insertedId });
    } catch (error) {
        console.error('Erreur envoi message:', error);
        res.status(500).json({ success: false, message: 'Erreur serveur' });
    }
});

// Récupérer les messages reçus (limité à 20)
app.get('/api/messages/received/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        const { unreadOnly } = req.query;

        const query = { to: userId };
        if (unreadOnly === 'true') {
            query.read = false;
        }

        const messages = await messagesCollection
            .find(query)
            .sort({ createdAt: -1 })
            .limit(20)
            .toArray();

        res.json({ success: true, messages });
    } catch (error) {
        console.error('Erreur récupération messages reçus:', error);
        res.status(500).json({ success: false, message: 'Erreur serveur' });
    }
});

// Récupérer les messages envoyés (limité à 20)
app.get('/api/messages/sent/:userId', async (req, res) => {
    try {
        const { userId } = req.params;

        const messages = await messagesCollection
            .find({ from: userId })
            .sort({ createdAt: -1 })
            .limit(20)
            .toArray();

        res.json({ success: true, messages });
    } catch (error) {
        console.error('Erreur récupération messages envoyés:', error);
        res.status(500).json({ success: false, message: 'Erreur serveur' });
    }
});

// Récupérer les messages d'un utilisateur (ancienne route pour compatibilité)
app.get('/api/messages/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        const { unreadOnly } = req.query;

        const query = { to: userId };
        if (unreadOnly === 'true') {
            query.read = false;
        }

        const messages = await messagesCollection
            .find(query)
            .sort({ createdAt: -1 })
            .toArray();

        res.json(messages);
    } catch (error) {
        console.error('Erreur récupération messages:', error);
        res.status(500).json({ success: false, message: 'Erreur serveur' });
    }
});

// Marquer un message comme lu
app.put('/api/messages/:messageId/read', async (req, res) => {
    try {
        const { messageId } = req.params;

        await messagesCollection.updateOne(
            { _id: new ObjectId(messageId) },
            { $set: { read: true, readAt: new Date() } }
        );

        res.json({ success: true });
    } catch (error) {
        console.error('Erreur marquage message:', error);
        res.status(500).json({ success: false, message: 'Erreur serveur' });
    }
});

// Récupérer les documents partagés par l'utilisateur (historique de partage)
app.get('/api/shared-documents/:userId', async (req, res) => {
    try {
        const { userId } = req.params;

        // Récupérer l'historique des partages effectués par l'utilisateur
        const sharedDocs = await shareHistoryCollection
            .find({ sharedBy: userId })
            .sort({ sharedAt: -1 })
            .limit(50) // Limiter à 50 derniers partages
            .toArray();

        // Enrichir avec les informations des rôles et départements
        const enrichedSharedDocs = await Promise.all(sharedDocs.map(async (share) => {
            const sharedByUser = await usersCollection.findOne({ username: share.sharedBy });
            const sharedWithUser = await usersCollection.findOne({ username: share.sharedWith });

            let sharedByRole = null, sharedWithRole = null;
            let sharedByDept = null, sharedWithDept = null;

            if (sharedByUser) {
                sharedByRole = await rolesCollection.findOne({ _id: sharedByUser.idRole });
                sharedByDept = await departementsCollection.findOne({ _id: sharedByUser.idDepartement });
            }

            if (sharedWithUser) {
                sharedWithRole = await rolesCollection.findOne({ _id: sharedWithUser.idRole });
                sharedWithDept = await departementsCollection.findOne({ _id: sharedWithUser.idDepartement });
            }

            return {
                ...share,
                sharedByRole: sharedByRole?.libelle || 'Inconnu',
                sharedByDept: sharedByDept?.nom || 'Inconnu',
                sharedWithRole: sharedWithRole?.libelle || 'Inconnu',
                sharedWithDept: sharedWithDept?.nom || 'Inconnu'
            };
        }));

        res.json({ success: true, sharedDocuments: enrichedSharedDocs });
    } catch (error) {
        console.error('Erreur récupération documents partagés:', error);
        res.status(500).json({ success: false, message: 'Erreur serveur' });
    }
});

// Compter les messages non lus
app.get('/api/messages/:userId/unread-count', async (req, res) => {
    try {
        const { userId } = req.params;

        const count = await messagesCollection.countDocuments({
            to: userId,
            read: false
        });

        res.json({ count });
    } catch (error) {
        console.error('Erreur comptage messages:', error);
        res.status(500).json({ success: false, message: 'Erreur serveur' });
    }
});

// Supprimer un message
app.delete('/api/messages/:messageId', async (req, res) => {
    try {
        const { messageId } = req.params;

        await messagesCollection.deleteOne({ _id: new ObjectId(messageId) });

        res.json({ success: true });
    } catch (error) {
        console.error('Erreur suppression message:', error);
        res.status(500).json({ success: false, message: 'Erreur serveur' });
    }
});

// Supprimer tous les messages reçus d'un utilisateur
app.delete('/api/messages/bulk/received/:userId', async (req, res) => {
    try {
        const { userId } = req.params;

        const result = await messagesCollection.deleteMany({ to: userId });

        res.json({ success: true, deletedCount: result.deletedCount });
    } catch (error) {
        console.error('Erreur suppression messages reçus:', error);
        res.status(500).json({ success: false, message: 'Erreur serveur' });
    }
});

// Supprimer tous les messages envoyés d'un utilisateur
app.delete('/api/messages/bulk/sent/:userId', async (req, res) => {
    try {
        const { userId } = req.params;

        const result = await messagesCollection.deleteMany({ from: userId });

        res.json({ success: true, deletedCount: result.deletedCount });
    } catch (error) {
        console.error('Erreur suppression messages envoyés:', error);
        res.status(500).json({ success: false, message: 'Erreur serveur' });
    }
});

// Supprimer tout l'historique de partage d'un utilisateur
app.delete('/api/shared-documents/bulk/:userId', async (req, res) => {
    try {
        const { userId } = req.params;

        const result = await shareHistoryCollection.deleteMany({ sharedBy: userId });

        res.json({ success: true, deletedCount: result.deletedCount });
    } catch (error) {
        console.error('Erreur suppression historique partages:', error);
        res.status(500).json({ success: false, message: 'Erreur serveur' });
    }
});

// ============================================
// ROUTES DEMANDES DE SUPPRESSION DE MESSAGES
// ============================================

// Créer une demande de suppression de message
app.post('/api/messages/:messageId/request-deletion', async (req, res) => {
    try {
        const { messageId } = req.params;
        const { userId, motif } = req.body;

        // Récupérer le message
        const message = await messagesCollection.findOne({ _id: new ObjectId(messageId) });
        if (!message) {
            return res.status(404).json({ success: false, message: 'Message non trouvé' });
        }

        // Récupérer les informations de l'utilisateur demandeur
        const user = await usersCollection.findOne({ username: userId });
        if (!user) {
            return res.status(404).json({ success: false, message: 'Utilisateur non trouvé' });
        }

        // Trouver un niveau 1 du même département
        const rolesNiveau1 = await rolesCollection.find({ niveau: 1 }).toArray();
        const rolesNiveau1Ids = rolesNiveau1.map(r => r._id);

        const niveau1 = await usersCollection.findOne({
            idDepartement: user.idDepartement,
            idRole: { $in: rolesNiveau1Ids }
        });

        if (!niveau1) {
            return res.status(400).json({ success: false, message: 'Aucun administrateur trouvé dans votre département' });
        }

        // Créer la demande
        const deletionRequest = {
            messageId: new ObjectId(messageId),
            messageSubject: message.subject || '(Sans sujet)',
            messageFrom: message.from,
            messageTo: message.to,
            idDemandeur: userId,
            nomDemandeur: user.nom,
            niveauDemandeur: user.roleNiveau || 2,
            motif: motif,
            dateCreation: new Date(),
            statut: 'en_attente',
            niveau1Responsable: niveau1.username
        };

        await messageDeletionRequestsCollection.insertOne(deletionRequest);

        res.json({ success: true, message: 'Demande de suppression envoyée' });
    } catch (error) {
        console.error('Erreur création demande suppression message:', error);
        res.status(500).json({ success: false, message: 'Erreur serveur' });
    }
});

// Récupérer les demandes de suppression de messages (pour niveau 1)
app.get('/api/messages/deletion-requests/:userId', async (req, res) => {
    try {
        const { userId } = req.params;

        const requests = await messageDeletionRequestsCollection.find({
            niveau1Responsable: userId,
            statut: 'en_attente'
        }).sort({ dateCreation: -1 }).toArray();

        res.json({ success: true, requests });
    } catch (error) {
        console.error('Erreur récupération demandes suppression messages:', error);
        res.status(500).json({ success: false, message: 'Erreur serveur' });
    }
});

// Approuver une demande de suppression de message
app.post('/api/messages/deletion-requests/:requestId/approve', async (req, res) => {
    try {
        const { requestId } = req.params;
        const { userId } = req.body;

        const request = await messageDeletionRequestsCollection.findOne({ _id: new ObjectId(requestId) });
        if (!request) {
            return res.status(404).json({ success: false, message: 'Demande non trouvée' });
        }

        // Supprimer le message
        await messagesCollection.deleteOne({ _id: request.messageId });

        // Mettre à jour la demande
        await messageDeletionRequestsCollection.updateOne(
            { _id: new ObjectId(requestId) },
            {
                $set: {
                    statut: 'approuvee',
                    dateTraitement: new Date(),
                    traitePar: userId
                }
            }
        );

        res.json({ success: true, message: 'Message supprimé avec succès' });
    } catch (error) {
        console.error('Erreur approbation demande suppression message:', error);
        res.status(500).json({ success: false, message: 'Erreur serveur' });
    }
});

// Rejeter une demande de suppression de message
app.post('/api/messages/deletion-requests/:requestId/reject', async (req, res) => {
    try {
        const { requestId } = req.params;
        const { userId, motifRejet } = req.body;

        await messageDeletionRequestsCollection.updateOne(
            { _id: new ObjectId(requestId) },
            {
                $set: {
                    statut: 'rejetee',
                    dateTraitement: new Date(),
                    traitePar: userId,
                    motifRejet: motifRejet || 'Non spécifié'
                }
            }
        );

        res.json({ success: true, message: 'Demande rejetée' });
    } catch (error) {
        console.error('Erreur rejet demande suppression message:', error);
        res.status(500).json({ success: false, message: 'Erreur serveur' });
    }
});

// ============================================
// ROUTES HISTORIQUE DES PARTAGES
// ============================================

// Récupérer les 15 derniers partages
app.get('/api/share-history', async (req, res) => {
    try {
        const history = await shareHistoryCollection
            .find({})
            .sort({ sharedAt: -1 })
            .limit(15)
            .toArray();

        res.json(history);
    } catch (error) {
        console.error('Erreur récupération historique partages:', error);
        res.status(500).json({ success: false, message: 'Erreur serveur' });
    }
});

// Récupérer les 15 derniers partages pour un utilisateur spécifique
app.get('/api/share-history/:userId', async (req, res) => {
    try {
        const { userId } = req.params;

        const history = await shareHistoryCollection
            .find({
                $or: [
                    { sharedBy: userId },
                    { sharedWith: userId }
                ]
            })
            .sort({ sharedAt: -1 })
            .limit(15)
            .toArray();

        res.json(history);
    } catch (error) {
        console.error('Erreur récupération historique partages utilisateur:', error);
        res.status(500).json({ success: false, message: 'Erreur serveur' });
    }
});

// ============================================
// ROUTES POUR ROLES, DEPARTEMENTS, SERVICES, CATEGORIES
// ============================================

// Récupérer tous les rôles
app.get('/api/roles', async (req, res) => {
    try {
        const roles = await rolesCollection.find({}).sort({ niveau: 1 }).toArray();
        res.json({ success: true, roles });
    } catch (error) {
        console.error('Erreur récupération rôles:', error);
        res.status(500).json({ success: false, message: 'Erreur serveur' });
    }
});

// Récupérer tous les départements (avec filtrage pour Niveau 1)
app.get('/api/departements', async (req, res) => {
    try {
        const { ObjectId } = require('mongodb');
        let departements = [];

        // Vérifier si l'utilisateur est connecté
        if (req.session && req.session.userId) {
            const currentUser = await usersCollection.findOne({ username: req.session.userId });

            if (currentUser) {
                // Récupérer le rôle de l'utilisateur
                const roleId = typeof currentUser.idRole === 'string'
                    ? new ObjectId(currentUser.idRole)
                    : currentUser.idRole;

                const currentUserRole = await rolesCollection.findOne({ _id: roleId });

                console.log(`🔍 /api/departements - User: ${req.session.userId}, Role: ${currentUserRole?.nom}, Niveau: ${currentUserRole?.niveau}`);

                // 🔒 Si niveau 1, ne montrer QUE son département
                if (currentUserRole && currentUserRole.niveau == 1) {
                    if (currentUser.idDepartement) {
                        const deptId = typeof currentUser.idDepartement === 'string'
                            ? new ObjectId(currentUser.idDepartement)
                            : currentUser.idDepartement;

                        // Récupérer UNIQUEMENT le département du niveau 1
                        const userDept = await departementsCollection.findOne({ _id: deptId });
                        departements = userDept ? [userDept] : [];

                        console.log(`🔒 NIVEAU 1 - Département filtré: ${userDept?.nom || 'Aucun'}`);
                    } else {
                        console.log(`🔴 NIVEAU 1 SANS DÉPARTEMENT - Retour liste vide`);
                        return res.json({ success: true, departements: [] });
                    }
                } else {
                    // Niveau 0 ou autre: accès à tous les départements
                    console.log(`✅ Niveau ${currentUserRole?.niveau || 'inconnu'} - Accès à tous les départements`);
                    departements = await departementsCollection.find({}).sort({ nom: 1 }).toArray();
                }
            } else {
                return res.json({ success: true, departements: [] });
            }
        } else {
            // Pas de session: retourner liste vide
            return res.json({ success: true, departements: [] });
        }

        console.log(`📊 /api/departements - ${departements.length} département(s) retourné(s) pour ${req.session.userId}`);
        res.json({ success: true, departements });
    } catch (error) {
        console.error('Erreur récupération départements:', error);
        res.status(500).json({ success: false, message: 'Erreur serveur' });
    }
});

// Récupérer tous les services (avec filtrage pour Niveau 1)
app.get('/api/services', async (req, res) => {
    try {
        const { ObjectId } = require('mongodb');
        let services = [];

        // Vérifier si l'utilisateur est connecté
        if (req.session && req.session.userId) {
            const currentUser = await usersCollection.findOne({ username: req.session.userId });

            if (currentUser) {
                // Récupérer le rôle de l'utilisateur
                const roleId = typeof currentUser.idRole === 'string'
                    ? new ObjectId(currentUser.idRole)
                    : currentUser.idRole;

                const currentUserRole = await rolesCollection.findOne({ _id: roleId });

                console.log(`🔍 /api/services - User: ${req.session.userId}, Role: ${currentUserRole?.nom}, Niveau: ${currentUserRole?.niveau}`);

                // 🔒 Si niveau 1, ne montrer QUE les services de son département
                if (currentUserRole && currentUserRole.niveau == 1) {
                    if (currentUser.idDepartement) {
                        const deptId = typeof currentUser.idDepartement === 'string'
                            ? new ObjectId(currentUser.idDepartement)
                            : currentUser.idDepartement;

                        // Récupérer UNIQUEMENT les services du département du niveau 1
                        services = await servicesCollection.find({ idDepartement: deptId }).sort({ nom: 1 }).toArray();

                        console.log(`🔒 NIVEAU 1 - ${services.length} service(s) du département filtré(s)`);
                    } else {
                        console.log(`🔴 NIVEAU 1 SANS DÉPARTEMENT - Retour liste vide`);
                        return res.json({ success: true, services: [] });
                    }
                } else {
                    // Niveau 0 ou autre: accès à tous les services
                    console.log(`✅ Niveau ${currentUserRole?.niveau || 'inconnu'} - Accès à tous les services`);
                    services = await servicesCollection.find({}).sort({ nom: 1 }).toArray();
                }
            } else {
                return res.json({ success: true, services: [] });
            }
        } else {
            // Pas de session: retourner liste vide
            return res.json({ success: true, services: [] });
        }

        console.log(`📊 /api/services - ${services.length} service(s) retourné(s) pour ${req.session.userId}`);
        res.json({ success: true, services });
    } catch (error) {
        console.error('Erreur récupération services:', error);
        res.status(500).json({ success: false, message: 'Erreur serveur' });
    }
});

// Créer un service
app.post('/api/services', async (req, res) => {
    try {
        const { nom, code, idDepartement } = req.body;

        if (!nom || !code || !idDepartement) {
            return res.status(400).json({
                success: false,
                message: 'Nom, code et département requis'
            });
        }

        // Vérifier que le code n'existe pas déjà
        const existing = await servicesCollection.findOne({ code });
        if (existing) {
            return res.status(400).json({
                success: false,
                message: 'Ce code de service existe déjà'
            });
        }

        const newService = {
            _id: new ObjectId(),
            nom,
            code,
            description: req.body.description || '',
            idDepartement: new ObjectId(idDepartement),
            dateCreation: new Date()
        };

        await servicesCollection.insertOne(newService);

        console.log(`✅ Service créé: ${nom} (${code})`);
        res.json({ success: true, service: newService });
    } catch (error) {
        console.error('Erreur création service:', error);
        res.status(500).json({ success: false, message: 'Erreur serveur' });
    }
});

// Modifier un service
app.put('/api/services/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { nom, code, description } = req.body;

        if (!nom || !code) {
            return res.status(400).json({
                success: false,
                message: 'Nom et code requis'
            });
        }

        // Vérifier que le service existe
        const service = await servicesCollection.findOne({ _id: new ObjectId(id) });
        if (!service) {
            return res.status(404).json({
                success: false,
                message: 'Service non trouvé'
            });
        }

        // Si on change le code, vérifier qu'il n'existe pas déjà
        if (code !== service.code) {
            const existing = await servicesCollection.findOne({ code });
            if (existing) {
                return res.status(400).json({
                    success: false,
                    message: 'Ce code de service existe déjà'
                });
            }
        }

        // Mettre à jour
        const updateData = {
            nom,
            code,
            description: description || service.description || '',
            lastModified: new Date()
        };

        await servicesCollection.updateOne(
            { _id: new ObjectId(id) },
            { $set: updateData }
        );

        console.log(`✅ Service modifié: ${nom}`);
        res.json({ success: true, service: { ...service, ...updateData } });
    } catch (error) {
        console.error('Erreur modification service:', error);
        res.status(500).json({ success: false, message: 'Erreur serveur' });
    }
});

// Supprimer un service
app.delete('/api/services/:id', async (req, res) => {
    try {
        const { id } = req.params;

        // Vérifier que le service existe
        const service = await servicesCollection.findOne({ _id: new ObjectId(id) });
        if (!service) {
            return res.status(404).json({
                success: false,
                message: 'Service non trouvé'
            });
        }

        // Vérifier qu'il n'y a pas d'utilisateurs affectés
        const userCount = await usersCollection.countDocuments({ idService: new ObjectId(id) });
        if (userCount > 0) {
            return res.status(400).json({
                success: false,
                message: `Impossible de supprimer : ${userCount} utilisateur(s) sont affectés à ce service`
            });
        }

        // Vérifier qu'il n'y a pas de documents
        const docCount = await documentsCollection.countDocuments({ idService: new ObjectId(id) });
        if (docCount > 0) {
            return res.status(400).json({
                success: false,
                message: `Impossible de supprimer : ${docCount} document(s) sont associés à ce service`
            });
        }

        // Supprimer
        await servicesCollection.deleteOne({ _id: new ObjectId(id) });

        console.log(`✅ Service supprimé: ${service.nom}`);
        res.json({ success: true, message: 'Service supprimé' });
    } catch (error) {
        console.error('Erreur suppression service:', error);
        res.status(500).json({ success: false, message: 'Erreur serveur' });
    }
});

// Récupérer les catégories d'un utilisateur
app.get('/api/categories/:userId', async (req, res) => {
    try {
        const { userId } = req.params;

        const user = await usersCollection.findOne({ username: userId });
        if (!user) {
            return res.status(404).json({ success: false, message: 'Utilisateur non trouvé' });
        }

        // 🔄 NOUVEAU: Catégories partagées au niveau du DÉPARTEMENT
        // Récupérer tous les utilisateurs du même département
        const deptUsers = await usersCollection.find({
            idDepartement: user.idDepartement
        }).toArray();

        const deptUsernames = deptUsers.map(u => u.username);

        // Récupérer TOUTES les catégories créées par n'importe quel utilisateur du département
        const categories = await categoriesCollection
            .find({ idUtilisateur: { $in: deptUsernames } })
            .sort({ nom: 1 })
            .toArray();

        res.json(categories);
    } catch (error) {
        console.error('Erreur récupération catégories:', error);
        res.status(500).json({ success: false, message: 'Erreur serveur' });
    }
});

// Créer une nouvelle catégorie
app.post('/api/categories', async (req, res) => {
    try {
        const { userId, id, nom, couleur, icon } = req.body;

        if (!userId || !id || !nom) {
            return res.status(400).json({
                success: false,
                message: 'userId, id et nom sont obligatoires'
            });
        }

        const user = await usersCollection.findOne({ username: userId });
        if (!user) {
            return res.status(404).json({ success: false, message: 'Utilisateur non trouvé' });
        }

        // 🔒 VÉRIFIER QUE L'UTILISATEUR EST NIVEAU 1
        const userRole = await rolesCollection.findOne({ _id: user.idRole });
        if (!userRole || userRole.niveau !== 1) {
            return res.status(403).json({
                success: false,
                message: 'Seuls les utilisateurs niveau 1 peuvent créer des catégories'
            });
        }

        // Vérifier si la catégorie existe déjà dans le département
        const deptUsers = await usersCollection.find({
            idDepartement: user.idDepartement
        }).toArray();
        const deptUsernames = deptUsers.map(u => u.username);

        const existingCategory = await categoriesCollection.findOne({
            idUtilisateur: { $in: deptUsernames },
            id
        });

        if (existingCategory) {
            return res.status(400).json({
                success: false,
                message: 'Cette catégorie existe déjà dans le département'
            });
        }

        // Créer la nouvelle catégorie
        const newCategory = {
            _id: new ObjectId(),
            idUtilisateur: userId,
            idDepartement: user.idDepartement, // ✅ Lier au département
            id,
            nom,
            couleur: couleur || '#3b82f6',
            icon: icon || '📁',
            dateCreation: new Date()
        };

        await categoriesCollection.insertOne(newCategory);

        console.log(`✅ Catégorie créée: ${nom} pour département ${user.idDepartement}`);
        res.json({ success: true, category: newCategory });
    } catch (error) {
        console.error('Erreur création catégorie:', error);
        res.status(500).json({ success: false, message: 'Erreur serveur' });
    }
});

// Modifier une catégorie
app.put('/api/categories/:userId/:catId', async (req, res) => {
    try {
        const { userId, catId } = req.params;
        const { nom, couleur, icon } = req.body;

        const user = await usersCollection.findOne({ username: userId });
        if (!user) {
            return res.status(404).json({ success: false, message: 'Utilisateur non trouvé' });
        }

        // 🔒 VÉRIFIER QUE L'UTILISATEUR EST NIVEAU 1
        const userRole = await rolesCollection.findOne({ _id: user.idRole });
        if (!userRole || userRole.niveau !== 1) {
            return res.status(403).json({
                success: false,
                message: 'Seuls les utilisateurs niveau 1 peuvent modifier des catégories'
            });
        }

        // Trouver la catégorie dans le département
        const deptUsers = await usersCollection.find({
            idDepartement: user.idDepartement
        }).toArray();
        const deptUsernames = deptUsers.map(u => u.username);

        const result = await categoriesCollection.updateOne(
            {
                idUtilisateur: { $in: deptUsernames },
                id: catId
            },
            {
                $set: {
                    nom,
                    couleur: couleur || '#3b82f6',
                    icon: icon || '📁',
                    dateModification: new Date()
                }
            }
        );

        if (result.modifiedCount === 0) {
            return res.status(404).json({
                success: false,
                message: 'Catégorie non trouvée dans le département'
            });
        }

        console.log(`✅ Catégorie modifiée: ${catId}`);
        res.json({ success: true, message: 'Catégorie modifiée' });
    } catch (error) {
        console.error('Erreur modification catégorie:', error);
        res.status(500).json({ success: false, message: 'Erreur serveur' });
    }
});

// Supprimer une catégorie
app.delete('/api/categories/:userId/:catId', async (req, res) => {
    try {
        const { userId, catId } = req.params;

        const user = await usersCollection.findOne({ username: userId });
        if (!user) {
            return res.status(404).json({ success: false, message: 'Utilisateur non trouvé' });
        }

        // 🔒 VÉRIFIER QUE L'UTILISATEUR EST NIVEAU 1
        const userRole = await rolesCollection.findOne({ _id: user.idRole });
        if (!userRole || userRole.niveau !== 1) {
            return res.status(403).json({
                success: false,
                message: 'Seuls les utilisateurs niveau 1 peuvent supprimer des catégories'
            });
        }

        // Récupérer tous les utilisateurs du département
        const deptUsers = await usersCollection.find({
            idDepartement: user.idDepartement
        }).toArray();
        const deptUsernames = deptUsers.map(u => u.username);

        // Vérifier si des documents du département utilisent cette catégorie
        const documentsWithCategory = await documentsCollection.countDocuments({
            idUtilisateur: { $in: deptUsernames },
            categorie: catId
        });

        if (documentsWithCategory > 0) {
            return res.status(400).json({
                success: false,
                message: `Impossible de supprimer : ${documentsWithCategory} document(s) du département utilisent cette catégorie`
            });
        }

        // Supprimer la catégorie (n'importe qui du département peut l'avoir créée)
        const result = await categoriesCollection.deleteOne({
            idUtilisateur: { $in: deptUsernames },
            id: catId
        });

        if (result.deletedCount === 0) {
            return res.status(404).json({
                success: false,
                message: 'Catégorie non trouvée dans le département'
            });
        }

        console.log(`✅ Catégorie supprimée: ${catId} du département ${user.idDepartement}`);
        res.json({ success: true, message: 'Catégorie supprimée' });
    } catch (error) {
        console.error('Erreur suppression catégorie:', error);
        res.status(500).json({ success: false, message: 'Erreur serveur' });
    }
});

// ============================================
// ROUTE POUR SERVIR LES FICHIERS OFFICE (Visualiseur)
// ============================================
app.get('/api/office-file/:userId/:docId', async (req, res) => {
    try {
        const { userId, docId } = req.params;

        // Vérifier les permissions
        const canAccess = await canAccessDocument(userId, docId);
        if (!canAccess) {
            return res.status(403).send('Accès refusé à ce document');
        }

        // Récupérer le document
        const document = await documentsCollection.findOne({
            _id: new ObjectId(docId)
        });

        if (!document) {
            return res.status(404).send('Document non trouvé');
        }

        // Extraire le contenu base64
        const base64Data = document.contenu.split(',')[1] || document.contenu;
        const fileBuffer = Buffer.from(base64Data, 'base64');

        // Définir le Content-Type selon le type de fichier
        let contentType = document.type;
        const extension = document.nomFichier.split('.').pop().toLowerCase();

        // Mapper les extensions aux Content-Types corrects
        const contentTypeMap = {
            'doc': 'application/msword',
            'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'xls': 'application/vnd.ms-excel',
            'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'ppt': 'application/vnd.ms-powerpoint',
            'pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
            'pdf': 'application/pdf'
        };

        if (contentTypeMap[extension]) {
            contentType = contentTypeMap[extension];
        }

        // Définir les en-têtes pour permettre le téléchargement ou la visualisation
        res.setHeader('Content-Type', contentType);
        res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(document.nomFichier)}"`);
        res.setHeader('Content-Length', fileBuffer.length);
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('X-Content-Type-Options', 'nosniff');

        res.send(fileBuffer);

        console.log(`📄 Fichier Office servi: ${document.nomFichier} pour ${userId}`);

    } catch (error) {
        console.error('Erreur lors du service du fichier Office:', error);
        res.status(500).send('Erreur serveur');
    }
});

// ============================================
// ÉDITION DE FICHIERS OFFICE
// ============================================

// Route pour créer un rapport Excel depuis des données
app.post('/api/office/create-excel', async (req, res) => {
    try {
        const { data, fileName, sheetName, headers } = req.body;

        if (!data || !Array.isArray(data)) {
            return res.status(400).json({
                success: false,
                message: 'Données invalides'
            });
        }

        // Créer le fichier dans temp
        const tempDir = path.join(__dirname, 'temp');
        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true });
        }

        const outputPath = path.join(tempDir, fileName || `rapport-${Date.now()}.xlsx`);

        await OfficeEditor.createExcel(outputPath, data, {
            sheetName: sheetName || 'Données',
            headers
        });

        // Lire le fichier créé
        const fileBuffer = fs.readFileSync(outputPath);
        const base64Content = fileBuffer.toString('base64');

        // Nettoyer le fichier temporaire
        fs.unlinkSync(outputPath);

        res.json({
            success: true,
            fileName: fileName || `rapport-${Date.now()}.xlsx`,
            content: base64Content,
            size: fileBuffer.length
        });

    } catch (error) {
        console.error('Erreur création Excel:', error);
        res.status(500).json({
            success: false,
            message: 'Erreur lors de la création du fichier Excel'
        });
    }
});

// Route pour éditer un fichier Excel existant
app.post('/api/office/edit-excel/:docId', async (req, res) => {
    try {
        const { docId } = req.params;
        const { cellUpdates } = req.body;

        if (!cellUpdates || typeof cellUpdates !== 'object') {
            return res.status(400).json({
                success: false,
                message: 'Mises à jour invalides'
            });
        }

        // Récupérer le document
        const document = await documentsCollection.findOne({ _id: new ObjectId(docId) });
        if (!document) {
            return res.status(404).json({
                success: false,
                message: 'Document non trouvé'
            });
        }

        // Créer un fichier temporaire depuis le contenu base64
        const tempDir = path.join(__dirname, 'temp');
        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true });
        }

        const inputPath = path.join(tempDir, `${docId}-input.xlsx`);
        const outputPath = path.join(tempDir, `${docId}-output.xlsx`);

        const buffer = Buffer.from(document.contenu, 'base64');
        fs.writeFileSync(inputPath, buffer);

        // Éditer le fichier
        await OfficeEditor.editExcel(inputPath, outputPath, cellUpdates);

        // Lire le fichier modifié
        const editedBuffer = fs.readFileSync(outputPath);
        const base64Content = editedBuffer.toString('base64');

        // Mettre à jour le document dans la base de données
        await documentsCollection.updateOne(
            { _id: new ObjectId(docId) },
            {
                $set: {
                    contenu: base64Content,
                    taille: editedBuffer.length,
                    dateModification: new Date()
                }
            }
        );

        // Nettoyer les fichiers temporaires
        fs.unlinkSync(inputPath);
        fs.unlinkSync(outputPath);

        res.json({
            success: true,
            message: 'Document Excel modifié avec succès'
        });

    } catch (error) {
        console.error('Erreur édition Excel:', error);
        res.status(500).json({
            success: false,
            message: 'Erreur lors de l\'édition du fichier Excel'
        });
    }
});

// Route pour lire le contenu d'un fichier Excel
app.get('/api/office/read-excel/:docId', async (req, res) => {
    try {
        const { docId } = req.params;

        // Récupérer le document
        const document = await documentsCollection.findOne({ _id: new ObjectId(docId) });
        if (!document) {
            return res.status(404).json({
                success: false,
                message: 'Document non trouvé'
            });
        }

        // Créer un fichier temporaire
        const tempDir = path.join(__dirname, 'temp');
        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true });
        }

        const tempPath = path.join(tempDir, `${docId}.xlsx`);
        const buffer = Buffer.from(document.contenu, 'base64');
        fs.writeFileSync(tempPath, buffer);

        // Lire les données
        const data = await OfficeEditor.readExcel(tempPath);

        // Nettoyer
        fs.unlinkSync(tempPath);

        res.json({
            success: true,
            data,
            rows: data.length
        });

    } catch (error) {
        console.error('Erreur lecture Excel:', error);
        res.status(500).json({
            success: false,
            message: 'Erreur lors de la lecture du fichier Excel'
        });
    }
});

// Route pour obtenir les informations d'un fichier Office
app.get('/api/office/info/:docId', async (req, res) => {
    try {
        const { docId } = req.params;

        // Récupérer le document
        const document = await documentsCollection.findOne({ _id: new ObjectId(docId) });
        if (!document) {
            return res.status(404).json({
                success: false,
                message: 'Document non trouvé'
            });
        }

        const info = {
            name: document.nomFichier,
            size: document.taille,
            sizeKB: (document.taille / 1024).toFixed(2),
            sizeMB: (document.taille / (1024 * 1024)).toFixed(2),
            extension: path.extname(document.nomFichier),
            type: OfficeEditor.getFileType(path.extname(document.nomFichier)),
            created: document.dateAjout,
            modified: document.dateModification || document.dateAjout
        };

        res.json({
            success: true,
            info
        });

    } catch (error) {
        console.error('Erreur récupération info:', error);
        res.status(500).json({
            success: false,
            message: 'Erreur lors de la récupération des informations'
        });
    }
});

// ============================================
// ROUTES ONLYOFFICE
// ============================================

// Route callback OnlyOffice pour sauvegarder les modifications
app.post('/api/onlyoffice/callback/:docId', async (req, res) => {
    try {
        const { docId } = req.params;
        const callbackData = req.body;

        console.log('📝 OnlyOffice callback reçu pour:', docId);
        console.log('Status:', callbackData.status);

        // Statuts OnlyOffice:
        // 0 - Document non trouvé
        // 1 - Document en cours d'édition
        // 2 - Document prêt à être sauvegardé
        // 3 - Erreur de sauvegarde
        // 4 - Document fermé sans modifications
        // 6 - Document en cours d'édition, sauvegarde requise
        // 7 - Erreur de conversion

        // Sauvegarder uniquement si le document est prêt (status 2 ou 6)
        if (callbackData.status === 2 || callbackData.status === 6) {
            console.log('💾 Sauvegarde du document depuis OnlyOffice...');

            // Télécharger le fichier modifié depuis OnlyOffice (avec fetch natif)
            const response = await fetch(callbackData.url);
            const arrayBuffer = await response.arrayBuffer();

            const fileBuffer = Buffer.from(arrayBuffer);
            const base64Content = fileBuffer.toString('base64');

            // Mettre à jour le document dans MongoDB
            const result = await documentsCollection.updateOne(
                { _id: new ObjectId(docId) },
                {
                    $set: {
                        contenu: base64Content,
                        taille: fileBuffer.length,
                        dateModification: new Date()
                    }
                }
            );

            if (result.modifiedCount > 0) {
                console.log('✅ Document sauvegardé avec succès dans MongoDB');
            } else {
                console.warn('⚠️ Document non trouvé ou non modifié');
            }
        }

        // OnlyOffice attend toujours une réponse avec error: 0
        res.json({ error: 0 });

    } catch (error) {
        console.error('❌ Erreur callback OnlyOffice:', error);
        // Même en cas d'erreur, renvoyer error: 0 pour ne pas bloquer OnlyOffice
        res.json({ error: 0 });
    }
});

// ============================================
// GESTIONNAIRES D'ERREURS (À LA FIN, APRÈS TOUTES LES ROUTES)
// ============================================

// ✅ SÉCURITÉ: Logger les erreurs
app.use(security.errorLogger);

// ✅ SÉCURITÉ: Gestionnaire d'erreurs global
app.use(security.errorHandler);

// Note: Le catch-all app.get('*') est maintenant dans connectDB()
// pour être enregistré APRÈS les routes Super Admin

// ============================================
// DÉMARRAGE
// ============================================
connectDB().then(() => {
    app.listen(PORT, '0.0.0.0', () => {
        console.log('\n' + '='.repeat(60));
        console.log('✅ SERVEUR ARCHIVAGE C.E.R.E.R DÉMARRÉ (MCD)');
        console.log('='.repeat(60));
        console.log(`\n🔡 http://localhost:${PORT}`);
        console.log('\n' + '='.repeat(60) + '\n');
    });
});

process.on('SIGINT', () => {
    console.log('\n👋 Arrêt du serveur...');
    process.exit(0);
});
