/**
 * Voir les logs d'audit Super Admin
 */

require('dotenv').config();
const { MongoClient } = require('mongodb');

const MONGO_URI = process.env.MONGODB_URI || "mongodb://localhost:27017";
const DB_NAME = process.env.MONGODB_DB_NAME || 'cerer_archivage';

async function viewAuditLogs() {
    let client;

    try {
        client = await MongoClient.connect(MONGO_URI);
        const db = client.db(DB_NAME);
        const auditLogsCollection = db.collection('auditLogs');

        console.log('\n╔════════════════════════════════════════════════════════╗');
        console.log('║  LOGS D\'AUDIT SUPER ADMIN (10 derniers)              ║');
        console.log('╚════════════════════════════════════════════════════════╝\n');

        const logs = await auditLogsCollection
            .find({})
            .sort({ timestamp: -1 })
            .limit(10)
            .toArray();

        if (logs.length === 0) {
            console.log('📭 Aucun log d\'audit trouvé\n');
        } else {
            logs.forEach((log, index) => {
                console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
                console.log(`Log #${index + 1}`);
                console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
                console.log(`📅 Date: ${log.timestamp?.toLocaleString('fr-FR') || 'N/A'}`);
                console.log(`👤 Utilisateur: ${log.user || 'N/A'} (Niveau ${log.userLevel})`);
                console.log(`🔧 Action: ${log.action || 'N/A'}`);
                console.log(`🎯 Cible: ${JSON.stringify(log.target || {})}`);
                console.log(`🌐 IP: ${log.ip || 'N/A'}`);
                console.log(`✅ Résultat: ${log.result || 'N/A'}`);
                console.log('');
            });
        }

        console.log(`\n📊 Total de logs: ${await auditLogsCollection.countDocuments()}\n`);

        await client.close();

    } catch (error) {
        console.error('❌ Erreur:', error);
        if (client) await client.close();
        process.exit(1);
    }
}

viewAuditLogs();
