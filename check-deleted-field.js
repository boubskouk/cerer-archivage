// Vérifier la structure du champ deleted
require('dotenv').config();
const { MongoClient } = require('mongodb');

async function checkDeletedField() {
    const client = await MongoClient.connect(process.env.MONGODB_URI);
    const db = client.db('cerer_archivage');

    // Compter les différents cas
    const total = await db.collection('documents').countDocuments({});
    const withDeletedTrue = await db.collection('documents').countDocuments({ deleted: true });
    const withDeletedFalse = await db.collection('documents').countDocuments({ deleted: false });
    const withoutDeletedField = await db.collection('documents').countDocuments({ deleted: { $exists: false } });

    console.log('📊 Analyse du champ "deleted":');
    console.log(`   Total documents: ${total}`);
    console.log(`   deleted: true = ${withDeletedTrue}`);
    console.log(`   deleted: false = ${withDeletedFalse}`);
    console.log(`   deleted n'existe pas = ${withoutDeletedField}`);

    // Échantillon de documents
    console.log('\n📄 Échantillon de 5 documents:');
    const samples = await db.collection('documents').find({}).limit(5).toArray();
    samples.forEach((doc, i) => {
        console.log(`   ${i+1}. idDocument: ${doc.idDocument}, deleted: ${doc.deleted}, hasDeletedField: ${doc.hasOwnProperty('deleted')}`);
    });

    await client.close();

    console.log('\n💡 RECOMMANDATION:');
    if (withoutDeletedField === 0) {
        console.log('   ✅ Tous les documents ont le champ "deleted"');
        console.log('   → Utiliser simplement: { deleted: false } au lieu de $or');
    } else {
        console.log('   ⚠️ Certains documents n\'ont pas le champ "deleted"');
        console.log('   → Ajouter le champ "deleted: false" à tous les documents sans ce champ');
    }
}

checkDeletedField().catch(console.error);
