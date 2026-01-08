// ============================================
// API CLIENT - ARCHIVAGE C.E.R.E.R
// ============================================

// Configuration de l'URL de l'API
const API_URL = (() => {
    const h = window.location.hostname;
    const protocol = window.location.protocol;

    // Si localhost, utiliser http://localhost:4000
    if (h === 'localhost' || h === '127.0.0.1') {
        return 'http://localhost:4000/api';
    }

    // En production, utiliser le même protocole et host que la page actuelle
    return `${protocol}//${h}/api`;
})();

// Fonction générique pour les appels API
async function apiCall(endpoint, method = 'GET', data = null) {
    try {
        const options = {
            method,
            headers: {
                'Content-Type': 'application/json'
            }
        };

        if (data) {
            options.body = JSON.stringify(data);
        }

        const response = await fetch(`${API_URL}${endpoint}`, options);

        // Vérifier si la réponse est du JSON
        const contentType = response.headers.get('content-type');
        if (!contentType || !contentType.includes('application/json')) {
            throw new Error(`Erreur serveur: la réponse n'est pas du JSON (${response.status})`);
        }

        const result = await response.json();

        if (!response.ok) {
            const error = new Error(result.message || 'Erreur lors de la requête');
            error.response = result; // Garder les détails de la réponse
            throw error;
        }

        return result;
    } catch (error) {
        Logger.error('Erreur API:', error);
        // Ne pas afficher de notification pour les documents verrouillés
        if (!error.response || !error.response.locked) {
            showNotification(error.message, 'error');
        }
        throw error;
    }
}

// ============================================
// APPELS API SPÉCIFIQUES
// ============================================

// Documents
async function getDocuments(userId, full = false) {
    return await apiCall(`/documents/${userId}?full=${full}`);
}

async function getDocument(userId, docId) {
    try {
        return await apiCall(`/documents/${userId}/${docId}`);
    } catch (error) {
        // Si c'est une erreur de verrouillage, afficher un modal spécifique
        if (error.response && error.response.locked) {
            if (typeof showLockedDocumentModal === 'function') {
                showLockedDocumentModal(error.response.lockedBy);
            }
        }
        throw error;
    }
}

async function createDocument(userId, documentData) {
    return await apiCall('/documents', 'POST', { userId, ...documentData });
}

async function deleteDocument(userId, docId) {
    return await apiCall(`/documents/${userId}/${docId}`, 'DELETE');
}

async function deleteAllDocuments(userId) {
    return await apiCall(`/documents/${userId}/delete-all`, 'DELETE');
}

async function bulkImportDocuments(userId, documents) {
    return await apiCall('/documents/bulk', 'POST', { userId, documents });
}

// Catégories
async function getCategories(userId) {
    return await apiCall(`/categories/${userId}`);
}

async function createCategory(userId, categoryData) {
    return await apiCall('/categories', 'POST', { userId, ...categoryData });
}

async function deleteCategory(userId, catId) {
    return await apiCall(`/categories/${userId}/${catId}`, 'DELETE');
}

// Authentification
async function loginUser(username, password) {
    return await apiCall('/login', 'POST', { username, password });
}

async function registerUser(username, password, nom, email, idRole, idDepartement) {
    return await apiCall('/register', 'POST', {
        username,
        password,
        nom,
        email,
        idRole,
        idDepartement
    });
}

// Rôles et Départements
async function getRoles() {
    return await apiCall('/roles');
}

async function getDepartements() {
    return await apiCall('/departements');
}

async function getUserInfo(username) {
    return await apiCall(`/users/${username}`);
}

// ============================================
// DEMANDES DE SUPPRESSION (NOUVEAU)
// ============================================

// Récupérer les demandes de suppression en attente (niveau 1 uniquement)
async function getDeletionRequests(userId) {
    return await apiCall(`/deletion-requests/${userId}`);
}

// Approuver une demande de suppression (niveau 1 uniquement)
async function approveDeletionRequest(requestId, userId) {
    return await apiCall(`/deletion-requests/${requestId}/approve`, 'POST', { userId });
}

// Rejeter une demande de suppression (niveau 1 uniquement)
async function rejectDeletionRequest(requestId, userId, motifRejet) {
    return await apiCall(`/deletion-requests/${requestId}/reject`, 'POST', { userId, motifRejet });
}

// Récupérer l'historique des demandes
async function getDeletionRequestHistory(userId) {
    return await apiCall(`/deletion-requests/${userId}/history`);
}

// Enregistrer un téléchargement
async function recordDownload(userId, docId) {
    return await apiCall(`/documents/${userId}/${docId}/download`, 'POST');
}