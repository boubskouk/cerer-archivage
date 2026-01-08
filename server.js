// ============================================
// SERVEUR NODE.JS + MONGODB - ARCHIVAGE C.E.R.E.R
// Architecture MVC Professionnelle
// ============================================

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('path');

// Configuration
const constants = require('./utils/constants');
const { connectDB } = require('./config/database');
const { createSessionStore, configureSession } = require('./config/session');
const security = require('./security-config');

// Middleware
const { checkIsOnline, checkIfBlocked } = require('./middleware/authMiddleware');

// Routes
const authRoutes = require('./routes/auth.routes');
const authController = require('./controllers/auth.controller');
const rolesController = require('./controllers/roles.controller');

// Services
const trashCleanup = require('./services/trashCleanup');

// ============================================
// INITIALISATION APPLICATION
// ============================================

const app = express();

// Configuration trust proxy
app.set('trust proxy', 1);

// ============================================
// MIDDLEWARE GLOBAUX
// ============================================

// Sécurité
app.use(security.helmetConfig);
app.use(security.compressionConfig);

// CORS
app.use(cors({
    origin: function (origin, callback) {
        if (!origin || constants.CORS.ALLOWED_ORIGINS.includes(origin)) {
            callback(null, true);
        } else {
            callback(null, true); // En développement
        }
    },
    credentials: true,
    methods: constants.CORS.METHODS,
    allowedHeaders: constants.CORS.HEADERS
}));

// Parsing
app.use(express.json({ limit: constants.LIMITS.JSON_SIZE }));
app.use(express.urlencoded({ limit: constants.LIMITS.URL_ENCODED_SIZE, extended: true }));

// Sessions
const sessionStore = createSessionStore();
console.log('✅ Sessions configurées (MongoStore - PRODUCTION)');

app.use(configureSession(sessionStore));

// Fichiers statiques
app.use(express.static('public'));

// Middleware de vérification isOnline et blocked
app.use(checkIsOnline);
app.use(checkIfBlocked);

// ============================================
// ROUTES
// ============================================

// Routes d'authentification
app.use('/api/auth', authRoutes);

// Routes de compatibilité avec l'ancien frontend
app.post('/api/login', security.loginLimiter, authController.login);
app.post('/api/admin-login', security.loginLimiter, authController.adminLogin);
app.post('/api/logout', authController.logout);
app.get('/api/session-check', authController.checkSession);
app.get('/api/user-info', authController.getUserInfo);
app.post('/api/verify-session', authController.verifySession);
app.get('/api/roles', rolesController.getAllRoles);

// Routes documents
const documentsRoutes = require('./routes/documents.routes');
app.use('/api/documents', documentsRoutes);

// Routes users
const usersRoutes = require('./routes/users.routes');
app.use('/api/users', usersRoutes);

// Routes messages
const messagesRoutes = require('./routes/messages.routes');
app.use('/api/messages', messagesRoutes);

// Routes categories
const categoriesRoutes = require('./routes/categories.routes');
app.use('/api/categories', categoriesRoutes);

// Routes services
const servicesRoutes = require('./routes/services.routes');
app.use('/api/services', servicesRoutes);

// Routes departements
const departementsRoutes = require('./routes/departements.routes');
app.use('/api/departements', departementsRoutes);

// Route de recherche globale
app.get('/api/search', async (req, res) => {
    try {
        const { q } = req.query;
        const userId = req.session?.userId;

        if (!userId) {
            return res.status(401).json({
                success: false,
                message: 'Non authentifié'
            });
        }

        if (!q || q.trim().length === 0) {
            return res.json({
                success: true,
                services: [],
                categories: [],
                documents: [],
                total: 0
            });
        }

        const { getCollections } = require('./config/database');
        const collections = getCollections();
        const searchTerm = q.trim();
        const searchRegex = new RegExp(searchTerm, 'i');

        // Récupérer l'utilisateur pour connaître son département
        const user = await collections.users.findOne({ username: userId });
        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'Utilisateur non trouvé'
            });
        }

        // Rechercher dans les services
        const services = await collections.services.find({
            idDepartement: user.idDepartement,
            nom: searchRegex
        }).limit(20).toArray();

        // Rechercher dans les catégories
        const categories = await collections.categories.find({
            idDepartement: user.idDepartement,
            nom: searchRegex
        }).limit(20).toArray();

        // Rechercher dans les documents
        const documents = await collections.documents.find({
            $or: [
                { titre: searchRegex },
                { description: searchRegex },
                { idDocument: searchRegex }
            ],
            deleted: { $ne: true }
        }).limit(50).toArray();

        res.json({
            success: true,
            services: services.map(s => ({ id: s._id, nom: s.nom })),
            categories: categories.map(c => ({ id: c._id, nom: c.nom })),
            documents: documents.map(d => ({
                _id: d._id,
                idDocument: d.idDocument,
                titre: d.titre,
                description: d.description,
                categorie: d.categorie,
                dateAjout: d.dateAjout
            })),
            total: services.length + categories.length + documents.length
        });

    } catch (error) {
        console.error('❌ Erreur recherche:', error);
        res.status(500).json({
            success: false,
            message: 'Erreur serveur'
        });
    }
});

// Route pour vérifier le statut de session (utilisée par le polling client)
app.get('/api/check-session-status', async (req, res) => {
    try {
        const { getCollections } = require('./config/database');
        const collections = getCollections();

        // Vérifier si l'utilisateur a une session active
        if (!req.session || !req.session.userId) {
            return res.status(401).json({
                success: false,
                message: 'Aucune session active',
                forceLogout: true
            });
        }

        // Vérifier si l'utilisateur existe toujours et est en ligne
        const user = await collections.users.findOne({
            username: req.session.userId
        });

        if (!user) {
            // L'utilisateur a été supprimé
            return res.status(401).json({
                success: false,
                message: 'Utilisateur non trouvé',
                forceLogout: true
            });
        }

        // Vérifier isOnline
        if (user.isOnline === false) {
            return res.status(401).json({
                success: false,
                message: 'Session terminée par un administrateur',
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

// TODO: Ajouter les autres routes ici
// app.use('/api/superadmin', superadminRoutes);

// ⚠️ Route catch-all déplacée après startServer() pour ne pas intercepter les routes API
// app.get('*', (req, res) => {
//     res.sendFile(path.join(__dirname, 'public', 'index.html'));
// });

// ============================================
// DÉMARRAGE SERVEUR
// ============================================

async function startServer() {
    try {
        // Connexion MongoDB
        const { db, collections, securityLogger } = await connectDB();

        // Initialiser le service de nettoyage de la corbeille
        trashCleanup.init({
            documents: collections.documents,
            auditLogs: collections.auditLogs,
            db
        });

        // Démarrer le cron job (uniquement instance principale)
        if (process.env.NODE_APP_INSTANCE === '0' || !process.env.NODE_APP_INSTANCE) {
            trashCleanup.startCronJob();
            console.log('✅ Cron job nettoyage corbeille actif (instance principale)');
        }

        // TODO: Initialiser les données par défaut
        // await initializeDefaultData();

        // Charger les modules Super Admin
        const superAdminAuth = require('./middleware/superAdminAuth');
        const superAdminRoutes = require('./routes/superadmin');

        superAdminAuth.init({
            users: collections.users,
            roles: collections.roles,
            auditLogs: collections.auditLogs
        });

        superAdminRoutes.init(db, {
            users: collections.users,
            documents: collections.documents,
            categories: collections.categories,
            roles: collections.roles,
            departements: collections.departements,
            services: collections.services,
            auditLogs: collections.auditLogs,
            systemSettings: collections.systemSettings,
            shareHistory: collections.shareHistory
        });

        app.use('/api/superadmin', superAdminRoutes.router);
        console.log('✅ Routes Super Admin (Niveau 0) chargées');

        // Charger les routes de profil
        const profileRoutes = require('./routes-profile');
        profileRoutes(app, collections);

        console.log('✅ Routes d\'authentification avec session configurées');
        console.log('✅ Route catch-all configurée');

        // Démarrer le serveur
        app.listen(constants.PORT, () => {
            console.log('');
            console.log('============================================================');
            console.log('✅ SERVEUR ARCHIVAGE C.E.R.E.R DÉMARRÉ (MVC)');
            console.log('============================================================');
            console.log('');
            console.log(`🔡 http://localhost:${constants.PORT}`);
            console.log('');
            console.log('============================================================');
        });

    } catch (error) {
        console.error('💀 Erreur fatale au démarrage:', error);
        process.exit(1);
    }
}

// Démarrer l'application
startServer();
