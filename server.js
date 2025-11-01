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
const bcrypt = require('bcrypt'); // SÉCURITÉ: Hachage des mots de passe

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

// ============================================
// MIDDLEWARE
// ============================================
app.use(cors());
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ limit: '100mb', extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// ============================================
// GESTION DES PERMISSIONS
// ============================================

// Vérifier si un utilisateur peut accéder à un document
async function canAccessDocument(userId, documentId) {
    const user = await usersCollection.findOne({ username: userId });
    const document = await documentsCollection.findOne({ _id: new ObjectId(documentId) });

    if (!user || !document) return false;

    // Si c'est le créateur
    if (document.idUtilisateur === userId) return true;

    // ✅ NOUVEAU: Vérifier si le document a été partagé avec cet utilisateur
    if (document.sharedWith && document.sharedWith.includes(userId)) {
        console.log(`📤 Document partagé: ${userId} accède au document de ${document.idUtilisateur}`);
        return true;
    }

    // Récupérer les rôles
    const userRole = await rolesCollection.findOne({ _id: new ObjectId(user.idRole) });
    const docCreatorUser = await usersCollection.findOne({ username: document.idUtilisateur });

    if (!docCreatorUser) return true; // Document orphelin

    const docCreatorRole = await rolesCollection.findOne({ _id: new ObjectId(docCreatorUser.idRole) });

    // Vérifier le même département
    if (!user.idDepartement.equals(document.idDepartement)) return false;

    // ✅ Partage horizontal - même niveau, même département
    if (userRole.niveau === docCreatorRole.niveau) {
        console.log(`🤝 Partage horizontal niveau ${userRole.niveau}: ${userId} accède au document de ${document.idUtilisateur}`);
        return true;
    }

    // Règle hiérarchique classique: niveau supérieur peut voir niveau inférieur
    // (niveau plus bas = plus de droits)
    return userRole.niveau < docCreatorRole.niveau;
}

// Récupérer les documents accessibles pour un utilisateur
async function getAccessibleDocuments(userId) {
    const user = await usersCollection.findOne({ username: userId });
    if (!user) return [];

    const userRole = await rolesCollection.findOne({ _id: user.idRole });
    if (!userRole) return [];

    console.log(`📋 Récupération documents pour: ${userId} (niveau ${userRole.niveau}, dept: ${user.idDepartement})`);

    // ✅ Rechercher documents du département + documents partagés avec l'utilisateur
    let query = {
        $or: [
            { idDepartement: user.idDepartement },
            { idUtilisateur: userId, idDepartement: { $exists: false } },
            { sharedWith: userId } // Documents partagés avec cet utilisateur
        ]
    };

    const allDocs = await documentsCollection.find(query).toArray();
    console.log(`📊 Documents trouvés: ${allDocs.length}`);

    // Filtrer selon les règles
    const accessibleDocs = [];
    for (const doc of allDocs) {
        const docCreator = await usersCollection.findOne({ username: doc.idUtilisateur });
        if (!docCreator) {
            // Document orphelin - accessible
            accessibleDocs.push(doc);
            continue;
        }

        const docCreatorRole = await rolesCollection.findOne({ _id: docCreator.idRole });

        // Toujours voir ses propres documents
        if (doc.idUtilisateur === userId) {
            accessibleDocs.push(doc);
            continue;
        }

        // ✅ Document partagé avec cet utilisateur
        if (doc.sharedWith && doc.sharedWith.includes(userId)) {
            accessibleDocs.push(doc);
            continue;
        }

        // Vérifier même département
        const sameDepart = docCreator.idDepartement &&
                          user.idDepartement &&
                          docCreator.idDepartement.equals(user.idDepartement);

        if (sameDepart) {
            // ✅ Partage horizontal - même niveau
            if (userRole.niveau === docCreatorRole.niveau) {
                accessibleDocs.push(doc);
                continue;
            }

            // Règle hiérarchique: niveau supérieur peut voir niveau inférieur
            if (userRole.niveau < docCreatorRole.niveau) {
                accessibleDocs.push(doc);
            }
        }
    }

    console.log(`✅ Documents accessibles: ${accessibleDocs.length}`);
    return accessibleDocs;
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

        // Créer des index
        await documentsCollection.createIndex({ idUtilisateur: 1, dateAjout: -1 });
        await documentsCollection.createIndex({ idDepartement: 1 });
        await usersCollection.createIndex({ username: 1 }, { unique: true });

        console.log('✅ Connexion à MongoDB réussie');
        console.log(`📊 Base de données: ${DB_NAME}`);

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
        { libelle: 'primaire', niveau: 1, description: 'Accès complet au département' },
        { libelle: 'secondaire', niveau: 2, description: 'Accès à ses documents et aux documents tertiaires' },
        { libelle: 'tertiaire', niveau: 3, description: 'Accès uniquement à ses propres documents' }
    ];
    
    for (const role of defaultRoles) {
        const exists = await rolesCollection.findOne({ libelle: role.libelle });
        if (!exists) {
            await rolesCollection.insertOne(role);
            console.log(`✅ Rôle créé: ${role.libelle}`);
        }
    }
    
    // 2. DÉPARTEMENTS
    const defaultDepartements = [
        { nom: 'Direction', description: 'Direction générale' },
        { nom: 'Comptabilité', description: 'Service comptabilité' },
        { nom: 'Ressources Humaines', description: 'Service RH' },
        { nom: 'Technique', description: 'Service technique' }
    ];
    
    for (const dept of defaultDepartements) {
        const exists = await departementsCollection.findOne({ nom: dept.nom });
        if (!exists) {
            await departementsCollection.insertOne(dept);
            console.log(`✅ Département créé: ${dept.nom}`);
        }
    }
    
    // 3. UTILISATEURS
    const primaryRole = await rolesCollection.findOne({ libelle: 'primaire' });
    const secondaryRole = await rolesCollection.findOne({ libelle: 'secondaire' });
    const tertiaryRole = await rolesCollection.findOne({ libelle: 'tertiaire' });
    
    const directionDept = await departementsCollection.findOne({ nom: 'Direction' });
    const comptaDept = await departementsCollection.findOne({ nom: 'Comptabilité' });
    
    // ✅ CORRECTION: Utiliser bcrypt.hash() directement
    const defaultUsers = [
        { 
            username: 'fatima', 
            password: await bcrypt.hash('1234', 10),
            nom: 'Fatima',
            email: 'fatima@cerer.sn',
            idRole: primaryRole._id,
            idDepartement: directionDept._id
        },
        {
            username: 'awa',
            password: await bcrypt.hash('5746', 10),
            nom: 'Awa',
            email: 'awa@cerer.sn',
            idRole: primaryRole._id, // ✅ Niveau 1 (Primaire)
            idDepartement: directionDept._id
        },
        { 
            username: 'deguene', 
            password: await bcrypt.hash('3576', 10),
            nom: 'Deguene',
            email: 'deguene@cerer.sn',
            idRole: tertiaryRole._id,
            idDepartement: comptaDept._id
        },
        { 
            username: 'jbk', 
            password: await bcrypt.hash('0811', 10),
            nom: 'JBK',
            email: 'jbk@cerer.sn',
            idRole: primaryRole._id,
            idDepartement: comptaDept._id
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

// Login
app.post('/api/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        
        if (!username || !password) {
            return res.status(400).json({ 
                success: false, 
                message: 'Username et password requis' 
            });
        }
        
        // SÉCURITÉ: Chercher l'utilisateur par username uniquement
        const user = await usersCollection.findOne({ username });

        if (!user) {
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
            return res.status(401).json({
                success: false,
                message: 'Identifiants incorrects'
            });
        }
        
        // Récupérer les infos complètes
        const role = await rolesCollection.findOne({ _id: user.idRole });
        const departement = await departementsCollection.findOne({ _id: user.idDepartement });
        
        res.json({ 
            success: true, 
            username,
            user: {
                username: user.username,
                nom: user.nom,
                email: user.email,
                role: role.libelle,
                roleNiveau: role.niveau,
                departement: departement.nom
            }
        });
        
    } catch (error) {
        console.error('Erreur login:', error);
        res.status(500).json({ success: false, message: 'Erreur serveur' });
    }
});

// Register
app.post('/api/register', async (req, res) => {
    try {
        const { username, password, nom, email, idRole, idDepartement } = req.body;
        
        if (!username || !password || !nom || !email) {
            return res.status(400).json({ 
                success: false, 
                message: 'Données manquantes' 
            });
        }
        
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
            roleId = defaultRole._id;
        }
        
        if (!deptId) {
            const defaultDept = await departementsCollection.findOne({ nom: 'Direction' });
            deptId = defaultDept._id;
        }
        
        // SÉCURITÉ: Hacher le mot de passe avec bcrypt (10 rounds)
        const hashedPassword = await bcrypt.hash(password, 10);

        await usersCollection.insertOne({
            username,
            password: hashedPassword, // ✅ Mot de passe sécurisé
            nom,
            email,
            idRole: new ObjectId(roleId),
            idDepartement: new ObjectId(deptId),
            dateCreation: new Date()
        });
        
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
        const departement = await departementsCollection.findOne({ _id: user.idDepartement });

        res.json({
            success: true,
            user: {
                username: user.username,
                nom: user.nom,
                email: user.email,
                role: role.libelle,
                roleNiveau: role.niveau,
                departement: departement.nom,
                idRole: user.idRole,
                idDepartement: user.idDepartement
            }
        });

    } catch (error) {
        console.error('Erreur récupération utilisateur:', error);
        res.status(500).json({ success: false, message: 'Erreur serveur' });
    }
});

// ============================================
// ROUTES DOCUMENTS (avec permissions)
// ============================================

// Ajouter un document
app.post('/api/documents', async (req, res) => {
    try {
        const { userId, titre, categorie, date, dateAjout, description, tags, nomFichier, taille, type, contenu } = req.body;
        
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

        const document = {
            idUtilisateur: userId,
            titre,
            idCategorie: categorie,
            date: date || new Date(),
            dateAjout: dateAjout || new Date(),
            description,
            tags,
            nomFichier,
            taille,
            type,
            contenu,
            idDepartement: user.idDepartement,
            createdAt: new Date(),
            // ✅ Informations de l'archiveur
            archivePar: {
                utilisateur: userId,
                nomComplet: user.nom,
                date: new Date()
            },
            // ✅ Initialiser les champs de téléchargement
            dernierTelechargement: null,
            historiqueTelechargements: []
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
        
        res.json(document);
        
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
                message: 'Seul le propriétaire peut partager ce document'
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

// Récupérer tous les utilisateurs disponibles pour le partage
app.get('/api/users-for-sharing/:userId', async (req, res) => {
    try {
        const { userId } = req.params;

        // Récupérer tous les utilisateurs sauf l'utilisateur actuel
        const allUsers = await usersCollection.find({
            username: { $ne: userId }
        }).toArray();

        // Enrichir avec les informations du département
        const usersWithDept = await Promise.all(allUsers.map(async (user) => {
            const dept = await departementsCollection.findOne({ _id: user.idDepartement });
            return {
                username: user.username,
                nom: user.nom,
                email: user.email,
                departement: dept ? dept.libelle : 'Non défini'
            };
        }));

        res.json({
            success: true,
            users: usersWithDept
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
            // ✅ Primaire : Supprimer TOUS les documents du département
            // OU les documents de l'utilisateur qui n'ont pas de département (anciens documents)
            query = {
                $or: [
                    { idDepartement: user.idDepartement },
                    { idUtilisateur: userId, idDepartement: { $exists: false } }
                ]
            };
            console.log('📋 Suppression niveau PRIMAIRE - Département:', user.idDepartement);
        } else {
            // ✅ Secondaire/Tertiaire : Uniquement ses propres documents
            query = { idUtilisateur: userId };
            console.log('📋 Suppression niveau SECONDAIRE/TERTIAIRE - Utilisateur:', userId);
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

        // ✅ NOUVEAU: Si niveau 2 ou 3, créer une demande de suppression
        if (userRole.niveau === 2 || userRole.niveau === 3) {
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

            return res.json({
                success: false,
                requiresApproval: true,
                message: 'Demande de suppression créée. Un utilisateur de niveau 1 doit l\'approuver.',
                requestId: request.insertedId
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
        await deletionRequestsCollection.updateOne(
            { _id: new ObjectId(requestId) },
            {
                $set: {
                    statut: 'approuvee',
                    idApprobateur: userId,
                    nomApprobateur: user.nom,
                    dateTraitement: new Date()
                }
            }
        );

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

        // Mettre à jour la demande
        await deletionRequestsCollection.updateOne(
            { _id: new ObjectId(requestId) },
            {
                $set: {
                    statut: 'rejetee',
                    idApprobateur: userId,
                    nomApprobateur: user.nom,
                    dateTraitement: new Date(),
                    motifRejet: motifRejet || 'Non spécifié'
                }
            }
        );

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

app.delete('/api/categories/:userId/:catId', async (req, res) => {
    try {
        const { userId, catId } = req.params;

        // Réaffecter les documents de cette catégorie vers "autre"
        await documentsCollection.updateMany(
            { idUtilisateur: userId, idCategorie: catId },
            { $set: { idCategorie: 'autre' } }
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

app.get('/api/departements', async (req, res) => {
    try {
        const departements = await departementsCollection.find().toArray();
        res.json(departements);
    } catch (error) {
        res.status(500).json({ message: 'Erreur serveur' });
    }
});

// Route catch-all
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