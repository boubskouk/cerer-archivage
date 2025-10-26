// ============================================
// SERVEUR NODE.JS + MONGODB - ARCHIVAGE C.E.R.E.R
// Version 2.3 - CLOUD READY (Render/Railway)
// ============================================

const express = require('express');
const cors = require('cors');
const { MongoClient, ObjectId } = require('mongodb');
const os = require('os');
const path = require('path');

const app = express();

// ⭐ Configuration pour Cloud et Local
const PORT = process.env.PORT || 4000;
const MONGO_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017';
const DB_NAME = 'cerer_archivage';

let db;
let usersCollection;
let documentsCollection;
let categoriesCollection;

// ============================================
// MIDDLEWARE
// ============================================
app.use(cors());
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ limit: '100mb', extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Fonction pour obtenir l'IP locale
function getLocalIP() {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            if (iface.family === 'IPv4' && !iface.internal) {
                return iface.address;
            }
        }
    }
    return 'localhost';
}

// Fonction de hash simple
function hashPassword(password) {
    let hash = 0;
    for (let i = 0; i < password.length; i++) {
        const char = password.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
    }
    return hash.toString();
}

// Connexion à MongoDB (compatible Atlas et Local)
async function connectDB() {
    try {
        console.log('🔄 Connexion à MongoDB...');
        console.log('📍 URI:', MONGO_URI.includes('mongodb+srv') ? 'MongoDB Atlas (Cloud)' : 'MongoDB Local');
        
        const client = await MongoClient.connect(MONGO_URI, {
            useNewUrlParser: true,
            useUnifiedTopology: true,
            serverSelectionTimeoutMS: 10000
        });
        
        db = client.db(DB_NAME);
        usersCollection = db.collection('users');
        documentsCollection = db.collection('documents');
        categoriesCollection = db.collection('categories');
        
        // Créer des index pour optimiser les performances
        await documentsCollection.createIndex({ userId: 1, dateAjout: -1 });
        await documentsCollection.createIndex({ userId: 1, categorie: 1 });
        await categoriesCollection.createIndex({ userId: 1, id: 1 });
        
        console.log('✅ Connexion à MongoDB réussie');
        
        await initializeDefaultUsers();
        
    } catch (error) {
        console.error('❌ Erreur connexion MongoDB:', error.message);
        console.error('💡 Vérifiez:');
        console.error('   - MongoDB est démarré (local) ou');
        console.error('   - MONGODB_URI est correct (cloud)');
        process.exit(1);
    }
}

// Initialiser les utilisateurs par défaut
async function initializeDefaultUsers() {
    const defaultUsers = [
        { username: 'fatima', password: hashPassword('1234') },
        { username: 'awa', password: hashPassword('5746') },
        { username: 'deguene', password: hashPassword('3576') },
        { username: 'jbk', password: hashPassword('0811') },
        { username: 'demo', password: hashPassword('demo') } // Pour les démos
    ];
    
    for (const user of defaultUsers) {
        const exists = await usersCollection.findOne({ username: user.username });
        if (!exists) {
            await usersCollection.insertOne({
                ...user,
                createdAt: new Date()
            });
            console.log(`✅ Utilisateur créé: ${user.username}`);
        }
    }
    
    const categories = [
        { id: 'factures', nom: 'Factures', couleur: 'bg-blue-100 text-blue-800', icon: '🧾' },
        { id: 'contrats', nom: 'Contrats', couleur: 'bg-purple-100 text-purple-800', icon: '📜' },
        { id: 'fiscalite', nom: 'Fiscalité', couleur: 'bg-green-100 text-green-800', icon: '💰' },
        { id: 'assurance', nom: 'Assurance', couleur: 'bg-orange-100 text-orange-800', icon: '🛡️' },
        { id: 'identite', nom: 'Identité', couleur: 'bg-red-100 text-red-800', icon: '🪪' },
        { id: 'medical', nom: 'Médical', couleur: 'bg-pink-100 text-pink-800', icon: '🏥' },
        { id: 'juridique', nom: 'Juridique', couleur: 'bg-indigo-100 text-indigo-800', icon: '⚖️' },
        { id: 'autre', nom: 'Autre', couleur: 'bg-gray-100 text-gray-800', icon: '📁' }
    ];
    
    for (const user of defaultUsers) {
        for (const cat of categories) {
            const exists = await categoriesCollection.findOne({ 
                userId: user.username, 
                id: cat.id 
            });
            if (!exists) {
                await categoriesCollection.insertOne({
                    userId: user.username,
                    ...cat
                });
            }
        }
    }
}

// ============================================
// ROUTES API
// ============================================

// Health check (pour Render/Railway)
app.get('/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        timestamp: new Date(),
        database: db ? 'connected' : 'disconnected'
    });
});

// Route de test
app.get('/api/test', (req, res) => {
    res.json({ 
        message: '✅ API fonctionne!', 
        timestamp: new Date(),
        environment: process.env.NODE_ENV || 'development'
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
        
        const user = await usersCollection.findOne({ 
            username, 
            password: hashPassword(password) 
        });
        
        if (!user) {
            return res.status(401).json({ 
                success: false, 
                message: 'Identifiants incorrects' 
            });
        }
        
        res.json({ success: true, username });
        
    } catch (error) {
        console.error('Erreur login:', error);
        res.status(500).json({ success: false, message: 'Erreur serveur' });
    }
});

// Register
app.post('/api/register', async (req, res) => {
    try {
        const { username, password } = req.body;
        
        if (!username || !password) {
            return res.status(400).json({ 
                success: false, 
                message: 'Username et password requis' 
            });
        }
        
        if (username.length < 3 || password.length < 4) {
            return res.status(400).json({ 
                success: false, 
                message: 'Username: 3+ caractères, Password: 4+' 
            });
        }
        
        const exists = await usersCollection.findOne({ username });
        if (exists) {
            return res.status(400).json({ 
                success: false, 
                message: 'Utilisateur existe déjà' 
            });
        }
        
        await usersCollection.insertOne({
            username,
            password: hashPassword(password),
            createdAt: new Date()
        });
        
        const defaultCategories = [
            { id: 'factures', nom: 'Factures', couleur: 'bg-blue-100 text-blue-800', icon: '🧾' },
            { id: 'contrats', nom: 'Contrats', couleur: 'bg-purple-100 text-purple-800', icon: '📜' },
            { id: 'fiscalite', nom: 'Fiscalité', couleur: 'bg-green-100 text-green-800', icon: '💰' },
            { id: 'assurance', nom: 'Assurance', couleur: 'bg-orange-100 text-orange-800', icon: '🛡️' },
            { id: 'identite', nom: 'Identité', couleur: 'bg-red-100 text-red-800', icon: '🪪' },
            { id: 'medical', nom: 'Médical', couleur: 'bg-pink-100 text-pink-800', icon: '🏥' },
            { id: 'juridique', nom: 'Juridique', couleur: 'bg-indigo-100 text-indigo-800', icon: '⚖️' },
            { id: 'autre', nom: 'Autre', couleur: 'bg-gray-100 text-gray-800', icon: '📁' }
        ];
        
        for (const cat of defaultCategories) {
            await categoriesCollection.insertOne({ userId: username, ...cat });
        }
        
        res.json({ success: true });
        
    } catch (error) {
        console.error('Erreur register:', error);
        res.status(500).json({ success: false, message: 'Erreur serveur' });
    }
});

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
        
        const document = {
            userId,
            titre,
            categorie,
            date: date || new Date(),
            dateAjout: dateAjout || new Date(),
            description,
            tags,
            nomFichier,
            taille,
            type,
            contenu,
            createdAt: new Date()
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

// Import en masse
app.post('/api/documents/bulk', async (req, res) => {
    try {
        const { userId, documents } = req.body;
        
        if (!userId || !Array.isArray(documents) || documents.length === 0) {
            return res.status(400).json({ 
                success: false, 
                message: 'Données invalides' 
            });
        }
        
        const docsToInsert = documents.map(doc => ({
            userId,
            titre: doc.titre,
            categorie: doc.categorie,
            date: doc.date || new Date(),
            dateAjout: doc.dateAjout || new Date(),
            description: doc.description,
            tags: doc.tags,
            nomFichier: doc.nomFichier,
            taille: doc.taille,
            type: doc.type,
            contenu: doc.contenu,
            createdAt: new Date()
        }));
        
        const result = await documentsCollection.insertMany(docsToInsert);
        
        res.json({ 
            success: true, 
            insertedCount: result.insertedCount 
        });
        
    } catch (error) {
        console.error('Erreur import bulk:', error);
        res.status(500).json({ success: false, message: 'Erreur serveur' });
    }
});

// Suppression en masse
app.delete('/api/documents/:userId/delete-all', async (req, res) => {
    try {
        const { userId } = req.params;
        
        const result = await documentsCollection.deleteMany({ userId });
        
        console.log(`🗑️ Suppression de ${result.deletedCount} documents pour ${userId}`);
        
        res.json({ 
            success: true, 
            deletedCount: result.deletedCount,
            message: `${result.deletedCount} documents supprimés`
        });
        
    } catch (error) {
        console.error('Erreur suppression en masse:', error);
        res.status(500).json({ success: false, message: 'Erreur serveur' });
    }
});

// Récupérer les documents
app.get('/api/documents/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        const { full } = req.query;
        
        let projection = { contenu: 0 };
        if (full === 'true') {
            projection = {};
        }
        
        const documents = await documentsCollection
            .find({ userId })
            .project(projection)
            .sort({ dateAjout: -1 })
            .toArray();
        
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
        
        const document = await documentsCollection.findOne({ 
            _id: new ObjectId(docId),
            userId 
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

// Supprimer un document
app.delete('/api/documents/:userId/:docId', async (req, res) => {
    try {
        const { userId, docId } = req.params;
        
        const result = await documentsCollection.deleteOne({ 
            _id: new ObjectId(docId),
            userId 
        });
        
        if (result.deletedCount === 0) {
            return res.status(404).json({ 
                success: false, 
                message: 'Document non trouvé' 
            });
        }
        
        res.json({ success: true });
        
    } catch (error) {
        console.error('Erreur suppression document:', error);
        res.status(500).json({ success: false, message: 'Erreur serveur' });
    }
});

// Récupérer les catégories
app.get('/api/categories/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        
        const categories = await categoriesCollection
            .find({ userId })
            .toArray();
        
        res.json(categories);
        
    } catch (error) {
        console.error('Erreur récupération catégories:', error);
        res.status(500).json({ message: 'Erreur serveur' });
    }
});

// Ajouter une catégorie
app.post('/api/categories', async (req, res) => {
    try {
        const { userId, id, nom, couleur, icon } = req.body;
        
        if (!userId || !id || !nom) {
            return res.status(400).json({ 
                success: false, 
                message: 'Données manquantes' 
            });
        }
        
        const exists = await categoriesCollection.findOne({ userId, id });
        if (exists) {
            return res.status(400).json({ 
                success: false, 
                message: 'Catégorie existe déjà' 
            });
        }
        
        await categoriesCollection.insertOne({ userId, id, nom, couleur, icon });
        
        res.json({ success: true });
        
    } catch (error) {
        console.error('Erreur ajout catégorie:', error);
        res.status(500).json({ success: false, message: 'Erreur serveur' });
    }
});

// Supprimer une catégorie
app.delete('/api/categories/:userId/:catId', async (req, res) => {
    try {
        const { userId, catId } = req.params;
        
        await documentsCollection.updateMany(
            { userId, categorie: catId },
            { $set: { categorie: 'autre' } }
        );
        
        await categoriesCollection.deleteOne({ userId, id: catId });
        
        res.json({ success: true });
        
    } catch (error) {
        console.error('Erreur suppression catégorie:', error);
        res.status(500).json({ success: false, message: 'Erreur serveur' });
    }
});

// Route catch-all pour SPA (Single Page Application)
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ============================================
// DÉMARRAGE DU SERVEUR
// ============================================

connectDB().then(() => {
    app.listen(PORT, '0.0.0.0', () => {
        const localIP = getLocalIP();
        const isCloud = process.env.MONGODB_URI && process.env.MONGODB_URI.includes('mongodb+srv');
        
        console.log('\n' + '='.repeat(60));
        console.log('✅ SERVEUR ARCHIVAGE C.E.R.E.R DÉMARRÉ');
        console.log('='.repeat(60));
        
        if (isCloud) {
            console.log('\n🌐 MODE CLOUD (Production)');
            console.log(`📍 URL publique: https://votre-app.onrender.com`);
            console.log(`🔒 Base de données: MongoDB Atlas`);
        } else {
            console.log('\n📡 MODE LOCAL (Développement)');
            console.log(`   http://localhost:${PORT}`);
            console.log(`   http://${localIP}:${PORT}`);
        }
        
        console.log('\n👥 Comptes de test disponibles:');
        console.log('   - fatima / 1234');
        console.log('   - awa / 5746');
        console.log('   - deguene / 3576');
        console.log('   - jbk / 0811');
        console.log('   - demo / demo');
        
        console.log('\n' + '='.repeat(60));
        console.log('📝 Pour arrêter le serveur: Ctrl+C');
        console.log('='.repeat(60) + '\n');
    });
});

// Gestion des erreurs
process.on('unhandledRejection', (error) => {
    console.error('❌ Erreur non gérée:', error);
});

process.on('SIGINT', () => {
    console.log('\n👋 Arrêt du serveur...');
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('\n👋 Arrêt du serveur (SIGTERM)...');
    process.exit(0);
});