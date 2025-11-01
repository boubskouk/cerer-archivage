// ============================================
// SCRIPT : Ajouter le niveau aux téléchargements existants
// ============================================
require('dotenv').config();

const { MongoClient } = require('mongodb');

const MONGO_URI = process.env.MONGODB_URI;
const DB_NAME = 'cerer_archivage';

async function addNiveauToDownloads() {
    console.log('🔄 Connexion à MongoDB...');

    try {
        const client = await MongoClient.connect(MONGO_URI, {
            serverSelectionTimeoutMS: 10000
        });

        const db = client.db(DB_NAME);
        const documentsCollection = db.collection('documents');
        const usersCollection = db.collection('users');
        const rolesCollection = db.collection('roles');

        console.log('✅ Connecté à MongoDB\n');

        // Récupérer tous les documents avec des téléchargements
        const documents = await documentsCollection.find({
            $or: [
                { dernierTelechargement: { $exists: true } },
                { historiqueTelechargements: { $exists: true, $ne: [] } }
            ]
        }).toArray();

        console.log(`📊 ${documents.length} documents avec des téléchargements trouvés\n`);

        let updateCount = 0;

        for (const doc of documents) {
            let needsUpdate = false;
            const updates = {};

            // Mettre à jour dernierTelechargement
            if (doc.dernierTelechargement && !doc.dernierTelechargement.niveau) {
                const user = await usersCollection.findOne({ username: doc.dernierTelechargement.utilisateur });
                if (user) {
                    const role = await rolesCollection.findOne({ _id: user.idRole });
                    if (role) {
                        updates['dernierTelechargement.niveau'] = role.niveau;
                        updates['dernierTelechargement.role'] = role.libelle;
                        needsUpdate = true;
                        console.log(`📝 Ajout niveau ${role.niveau} pour dernier téléchargement de ${doc.dernierTelechargement.utilisateur}`);
                    }
                }
            }

            // Mettre à jour historiqueTelechargements
            if (doc.historiqueTelechargements && doc.historiqueTelechargements.length > 0) {
                const updatedHistory = [];
                let historyChanged = false;

                for (const download of doc.historiqueTelechargements) {
                    if (!download.niveau) {
                        const user = await usersCollection.findOne({ username: download.utilisateur });
                        if (user) {
                            const role = await rolesCollection.findOne({ _id: user.idRole });
                            if (role) {
                                download.niveau = role.niveau;
                                download.role = role.libelle;
                                historyChanged = true;
                            }
                        }
                    }
                    updatedHistory.push(download);
                }

                if (historyChanged) {
                    updates.historiqueTelechargements = updatedHistory;
                    needsUpdate = true;
                }
            }

            // Appliquer les mises à jour
            if (needsUpdate) {
                await documentsCollection.updateOne(
                    { _id: doc._id },
                    { $set: updates }
                );
                updateCount++;
                console.log(`   ✅ Document ${doc._id} mis à jour`);
            }
        }

        await client.close();

        console.log('\n' + '='.repeat(60));
        console.log(`✅ Migration terminée : ${updateCount} documents mis à jour`);
        console.log('='.repeat(60));

    } catch (error) {
        console.error('❌ Erreur:', error.message);
        process.exit(1);
    }
}

addNiveauToDownloads();
