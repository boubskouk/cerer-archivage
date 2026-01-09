// Vérifier la taille des documents
require('dotenv').config();
const { MongoClient } = require('mongodb');

async function checkSizes() {
    const client = await MongoClient.connect(process.env.MONGODB_URI);
    const db = client.db('cerer_archivage');

    // Compter les documents
    const count = await db.collection('documents').countDocuments({});
    console.log('📊 Statistiques de la collection documents:');
    console.log(`   Nombre de documents: ${count}`);

    // Récupérer quelques documents pour voir leur structure
    const samples = await db.collection('documents').find({}).limit(5).toArray();
    console.log('\n📄 Structure des documents:');
    samples.forEach((doc, i) => {
        const docSize = JSON.stringify(doc).length;
        console.log(`   ${i+1}. ${doc.idDocument}: ${(docSize / 1024).toFixed(2)} KB`);
        console.log(`      - Champs: ${Object.keys(doc).join(', ')}`);
        if (doc.fileData) {
            console.log(`      ⚠️ Contient fileData de ${(doc.fileData.length / 1024).toFixed(2)} KB`);
        }
    });

    await client.close();
}

checkSizes().catch(console.error);
