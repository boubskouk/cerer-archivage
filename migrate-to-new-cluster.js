// ============================================
// SCRIPT DE MIGRATION VERS NOUVEAU CLUSTER
// Copie toutes les données de l'ancien vers le nouveau
// ============================================

require('dotenv').config();
const { MongoClient } = require('mongodb');

// ANCIEN CLUSTER (lent)
const OLD_URI = process.env.MONGODB_URI; // eq69ixv

// NOUVEAU CLUSTER (Paris - rapide)
const NEW_URI = "mongodb+srv://cerer_user:lg8kfhX5m82cpvdi@cluster0.jodtq6h.mongodb.net/cerer_archivage?retryWrites=true&w=majority";

// Collections à copier
const COLLECTIONS_TO_COPY = [
    'users',
    'documents',
    'categories',
    'roles',
    'departements',
    'services',
    'messages',
    'messageDeletionRequests',
    'shareHistory',
    'auditLogs',
    'ipRules',
    'systemSettings'
];

async function migrateData() {
    console.log('🚀 DÉBUT DE LA MIGRATION\n');
    console.log('📍 Ancien cluster: cluster0.eq69ixv.mongodb.net');
    console.log('📍 Nouveau cluster: cluster0.jodtq6h.mongodb.net (Paris)');
    console.log('📦 Base de données: cerer_archivage\n');

    let oldClient, newClient;

    try {
        // Connexion à l'ancien cluster
        console.log('🔌 Connexion à l\'ancien cluster...');
        oldClient = await MongoClient.connect(OLD_URI);
        const oldDB = oldClient.db('cerer_archivage');
        console.log('✅ Connecté à l\'ancien cluster\n');

        // Connexion au nouveau cluster
        console.log('🔌 Connexion au nouveau cluster...');
        newClient = await MongoClient.connect(NEW_URI);
        const newDB = newClient.db('cerer_archivage');
        console.log('✅ Connecté au nouveau cluster\n');

        const report = {
            copied: [],
            errors: [],
            totalDocs: 0
        };

        // Copier chaque collection
        for (const collectionName of COLLECTIONS_TO_COPY) {
            try {
                console.log(`📋 Copie de "${collectionName}"...`);

                // Récupérer tous les documents de l'ancienne collection
                const oldCollection = oldDB.collection(collectionName);
                const docs = await oldCollection.find({}).toArray();

                if (docs.length === 0) {
                    console.log(`   ⚪ Collection vide, ignorée\n`);
                    continue;
                }

                // Insérer dans la nouvelle collection
                const newCollection = newDB.collection(collectionName);
                await newCollection.insertMany(docs, { ordered: false });

                console.log(`   ✅ ${docs.length} document(s) copié(s)\n`);

                report.copied.push({
                    collection: collectionName,
                    count: docs.length
                });
                report.totalDocs += docs.length;

            } catch (error) {
                if (error.code === 11000) {
                    // Duplicate key - certains documents existent déjà
                    console.log(`   ⚠️ Certains documents existent déjà, ignorés\n`);
                } else {
                    console.error(`   ❌ Erreur: ${error.message}\n`);
                    report.errors.push({
                        collection: collectionName,
                        error: error.message
                    });
                }
            }
        }

        // Rapport final
        console.log('\n============================================================');
        console.log('✅ MIGRATION TERMINÉE !');
        console.log('============================================================\n');

        console.log('📊 RÉSUMÉ:');
        console.log(`   Total de documents copiés: ${report.totalDocs}\n`);

        console.log('📋 Détails par collection:');
        report.copied.forEach(item => {
            console.log(`   ✅ ${item.collection}: ${item.count} documents`);
        });

        if (report.errors.length > 0) {
            console.log('\n⚠️ Erreurs rencontrées:');
            report.errors.forEach(item => {
                console.log(`   ❌ ${item.collection}: ${item.error}`);
            });
        }

        console.log('\n============================================================');
        console.log('🎯 PROCHAINES ÉTAPES:');
        console.log('   1. Vérifiez que les données sont correctes dans MongoDB Atlas');
        console.log('   2. Mettez à jour la variable MONGODB_URI dans Render');
        console.log('   3. Testez l\'application');
        console.log('============================================================\n');

        console.log('📝 Nouvelle URL de connexion pour Render:');
        console.log(NEW_URI);
        console.log('');

    } catch (error) {
        console.error('💀 Erreur fatale:', error);
        process.exit(1);
    } finally {
        if (oldClient) await oldClient.close();
        if (newClient) await newClient.close();
    }
}

// Lancer la migration
migrateData();
