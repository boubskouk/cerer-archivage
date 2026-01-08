// ============================================
// GÉNÉRATEUR D'ID UNIQUE POUR LES DOCUMENTS
// ============================================

/**
 * Génère un ID UNIQUE avec HMST (Heure-Minute-Seconde-Tierce)
 * Format: DOC-YYYYMMDD-HHMMSSTTT-RRRR
 * - YYYYMMDD: Date complète
 * - HH: Heures (00-23)
 * - MM: Minutes (00-59)
 * - SS: Secondes (00-59)
 * - TTT: Millisecondes (000-999) - "Tierce"
 * - RRRR: Identifiant aléatoire sur 4 chiffres pour garantir l'unicité absolue
 *
 * @param {Collection} documentsCollection - Collection MongoDB des documents
 * @returns {Promise<string>} - ID unique généré
 */
async function generateDocumentId(documentsCollection) {
    let attempts = 0;
    const maxAttempts = 10;

    while (attempts < maxAttempts) {
        const now = new Date();

        // Date: YYYYMMDD
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        const datePrefix = `${year}${month}${day}`;

        // Heure: HHMMSSTTT (Heure-Minute-Seconde-Tierce/Millisecondes)
        const hours = String(now.getHours()).padStart(2, '0');
        const minutes = String(now.getMinutes()).padStart(2, '0');
        const seconds = String(now.getSeconds()).padStart(2, '0');
        const milliseconds = String(now.getMilliseconds()).padStart(3, '0');
        const hmst = `${hours}${minutes}${seconds}${milliseconds}`;

        // Identifiant aléatoire pour garantir l'unicité absolue
        const randomId = String(Math.floor(Math.random() * 10000)).padStart(4, '0');

        const documentId = `DOC-${datePrefix}-${hmst}-${randomId}`;

        // Vérifier que cet ID n'existe pas déjà dans la base
        const existingDoc = await documentsCollection.findOne({ idDocument: documentId });

        if (!existingDoc) {
            console.log(`✅ ID unique généré: ${documentId}`);
            return documentId;
        }

        // Si collision (très rare), réessayer
        attempts++;
        console.log(`⚠️ Collision ID document (tentative ${attempts}/${maxAttempts})`);

        // Petite pause pour éviter les collisions en rafale
        await new Promise(resolve => setTimeout(resolve, 10));
    }

    // Si après 10 tentatives on n'a pas trouvé d'ID unique, utiliser timestamp + UUID partiel
    const timestamp = Date.now();
    const uuid = Math.random().toString(36).substring(2, 8).toUpperCase();
    const fallbackId = `DOC-${timestamp}-${uuid}`;
    console.log(`⚠️ Utilisation ID de secours: ${fallbackId}`);
    return fallbackId;
}

module.exports = {
    generateDocumentId
};
