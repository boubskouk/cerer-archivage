// Test d'utilisation des index MongoDB
require('dotenv').config();
const { MongoClient, ObjectId } = require('mongodb');

async function testIndexUsage() {
    console.log('🔍 Test d\'utilisation des index MongoDB...\n');

    const client = await MongoClient.connect(process.env.MONGODB_URI);
    const db = client.db('cerer_archivage');

    // Récupérer un département réel
    const dept = await db.collection('departements').findOne({});
    console.log('📋 Département de test:', dept?.nom || 'N/A');
    console.log('🆔 ID Département:', dept?._id);

    if (!dept) {
        console.log('❌ Aucun département trouvé');
        await client.close();
        return;
    }

    // Test 1: Query SANS filtre département (tous les documents deleted=false)
    console.log('\n🟠 Test 1: Query sans filtre département');
    const start1 = Date.now();
    const docs1 = await db.collection('documents').find({
        deleted: false
    }).limit(10).toArray();
    const time1 = Date.now() - start1;
    console.log(`   Temps: ${time1}ms (${docs1.length} docs)`);

    // Test 2: Query AVEC index (idDepartement + deleted)
    console.log('\n🟢 Test 2: Query AVEC index (idDepartement + deleted)');
    const start2 = Date.now();
    const docs2 = await db.collection('documents').find({
        idDepartement: dept._id,
        deleted: false
    }).toArray();
    const time2 = Date.now() - start2;
    console.log(`   Temps: ${time2}ms (${docs2.length} docs)`);

    // Test 3: Explain pour voir si l'index est utilisé
    console.log('\n📊 Analyse de la requête (explain):');
    const explain = await db.collection('documents').find({
        idDepartement: dept._id,
        deleted: false
    }).explain('executionStats');

    console.log('   Index utilisé:', explain.executionStats.executionStages.inputStage?.indexName || 'COLLECTION SCAN (pas d\'index!)');
    console.log('   Documents examinés:', explain.executionStats.totalDocsExamined);
    console.log('   Documents retournés:', explain.executionStats.nReturned);

    await client.close();

    console.log('\n📊 RÉSULTAT:');
    console.log(`   Sans index: ${time1}ms`);
    console.log(`   Avec index: ${time2}ms`);

    if (time2 < 200) {
        console.log('   ✅ Performance EXCELLENTE avec index!');
    } else if (time2 < 1000) {
        console.log('   ⚠️ Performance CORRECTE mais peut être améliorée');
    } else {
        console.log('   🚨 Performance MÉDIOCRE - Index pas utilisé correctement');
    }
}

testIndexUsage().catch(console.error);
