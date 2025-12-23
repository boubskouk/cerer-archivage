#!/usr/bin/env node

/**
 * Réinitialisation automatique du mot de passe pour le compte "boubs"
 */

require('dotenv').config();
const { MongoClient } = require('mongodb');
const bcrypt = require('bcrypt');

const MONGO_URI = process.env.MONGODB_URI || "mongodb://localhost:27017";
const DB_NAME = process.env.MONGODB_DB_NAME || 'cerer_archivage';

// Nouveau mot de passe par défaut
const NEW_PASSWORD = 'SuperAdmin2025!';

async function resetBoubsPassword() {
    let client;

    try {
        console.log('');
        console.log('╔════════════════════════════════════════════════════════╗');
        console.log('║  RÉINITIALISATION MOT DE PASSE - COMPTE BOUBS        ║');
        console.log('╚════════════════════════════════════════════════════════╝');
        console.log('');

        // Connexion MongoDB
        console.log('🔄 Connexion à MongoDB...');
        client = await MongoClient.connect(MONGO_URI);
        const db = client.db(DB_NAME);
        console.log('✅ Connecté à MongoDB\n');

        const usersCollection = db.collection('users');

        // Trouver le compte boubs
        const user = await usersCollection.findOne({ username: 'boubs' });

        if (!user) {
            console.log('❌ Erreur: Compte "boubs" non trouvé');
            await client.close();
            return;
        }

        console.log('✅ Compte trouvé:');
        console.log(`   Username: ${user.username}`);
        console.log(`   Email: ${user.email}`);
        console.log(`   Nom: ${user.prenom} ${user.nom}`);
        console.log('');

        // Hasher le nouveau mot de passe
        console.log('🔐 Génération du nouveau mot de passe...');
        const hashedPassword = await bcrypt.hash(NEW_PASSWORD, 10);

        // Mettre à jour
        await usersCollection.updateOne(
            { _id: user._id },
            { $set: { password: hashedPassword } }
        );

        console.log('');
        console.log('╔════════════════════════════════════════════════════════╗');
        console.log('║  ✅  MOT DE PASSE RÉINITIALISÉ AVEC SUCCÈS !          ║');
        console.log('╚════════════════════════════════════════════════════════╝');
        console.log('');
        console.log('🔐 VOS NOUVEAUX IDENTIFIANTS:');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('');
        console.log(`📍 URL de connexion:`);
        console.log(`   http://localhost:${process.env.PORT || 4000}/super-admin-login.html`);
        console.log('');
        console.log(`👤 Username:`);
        console.log(`   ${user.username}`);
        console.log('');
        console.log(`📧 Email:`);
        console.log(`   ${user.email}`);
        console.log('');
        console.log(`🔑 Mot de passe:`);
        console.log(`   ${NEW_PASSWORD}`);
        console.log('');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('');
        console.log('⚠️  IMPORTANT:');
        console.log('   - Notez bien ces informations');
        console.log('   - Changez le mot de passe après la première connexion');
        console.log('');

        await client.close();

        console.log('✅ Terminé !\n');

    } catch (error) {
        console.error('\n❌ Erreur:', error.message);
        if (client) await client.close();
        process.exit(1);
    }
}

resetBoubsPassword();
