// Script de test de latence MongoDB
require('dotenv').config();
const { MongoClient } = require('mongodb');

async function testLatency() {
    console.log('🔍 Test de latence MongoDB...');
    console.log('📍 URI:', process.env.MONGODB_URI.replace(/\/\/([^:]+):([^@]+)@/, '//***:***@'));

    const client = await MongoClient.connect(process.env.MONGODB_URI);
    const db = client.db('cerer_archivage');

    // Test 1: Ping simple
    console.log('\n🏓 Test 1: Ping simple');
    const start1 = Date.now();
    await db.admin().ping();
    const latency1 = Date.now() - start1;
    console.log(`✅ Latency: ${latency1}ms`);

    // Test 2: Query simple
    console.log('\n📄 Test 2: Query simple (1 document)');
    const start2 = Date.now();
    await db.collection('users').findOne({});
    const latency2 = Date.now() - start2;
    console.log(`✅ Latency: ${latency2}ms`);

    // Test 3: Query avec filtre OPTIMISÉE (évite $ne)
    console.log('\n🔍 Test 3: Query avec filtre OPTIMISÉE');
    const start3 = Date.now();
    const docs = await db.collection('documents').find({
        $or: [{ deleted: false }, { deleted: { $exists: false } }]
    }).limit(10).toArray();
    const latency3 = Date.now() - start3;
    console.log(`✅ Latency: ${latency3}ms (${docs.length} documents)`);

    // Test 4: Info serveur (optionnel)
    console.log('\n🌍 Informations serveur MongoDB:');
    try {
        const serverStatus = await db.admin().serverStatus();
        console.log('   Host:', serverStatus.host);
        console.log('   Version:', serverStatus.version);
    } catch (error) {
        console.log('   ⚠️ ServerStatus non disponible (permissions limitées)');
    }

    await client.close();

    console.log('\n📊 RÉSUMÉ:');
    console.log(`   Ping: ${latency1}ms`);
    console.log(`   Query simple: ${latency2}ms`);
    console.log(`   Query avec filtre: ${latency3}ms`);

    if (latency1 > 200) {
        console.log('\n⚠️  LATENCE ÉLEVÉE (>200ms) - MongoDB probablement dans une autre région que Render!');
    } else {
        console.log('\n✅ Latence normale - Le problème vient d\'ailleurs');
    }
}

testLatency().catch(console.error);
