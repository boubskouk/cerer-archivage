// Test final de performance avec projection
require('dotenv').config();
const { MongoClient, ObjectId } = require('mongodb');

async function testFinalPerformance() {
    console.log('🎯 TEST FINAL DE PERFORMANCE\n');

    const client = await MongoClient.connect(process.env.MONGODB_URI);
    const db = client.db('cerer_archivage');

    // Récupérer un département
    const dept = await db.collection('departements').findOne({});

    console.log('📋 Test avec département:', dept?.nom);
    console.log('🆔 ID:', dept?._id);

    // Test 1: AVEC contenu (comme avant)
    console.log('\n🔴 Test 1: AVEC contenu (fichiers complets)');
    const start1 = Date.now();
    const docsWithContent = await db.collection('documents').find({
        idDepartement: dept._id,
        deleted: false
    }).toArray();
    const time1 = Date.now() - start1;

    // Calculer la taille totale
    const size1 = JSON.stringify(docsWithContent).length;
    console.log(`   ⏱️  Temps: ${time1}ms`);
    console.log(`   📦 Taille: ${(size1 / 1024).toFixed(2)} KB`);
    console.log(`   📄 Documents: ${docsWithContent.length}`);

    // Test 2: SANS contenu (avec projection)
    console.log('\n🟢 Test 2: SANS contenu (métadonnées seulement)');
    const start2 = Date.now();
    const docsWithoutContent = await db.collection('documents').find({
        idDepartement: dept._id,
        deleted: false
    }, {
        projection: { contenu: 0 }
    }).toArray();
    const time2 = Date.now() - start2;

    // Calculer la taille totale
    const size2 = JSON.stringify(docsWithoutContent).length;
    console.log(`   ⏱️  Temps: ${time2}ms`);
    console.log(`   📦 Taille: ${(size2 / 1024).toFixed(2)} KB`);
    console.log(`   📄 Documents: ${docsWithoutContent.length}`);

    await client.close();

    // Résumé
    console.log('\n📊 COMPARAISON:');
    console.log(`   Avec contenu:    ${time1}ms - ${(size1 / 1024).toFixed(2)} KB`);
    console.log(`   Sans contenu:    ${time2}ms - ${(size2 / 1024).toFixed(2)} KB`);
    console.log(`   Gain de temps:   ${time1 - time2}ms (${((1 - time2/time1) * 100).toFixed(1)}% plus rapide)`);
    console.log(`   Gain de taille:  ${((size1 - size2) / 1024).toFixed(2)} KB (${((1 - size2/size1) * 100).toFixed(1)}% plus léger)`);

    if (time2 < 500) {
        console.log('\n✅ Performance EXCELLENTE! (<500ms)');
    } else if (time2 < 1000) {
        console.log('\n⚠️  Performance CORRECTE mais peut être améliorée');
    } else {
        console.log('\n🚨 Performance toujours MÉDIOCRE');
    }
}

testFinalPerformance().catch(console.error);
