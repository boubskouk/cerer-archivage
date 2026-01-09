// Script pour ajouter le champ "deleted: false" aux documents qui ne l'ont pas
require('dotenv').config();
const { MongoClient } = require('mongodb');

async function fixDeletedField() {
    console.log('🔧 Correction du champ "deleted" dans les documents...\n');

    const client = await MongoClient.connect(process.env.MONGODB_URI);
    const db = client.db('cerer_archivage');

    // Compter combien de documents n'ont pas le champ
    const countBefore = await db.collection('documents').countDocuments({ deleted: { $exists: false } });
    console.log(`📋 Documents sans champ "deleted": ${countBefore}`);

    if (countBefore === 0) {
        console.log('✅ Tous les documents ont déjà le champ "deleted"');
        await client.close();
        return;
    }

    // Ajouter deleted: false à tous les documents qui ne l'ont pas
    console.log('\n🔧 Ajout de "deleted: false" aux documents...');
    const result = await db.collection('documents').updateMany(
        { deleted: { $exists: false } },
        { $set: { deleted: false } }
    );

    console.log(`✅ ${result.modifiedCount} documents mis à jour`);

    // Vérification
    const countAfter = await db.collection('documents').countDocuments({ deleted: { $exists: false } });
    console.log(`\n📊 Vérification:`);
    console.log(`   Documents sans "deleted": ${countAfter}`);
    console.log(`   Documents avec deleted=false: ${await db.collection('documents').countDocuments({ deleted: false })}`);
    console.log(`   Documents avec deleted=true: ${await db.collection('documents').countDocuments({ deleted: true })}`);

    await client.close();

    console.log('\n✅ TERMINÉ!');
    console.log('💡 Vous pouvez maintenant utiliser simplement { deleted: false } dans vos requêtes');
    console.log('   → Les index seront utilisés correctement!');
}

fixDeletedField().catch(console.error);
