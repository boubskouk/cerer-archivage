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

const app = express();

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
let deletionRequestsCollection;
let messagesCollection;
let messageDeletionRequestsCollection;
let shareHistoryCollection;

// ============================================
// MIDDLEWARE
// ============================================

// ✅ SÉCURITÉ: Headers de sécurité avec Helmet
app.use(security.helmetConfig);

// ✅ SÉCURITÉ: Compression des réponses
app.use(security.compressionConfig);

// CORS et parsing
app.use(cors());
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ limit: '100mb', extended: true }));

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
    const document = await documentsCollection.findOne({ _id: new ObjectId(documentId) });

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

    // ✅ NIVEAU 1 : Voit TOUS les documents de TOUS les départements
    if (userRole.niveau === 1) {
        const allDocs = await documentsCollection.find({}).toArray();
        accessibleDocs = allDocs;
        console.log(`✅ NIVEAU 1: Accès à TOUS les documents (${accessibleDocs.length})`);
        return accessibleDocs;
    }

    // ✅ NIVEAU 2 : Voit TOUS les documents de son département
    if (userRole.niveau === 2) {
        // Vérifier que l'utilisateur a un département
        if (!user.idDepartement) {
            console.log(`⚠️ Utilisateur niveau 2 sans département: Aucun document accessible`);
            return [];
        }

        // Tous les documents du même département
        const deptDocs = await documentsCollection.find({
            idDepartement: user.idDepartement
        }).toArray();

        // + Documents partagés avec lui depuis d'autres départements
        const sharedDocs = await documentsCollection.find({
            sharedWith: userId,
            idDepartement: { $ne: user.idDepartement }
        }).toArray();

        accessibleDocs = [...deptDocs, ...sharedDocs];
        console.log(`✅ NIVEAU 2: Accès à TOUS les documents du département (${deptDocs.length}) + partagés (${sharedDocs.length})`);
        return accessibleDocs;
    }

    // ✅ NIVEAU 3 : Voit uniquement ses documents + documents des autres niveau 3 du département + documents partagés
    if (userRole.niveau === 3) {
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
            idUtilisateur: { $in: niveau3Usernames }
        }).toArray();

        // + Documents partagés avec lui (de n'importe quel département)
        const sharedDocs = await documentsCollection.find({
            sharedWith: userId
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
        deletionRequestsCollection = db.collection('deletionRequests');
        messagesCollection = db.collection('messages');
        messageDeletionRequestsCollection = db.collection('messageDeletionRequests');
        shareHistoryCollection = db.collection('shareHistory');

        // Créer des index
        await documentsCollection.createIndex({ idUtilisateur: 1, dateAjout: -1 });
        await documentsCollection.createIndex({ idDepartement: 1 });
        await usersCollection.createIndex({ username: 1 }, { unique: true });
        await usersCollection.createIndex({ email: 1 }, { unique: true }); // ✅ Email unique

        console.log('✅ Connexion à MongoDB réussie');
        console.log(`📊 Base de données: ${DB_NAME}`);

        // ✅ SÉCURITÉ: Configuration des sessions sécurisées avec MongoDB
        app.use(session({
            secret: process.env.SESSION_SECRET || 'changez_ce_secret_en_production',
            resave: false,
            saveUninitialized: false,
            rolling: true, // Renouvelle le cookie à chaque requête
            store: MongoStore.create({
                client: client,
                dbName: DB_NAME,
                collectionName: 'sessions',
                ttl: 3600, // TTL court de 1 heure dans MongoDB
                crypto: {
                    secret: process.env.SESSION_CRYPTO_SECRET || 'changez_ce_secret_aussi'
                },
                touchAfter: 60 // Mise à jour toutes les 60 secondes si activité
            }),
            cookie: {
                secure: process.env.NODE_ENV === 'production', // HTTPS uniquement en production
                httpOnly: true, // Pas accessible en JavaScript côté client
                // Ne pas définir maxAge pour faire un cookie de session
                sameSite: 'strict' // Protection CSRF
            },
            name: 'sessionId' // Cacher que c'est Express
        }));
        console.log('✅ Sessions sécurisées configurées avec MongoDB');

        await initializeDefaultData();

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
    
    // 4. CATÉGORIES pour chaque utilisateur
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

        // Si c'est la première connexion, marquer comme non-première
        if (isFirstLogin) {
            await usersCollection.updateOne(
                { _id: user._id },
                { $set: { firstLogin: false, datePremiereConnexion: new Date() } }
            );
            console.log(`🎉 Première connexion de ${username}`);
        }

        // ✅ SÉCURITÉ: Logger la connexion réussie
        security.logLoginSuccess(username, req.ip, req.headers['user-agent']);

        res.json({
            success: true,
            username,
            firstLogin: isFirstLogin, // ✅ NOUVEAU: Indiquer si c'est la première connexion
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
        console.error('Erreur login:', error);
        res.status(500).json({ success: false, message: 'Erreur serveur' });
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
        const isNiveau1 = selectedRole.niveau === 1;

        // Pour les utilisateurs de niveau 1, pas de département
        if (!isNiveau1 && !deptId) {
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

        // Ajouter le département seulement si ce n'est pas un niveau 1
        if (!isNiveau1 && deptId) {
            newUser.idDepartement = new ObjectId(deptId);
        } else {
            newUser.idDepartement = null; // Niveau 1 : pas de département
        }

        await usersCollection.insertOne(newUser);

        // Créer les catégories par défaut
        const defaultCategories = [
            { id: 'factures', nom: 'Factures', couleur: 'bg-blue-100 text-blue-800', icon: '🧾' },
            { id: 'contrats', nom: 'Contrats', couleur: 'bg-purple-100 text-purple-800', icon: '📜' },
            { id: 'fiscalite', nom: 'Fiscalité', couleur: 'bg-green-100 text-green-800', icon: '💰' },
            { id: 'autre', nom: 'Autre', couleur: 'bg-gray-100 text-gray-800', icon: '📄' }
        ];

        for (const cat of defaultCategories) {
            await categoriesCollection.insertOne({ idUtilisateur: username, ...cat });
        }

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

        const user = await usersCollection.findOne({ username });
        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'Utilisateur non trouvé'
            });
        }

        const role = await rolesCollection.findOne({ _id: user.idRole });
        const departement = user.idDepartement ? await departementsCollection.findOne({ _id: user.idDepartement }) : null;

        res.json({
            success: true,
            user: {
                username: user.username,
                nom: user.nom,
                email: user.email,
                role: role.libelle,
                roleNiveau: role.niveau,
                departement: departement ? departement.nom : 'Aucun (Admin Principal)',
                idRole: user.idRole,
                idDepartement: user.idDepartement
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

        // Supprimer tous les documents de l'utilisateur
        await documentsCollection.deleteMany({ idUtilisateur: username });

        // Supprimer toutes les catégories de l'utilisateur
        await categoriesCollection.deleteMany({ idUtilisateur: username });

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

        // Déterminer le département d'archivage (celui sélectionné ou celui de l'utilisateur par défaut)
        const idDeptArchivage = departementArchivage || user.idDepartement;
        const deptArchivage = idDeptArchivage ? await departementsCollection.findOne({ _id: new ObjectId(idDeptArchivage) }) : null;

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
            // ✅ Département d'archivage
            departementArchivage: deptArchivage ? deptArchivage.nom : null,
            idDepartementArchivage: idDeptArchivage,
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
            locked: locked === true && role && role.niveau === 1 ? true : false,
            lockedBy: locked === true && role && role.niveau === 1 ? {
                utilisateur: userId,
                nomComplet: user.nom,
                email: user.email,
                date: new Date()
            } : null
        };
        
        const result = await documentsCollection.insertOne(document);
        
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
            _id: new ObjectId(docId)
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
        const document = await documentsCollection.findOne({ _id: new ObjectId(docId) });
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

        // Vérifier le rôle de l'utilisateur pour voir si c'est un niveau 1
        const userRole = await rolesCollection.findOne({ _id: user.idRole });
        const isNiveau1 = userRole && userRole.niveau === 1;

        // Admin niveau 1 a accès à tout
        const sameDepartment = isNiveau1 || (
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

// Récupérer tous les utilisateurs
app.get('/api/users', async (req, res) => {
    try {
        const allUsers = await usersCollection.find({}).toArray();

        // Enrichir avec les informations du rôle et département
        const usersWithInfo = await Promise.all(allUsers.map(async (user) => {
            const role = await rolesCollection.findOne({ _id: user.idRole });
            const dept = user.idDepartement ? await departementsCollection.findOne({ _id: user.idDepartement }) : null;
            return {
                username: user.username,
                nom: user.nom,
                email: user.email,
                role: role ? role.libelle : 'Non défini',
                niveau: role ? role.niveau : null,
                departement: dept ? dept.nom : 'Aucun (Admin Principal)',
                idRole: user.idRole,
                idDepartement: user.idDepartement
            };
        }));

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

        // Récupérer tous les utilisateurs sauf l'utilisateur actuel
        const allUsers = await usersCollection.find({
            username: { $ne: userId }
        }).toArray();

        // Enrichir avec les informations du rôle et département
        const usersWithInfo = await Promise.all(allUsers.map(async (user) => {
            const role = await rolesCollection.findOne({ _id: user.idRole });
            const dept = user.idDepartement ? await departementsCollection.findOne({ _id: user.idDepartement }) : null;
            return {
                username: user.username,
                nom: user.nom,
                email: user.email,
                role: role ? role.libelle : 'Non défini',
                niveau: role ? role.niveau : 0,
                departement: dept ? dept.nom : 'Aucun'
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

        if (userRole.niveau === 1) {
            // ✅ NIVEAU 1 : Supprimer TOUS les documents de TOUS les départements
            query = {};  // Pas de filtre = tous les documents
            console.log('📋 Suppression niveau 1 (ADMIN) - TOUS les documents du système');
        } else if (userRole.niveau === 2) {
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
app.delete('/api/documents/:userId/:docId', async (req, res) => {
    try {
        const { userId, docId } = req.params;

        const canAccess = await canAccessDocument(userId, docId);
        if (!canAccess) {
            return res.status(403).json({
                success: false,
                message: 'Accès refusé'
            });
        }

        // Vérifier le niveau de l'utilisateur
        const user = await usersCollection.findOne({ username: userId });
        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'Utilisateur non trouvé'
            });
        }

        const userRole = await rolesCollection.findOne({ _id: user.idRole });

        // ✅ NOUVEAU: Si niveau 3 uniquement, créer une demande de suppression (niveau 2 n'a plus accès)
        if (userRole.niveau === 3) {
            const document = await documentsCollection.findOne({ _id: new ObjectId(docId) });

            // Vérifier si une demande existe déjà pour ce document
            const existingRequest = await deletionRequestsCollection.findOne({
                idDocument: new ObjectId(docId),
                statut: 'en_attente'
            });

            if (existingRequest) {
                return res.json({
                    success: false,
                    requiresApproval: true,
                    message: 'Une demande de suppression est déjà en attente pour ce document',
                    requestId: existingRequest._id
                });
            }

            // Créer une demande de suppression
            const request = await deletionRequestsCollection.insertOne({
                idDocument: new ObjectId(docId),
                documentTitre: document.titre,
                idDemandeur: userId,
                nomDemandeur: user.nom,
                idDepartement: user.idDepartement,
                dateCreation: new Date(),
                statut: 'en_attente',
                motif: req.body.motif || 'Non spécifié'
            });

            console.log(`📝 Demande de suppression créée: ${request.insertedId} par ${userId} pour document ${docId}`);

            // ✅ Envoyer un message aux administrateurs niveau 1 du même département
            try {
                const nivel1Users = await usersCollection.find({
                    idDepartement: user.idDepartement
                }).toArray();

                // Filtrer pour ne garder que ceux qui ont le rôle niveau 1
                for (const nivel1User of nivel1Users) {
                    const nivel1Role = await rolesCollection.findOne({ _id: nivel1User.idRole });
                    if (nivel1Role && nivel1Role.niveau === 1) {
                        // Créer un message pour chaque admin niveau 1
                        await messagesCollection.insertOne({
                            from: userId,
                            fromName: user.nom,
                            to: nivel1User.username,
                            toName: nivel1User.nom,
                            subject: `📝 Nouvelle demande de suppression - ${document.titre}`,
                            body: `Bonjour ${nivel1User.nom},\n\n${user.nom} (${userId}) a créé une demande de suppression pour le document suivant :\n\n📄 Titre: ${document.titre}\n🆔 ID Document: ${document.idDocument}\n💬 Motif: ${req.body.motif || 'Non spécifié'}\n\nVeuillez vous rendre dans la section "Demandes de suppression" pour approuver ou rejeter cette demande.\n\nMerci`,
                            type: 'deletion-request',
                            relatedData: { requestId: request.insertedId.toString(), documentId: docId },
                            read: false,
                            createdAt: new Date()
                        });
                        console.log(`📧 Message envoyé à ${nivel1User.username} pour la demande ${request.insertedId}`);
                    }
                }
            } catch (msgError) {
                console.error('⚠️ Erreur envoi messages notification:', msgError);
                // On continue même si l'envoi échoue
            }

            return res.json({
                success: false,
                requiresApproval: true,
                message: 'Demande de suppression créée. Les administrateurs niveau 1 ont été notifiés.',
                requestId: request.insertedId
            });
        }

        // Bloquer niveau 2 - ils n'ont plus accès à la suppression
        if (userRole.niveau === 2) {
            return res.status(403).json({
                success: false,
                message: 'Les utilisateurs de niveau 2 ne peuvent pas supprimer de documents'
            });
        }

        // Niveau 1: Suppression directe
        const result = await documentsCollection.deleteOne({
            _id: new ObjectId(docId)
        });

        if (result.deletedCount === 0) {
            return res.status(404).json({
                success: false,
                message: 'Document non trouvé'
            });
        }

        console.log(`🗑️ Document supprimé directement par niveau 1: ${userId}`);

        res.json({ success: true, message: 'Document supprimé avec succès' });

    } catch (error) {
        console.error('Erreur suppression document:', error);
        res.status(500).json({ success: false, message: 'Erreur serveur' });
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
// ROUTES DEMANDES DE SUPPRESSION
// ============================================

// Récupérer les demandes de suppression pour un utilisateur niveau 1
app.get('/api/deletion-requests/:userId', async (req, res) => {
    try {
        const { userId } = req.params;

        const user = await usersCollection.findOne({ username: userId });
        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'Utilisateur non trouvé'
            });
        }

        const userRole = await rolesCollection.findOne({ _id: user.idRole });

        // Vérifier si le rôle existe
        if (!userRole) {
            return res.status(404).json({
                success: false,
                message: 'Rôle utilisateur non trouvé'
            });
        }

        // Seuls les niveau 1 peuvent voir les demandes
        if (userRole.niveau !== 1) {
            return res.status(403).json({
                success: false,
                message: 'Seuls les utilisateurs de niveau 1 peuvent voir les demandes de suppression'
            });
        }

        // Récupérer les demandes du département
        const requests = await deletionRequestsCollection.find({
            idDepartement: user.idDepartement,
            statut: 'en_attente'
        }).sort({ dateCreation: -1 }).toArray();

        console.log(`📋 ${requests.length} demande(s) de suppression pour ${userId}`);

        res.json({
            success: true,
            requests
        });

    } catch (error) {
        console.error('Erreur récupération demandes:', error);
        res.status(500).json({ success: false, message: 'Erreur serveur' });
    }
});

// Approuver une demande de suppression
app.post('/api/deletion-requests/:requestId/approve', async (req, res) => {
    try {
        const { requestId } = req.params;
        const { userId } = req.body;

        const user = await usersCollection.findOne({ username: userId });
        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'Utilisateur non trouvé'
            });
        }

        const userRole = await rolesCollection.findOne({ _id: user.idRole });

        // Vérifier si le rôle existe
        if (!userRole) {
            return res.status(404).json({
                success: false,
                message: 'Rôle utilisateur non trouvé'
            });
        }

        // Seuls les niveau 1 peuvent approuver
        if (userRole.niveau !== 1) {
            return res.status(403).json({
                success: false,
                message: 'Seuls les utilisateurs de niveau 1 peuvent approuver les suppressions'
            });
        }

        const request = await deletionRequestsCollection.findOne({
            _id: new ObjectId(requestId)
        });

        if (!request) {
            return res.status(404).json({
                success: false,
                message: 'Demande non trouvée'
            });
        }

        // Vérifier que la demande est du même département
        if (!request.idDepartement.equals(user.idDepartement)) {
            return res.status(403).json({
                success: false,
                message: 'Vous ne pouvez approuver que les demandes de votre département'
            });
        }

        if (request.statut !== 'en_attente') {
            return res.status(400).json({
                success: false,
                message: 'Cette demande a déjà été traitée'
            });
        }

        // Récupérer les informations du document AVANT de le supprimer (pour la notification)
        const document = await documentsCollection.findOne({ _id: request.idDocument });

        if (!document) {
            return res.status(404).json({
                success: false,
                message: 'Document non trouvé ou déjà supprimé'
            });
        }

        // Supprimer le document
        const deleteResult = await documentsCollection.deleteOne({
            _id: request.idDocument
        });

        if (deleteResult.deletedCount === 0) {
            return res.status(404).json({
                success: false,
                message: 'Document non trouvé ou déjà supprimé'
            });
        }

        // Mettre à jour la demande
        const dateTraitement = new Date();
        await deletionRequestsCollection.updateOne(
            { _id: new ObjectId(requestId) },
            {
                $set: {
                    statut: 'approuvee',
                    idApprobateur: userId,
                    nomApprobateur: user.nom,
                    dateTraitement: dateTraitement
                }
            }
        );

        // 📧 Envoyer une notification au demandeur
        try {
            const demandeur = await usersCollection.findOne({ username: request.idDemandeur });
            const demandeurRole = demandeur ? await rolesCollection.findOne({ _id: demandeur.idRole }) : null;

            const notificationBody = `Votre demande de suppression a été approuvée.

📄 Document supprimé:
- Nom: ${document.titre}
- ID: ${document.idDocument}
- Catégorie: ${document.categorie || 'Non spécifiée'}

👤 Demandé par: ${request.nomDemandeur} (Niveau ${demandeurRole ? demandeurRole.niveau : 'N/A'})

✅ Validé par: ${user.nom} (Niveau ${userRole.niveau})
📅 Date: ${dateTraitement.toLocaleString('fr-FR')}`;

            await messagesCollection.insertOne({
                from: 'Système',
                fromName: 'Système',
                to: request.idDemandeur,
                toName: request.nomDemandeur,
                subject: '✅ Demande de suppression approuvée',
                body: notificationBody,
                type: 'deletion-approved',
                relatedData: {
                    requestId: requestId,
                    documentId: document.idDocument,
                    documentTitle: document.titre
                },
                read: false,
                createdAt: dateTraitement
            });

            console.log(`📧 Notification d'approbation envoyée à ${request.idDemandeur}`);
        } catch (notifError) {
            console.error('⚠️ Erreur envoi notification approbation:', notifError);
            // On continue même si la notification échoue
        }

        console.log(`✅ Demande approuvée: ${requestId} par ${userId} - Document ${request.idDocument} supprimé`);

        res.json({
            success: true,
            message: 'Document supprimé avec succès'
        });

    } catch (error) {
        console.error('Erreur approbation demande:', error);
        res.status(500).json({ success: false, message: 'Erreur serveur' });
    }
});

// Rejeter une demande de suppression
app.post('/api/deletion-requests/:requestId/reject', async (req, res) => {
    try {
        const { requestId } = req.params;
        const { userId, motifRejet } = req.body;

        const user = await usersCollection.findOne({ username: userId });
        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'Utilisateur non trouvé'
            });
        }

        const userRole = await rolesCollection.findOne({ _id: user.idRole });

        // Vérifier si le rôle existe
        if (!userRole) {
            return res.status(404).json({
                success: false,
                message: 'Rôle utilisateur non trouvé'
            });
        }

        // Seuls les niveau 1 peuvent rejeter
        if (userRole.niveau !== 1) {
            return res.status(403).json({
                success: false,
                message: 'Seuls les utilisateurs de niveau 1 peuvent rejeter les suppressions'
            });
        }

        const request = await deletionRequestsCollection.findOne({
            _id: new ObjectId(requestId)
        });

        if (!request) {
            return res.status(404).json({
                success: false,
                message: 'Demande non trouvée'
            });
        }

        // Vérifier que la demande est du même département
        if (!request.idDepartement.equals(user.idDepartement)) {
            return res.status(403).json({
                success: false,
                message: 'Vous ne pouvez rejeter que les demandes de votre département'
            });
        }

        if (request.statut !== 'en_attente') {
            return res.status(400).json({
                success: false,
                message: 'Cette demande a déjà été traitée'
            });
        }

        // Récupérer les informations du document (pour la notification)
        const document = await documentsCollection.findOne({ _id: request.idDocument });

        // Mettre à jour la demande
        const dateTraitement = new Date();
        await deletionRequestsCollection.updateOne(
            { _id: new ObjectId(requestId) },
            {
                $set: {
                    statut: 'rejetee',
                    idApprobateur: userId,
                    nomApprobateur: user.nom,
                    dateTraitement: dateTraitement,
                    motifRejet: motifRejet || 'Non spécifié'
                }
            }
        );

        // 📧 Envoyer une notification au demandeur
        try {
            const demandeur = await usersCollection.findOne({ username: request.idDemandeur });
            const demandeurRole = demandeur ? await rolesCollection.findOne({ _id: demandeur.idRole }) : null;

            const notificationBody = `Votre demande de suppression n'a pas été approuvée.

📄 Document concerné:
- Nom: ${document ? document.titre : request.documentTitre}
- ID: ${document ? document.idDocument : 'N/A'}
- Catégorie: ${document ? (document.categorie || 'Non spécifiée') : 'N/A'}

👤 Demandé par: ${request.nomDemandeur} (Niveau ${demandeurRole ? demandeurRole.niveau : 'N/A'})

❌ Motif du refus: ${motifRejet || 'Non spécifié'}

👤 Rejeté par: ${user.nom} (Niveau ${userRole.niveau})
📅 Date: ${dateTraitement.toLocaleString('fr-FR')}`;

            await messagesCollection.insertOne({
                from: 'Système',
                fromName: 'Système',
                to: request.idDemandeur,
                toName: request.nomDemandeur,
                subject: '❌ Demande de suppression non approuvée',
                body: notificationBody,
                type: 'deletion-rejected',
                relatedData: {
                    requestId: requestId,
                    documentId: document ? document.idDocument : null,
                    documentTitle: document ? document.titre : request.documentTitre,
                    motifRejet: motifRejet || 'Non spécifié'
                },
                read: false,
                createdAt: dateTraitement
            });

            console.log(`📧 Notification de rejet envoyée à ${request.idDemandeur}`);
        } catch (notifError) {
            console.error('⚠️ Erreur envoi notification rejet:', notifError);
            // On continue même si la notification échoue
        }

        console.log(`❌ Demande rejetée: ${requestId} par ${userId}`);

        res.json({
            success: true,
            message: 'Demande de suppression rejetée'
        });

    } catch (error) {
        console.error('Erreur rejet demande:', error);
        res.status(500).json({ success: false, message: 'Erreur serveur' });
    }
});

// Récupérer l'historique des demandes (approuvées et rejetées)
app.get('/api/deletion-requests/:userId/history', async (req, res) => {
    try {
        const { userId } = req.params;

        const user = await usersCollection.findOne({ username: userId });
        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'Utilisateur non trouvé'
            });
        }

        const userRole = await rolesCollection.findOne({ _id: user.idRole });

        // Vérifier si le rôle existe
        if (!userRole) {
            return res.status(404).json({
                success: false,
                message: 'Rôle utilisateur non trouvé'
            });
        }

        // Seuls les niveau 1 peuvent voir l'historique complet
        if (userRole.niveau !== 1) {
            // Niveau 2/3 peuvent voir uniquement leurs propres demandes
            const requests = await deletionRequestsCollection.find({
                idDemandeur: userId
            }).sort({ dateCreation: -1 }).toArray();

            return res.json({
                success: true,
                requests
            });
        }

        // Niveau 1: voir toutes les demandes du département
        const requests = await deletionRequestsCollection.find({
            idDepartement: user.idDepartement,
            statut: { $in: ['approuvee', 'rejetee'] }
        }).sort({ dateTraitement: -1 }).limit(50).toArray();

        res.json({
            success: true,
            requests
        });

    } catch (error) {
        console.error('Erreur récupération historique:', error);
        res.status(500).json({ success: false, message: 'Erreur serveur' });
    }
});

// ============================================
// ROUTES CATÉGORIES
// ============================================

app.get('/api/categories/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        const categories = await categoriesCollection
            .find({ idUtilisateur: userId })
            .toArray();
        res.json(categories);
    } catch (error) {
        console.error('Erreur récupération catégories:', error);
        res.status(500).json({ message: 'Erreur serveur' });
    }
});

app.post('/api/categories', async (req, res) => {
    try {
        const { userId, id, nom, couleur, icon } = req.body;

        if (!userId || !id || !nom) {
            return res.status(400).json({
                success: false,
                message: 'Données manquantes'
            });
        }

        const exists = await categoriesCollection.findOne({ idUtilisateur: userId, id });
        if (exists) {
            return res.status(400).json({
                success: false,
                message: 'Catégorie existe déjà'
            });
        }

        await categoriesCollection.insertOne({
            idUtilisateur: userId,
            id,
            nom,
            couleur,
            icon
        });

        res.json({ success: true });

    } catch (error) {
        console.error('Erreur ajout catégorie:', error);
        res.status(500).json({ success: false, message: 'Erreur serveur' });
    }
});

// Modifier une catégorie
app.put('/api/categories/:userId/:catId', async (req, res) => {
    try {
        const { userId, catId } = req.params;
        const { nom, couleur, icon } = req.body;

        if (!nom) {
            return res.status(400).json({
                success: false,
                message: 'Le nom est requis'
            });
        }

        const result = await categoriesCollection.updateOne(
            { idUtilisateur: userId, id: catId },
            { $set: { nom, couleur, icon } }
        );

        if (result.matchedCount === 0) {
            return res.status(404).json({
                success: false,
                message: 'Catégorie non trouvée'
            });
        }

        res.json({ success: true });

    } catch (error) {
        console.error('Erreur modification catégorie:', error);
        res.status(500).json({ success: false, message: 'Erreur serveur' });
    }
});

app.delete('/api/categories/:userId/:catId', async (req, res) => {
    try {
        const { userId, catId } = req.params;

        // Réaffecter les documents de cette catégorie vers "autre"
        await documentsCollection.updateMany(
            { idUtilisateur: userId, categorie: catId },
            { $set: { categorie: 'autre' } }
        );

        // Supprimer la catégorie
        const result = await categoriesCollection.deleteOne({
            idUtilisateur: userId,
            id: catId
        });

        if (result.deletedCount === 0) {
            return res.status(404).json({
                success: false,
                message: 'Catégorie non trouvée'
            });
        }

        res.json({ success: true });

    } catch (error) {
        console.error('Erreur suppression catégorie:', error);
        res.status(500).json({ success: false, message: 'Erreur serveur' });
    }
});

// ============================================
// ROUTES RÔLES ET DÉPARTEMENTS
// ============================================

app.get('/api/roles', async (req, res) => {
    try {
        const roles = await rolesCollection.find().toArray();
        res.json(roles);
    } catch (error) {
        res.status(500).json({ message: 'Erreur serveur' });
    }
});

// Créer un rôle
app.post('/api/roles', async (req, res) => {
    try {
        const { nom, niveau, description } = req.body;

        if (!nom || !niveau || !description) {
            return res.status(400).json({ success: false, message: 'Données manquantes' });
        }

        const result = await rolesCollection.insertOne({ nom, niveau, description, createdAt: new Date() });
        res.json({ success: true, roleId: result.insertedId });
    } catch (error) {
        console.error('Erreur création rôle:', error);
        res.status(500).json({ success: false, message: 'Erreur serveur' });
    }
});

// Modifier un rôle
app.put('/api/roles/:roleId', async (req, res) => {
    try {
        const { roleId } = req.params;
        const { nom, niveau, description } = req.body;

        if (!nom || !niveau || !description) {
            return res.status(400).json({ success: false, message: 'Données manquantes' });
        }

        await rolesCollection.updateOne(
            { _id: new ObjectId(roleId) },
            { $set: { nom, niveau, description, updatedAt: new Date() } }
        );

        res.json({ success: true });
    } catch (error) {
        console.error('Erreur modification rôle:', error);
        res.status(500).json({ success: false, message: 'Erreur serveur' });
    }
});

// Supprimer un rôle
app.delete('/api/roles/:roleId', async (req, res) => {
    try {
        const { roleId } = req.params;

        // Vérifier qu'aucun utilisateur n'a ce rôle
        const usersWithRole = await usersCollection.countDocuments({ idRole: new ObjectId(roleId) });
        if (usersWithRole > 0) {
            return res.status(400).json({ success: false, message: `${usersWithRole} utilisateur(s) ont ce rôle. Veuillez d'abord changer leur rôle.` });
        }

        await rolesCollection.deleteOne({ _id: new ObjectId(roleId) });
        res.json({ success: true });
    } catch (error) {
        console.error('Erreur suppression rôle:', error);
        res.status(500).json({ success: false, message: 'Erreur serveur' });
    }
});

app.get('/api/departements', async (req, res) => {
    try {
        const departements = await departementsCollection.find().toArray();
        res.json(departements);
    } catch (error) {
        res.status(500).json({ message: 'Erreur serveur' });
    }
});

// Ajouter un département
app.post('/api/departements', async (req, res) => {
    try {
        const { nom, code } = req.body;

        if (!nom || !code) {
            return res.status(400).json({ message: 'Nom et code requis' });
        }

        const nouveauDepartement = {
            _id: new ObjectId(),
            nom,
            code,
            dateCreation: new Date()
        };

        await departementsCollection.insertOne(nouveauDepartement);
        res.json({ message: 'Département créé', departement: nouveauDepartement });
    } catch (error) {
        console.error('Erreur création département:', error);
        res.status(500).json({ message: 'Erreur serveur' });
    }
});

// Modifier un département
app.put('/api/departements/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { nom, code } = req.body;

        if (!nom || !code) {
            return res.status(400).json({ message: 'Nom et code requis' });
        }

        const result = await departementsCollection.updateOne(
            { _id: new ObjectId(id) },
            { $set: { nom, code } }
        );

        if (result.matchedCount === 0) {
            return res.status(404).json({ message: 'Département non trouvé' });
        }

        res.json({ message: 'Département modifié' });
    } catch (error) {
        console.error('Erreur modification département:', error);
        res.status(500).json({ message: 'Erreur serveur' });
    }
});

// Supprimer un département
app.delete('/api/departements/:id', async (req, res) => {
    try {
        const { id } = req.params;

        const result = await departementsCollection.deleteOne({ _id: new ObjectId(id) });

        if (result.deletedCount === 0) {
            return res.status(404).json({ message: 'Département non trouvé' });
        }

        res.json({ message: 'Département supprimé' });
    } catch (error) {
        console.error('Erreur suppression département:', error);
        res.status(500).json({ message: 'Erreur serveur' });
    }
});

// Créer une demande de suppression (NIVEAU 2)
app.post('/api/deletion-requests', async (req, res) => {
    try {
        const { documentId, requestedBy } = req.body;

        if (!documentId || !requestedBy) {
            return res.status(400).json({ success: false, message: 'Données manquantes' });
        }

        // Récupérer le document
        const document = await documentsCollection.findOne({ _id: new ObjectId(documentId) });
        if (!document) {
            return res.status(404).json({ success: false, message: 'Document non trouvé' });
        }

        // Récupérer l'utilisateur qui fait la demande
        const requester = await usersCollection.findOne({ username: requestedBy });
        if (!requester) {
            return res.status(404).json({ success: false, message: 'Utilisateur non trouvé' });
        }

        // Vérifier que l'utilisateur est bien niveau 3 uniquement (niveau 2 n'a plus accès)
        const requesterRole = await rolesCollection.findOne({ _id: requester.idRole });
        if (!requesterRole) {
            return res.status(404).json({ success: false, message: 'Rôle utilisateur non trouvé' });
        }
        if (requesterRole.niveau !== 3) {
            return res.status(403).json({ success: false, message: 'Seuls les utilisateurs de niveau 3 peuvent faire des demandes de suppression' });
        }

        // Vérifier que le document appartient bien à cet utilisateur
        if (document.idUtilisateur !== requestedBy) {
            return res.status(403).json({ success: false, message: 'Vous ne pouvez demander la suppression que de vos propres documents' });
        }

        // Vérifier si une demande existe déjà pour ce document
        const existingRequest = await deletionRequestsCollection.findOne({
            idDocument: new ObjectId(documentId),
            statut: 'en_attente'
        });

        if (existingRequest) {
            return res.json({
                success: false,
                message: 'Une demande de suppression est déjà en attente pour ce document',
                requestId: existingRequest._id
            });
        }

        // Créer la demande de suppression (utiliser la même structure que dans DELETE)
        const insertResult = await deletionRequestsCollection.insertOne({
            idDocument: new ObjectId(documentId),
            documentTitre: document.titre,
            idDemandeur: requestedBy,
            nomDemandeur: requester.nom,
            idDepartement: requester.idDepartement,
            dateCreation: new Date(),
            statut: 'en_attente',
            motif: req.body.motif || 'Non spécifié'
        });

        // ✅ Envoyer un message aux administrateurs niveau 1 du même département
        try {
            const nivel1Users = await usersCollection.find({
                idDepartement: requester.idDepartement
            }).toArray();

            // Filtrer pour ne garder que ceux qui ont le rôle niveau 1
            for (const user of nivel1Users) {
                const userRole = await rolesCollection.findOne({ _id: user.idRole });
                if (userRole && userRole.niveau === 1) {
                    await messagesCollection.insertOne({
                        from: requestedBy,
                        fromName: requester.nom,
                        to: user.username,
                        toName: user.nom,
                        subject: `📝 Nouvelle demande de suppression - ${document.titre}`,
                        body: `Bonjour ${user.nom},\n\n${requester.nom} (${requestedBy}) a créé une demande de suppression pour le document suivant :\n\n📄 Titre: ${document.titre}\n🆔 ID Document: ${document.idDocument}\n💬 Motif: ${req.body.motif || 'Non spécifié'}\n\nVeuillez vous rendre dans la section "Demandes de suppression" pour approuver ou rejeter cette demande.\n\nMerci`,
                        type: 'deletion-request',
                        relatedData: {
                            requestId: insertResult.insertedId.toString(),
                            documentId: documentId
                        },
                        read: false,
                        createdAt: new Date()
                    });
                    console.log(`📧 Message envoyé à ${user.username} pour la demande ${insertResult.insertedId}`);
                }
            }
        } catch (msgError) {
            console.error('⚠️ Erreur envoi messages notification:', msgError);
        }

        res.json({ success: true, message: 'Demande de suppression envoyée' });
    } catch (error) {
        console.error('Erreur création demande suppression:', error);
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

// Route catch-all (doit être APRÈS le gestionnaire d'erreurs)
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

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