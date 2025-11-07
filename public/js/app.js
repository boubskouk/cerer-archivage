// ===== CONFIGURATION =====

// Configuration de l'URL de l'API (si non définie par api.js)
if (typeof API_URL === 'undefined') {
    window.API_URL = (() => {
        const h = window.location.hostname;
        const protocol = window.location.protocol;

        // Si localhost, utiliser http://localhost:4000
        if (h === 'localhost' || h === '127.0.0.1') {
            return 'http://localhost:4000/api';
        }

        // En production, utiliser le même protocole et host que la page actuelle
        return `${protocol}//${h}/api`;
    })();
}

// État de l'application
const state = {
    documents: [],
    categories: [],
    roles: [], // NOUVEAU : Liste des rôles
    departements: [], // NOUVEAU : Liste des départements
    searchTerm: '',
    selectedCategory: 'tous',
    selectedDepartement: 'tous',
    dateFrom: '',
    dateTo: '',
    dateType: 'document',
    tempSearchTerm: '',
    tempSelectedCategory: 'tous',
    tempSelectedDepartement: 'tous',
    tempDateFrom: '',
    tempDateTo: '',
    tempDateType: 'document',
    selectedDoc: null,
    showUploadForm: false,
    showMenu: false,
    showCategories: false,
    editingCategory: null, // Catégorie en cours de modification
    showDepartements: false,
    editingDepartement: null, // Département en cours de modification
    showDeletionRequests: false,
    deletionRequests: [],
    showDeleteConfirm: false,
    isAuthenticated: false,
    currentUser: null,
    currentUserInfo: null, // Informations complètes de l'utilisateur (nom, rôle, niveau)
    showRegister: false,
    storageInfo: { usedMB: 0, totalMB: 1000, percentUsed: 0 },
    loading: false,
    importProgress: { show: false, current: 0, total: 0, message: '' },
    sortBy: '', // Tri par défaut (par date de création)
    showFilters: false, // NOUVEAU : Affichage du panneau de filtres
    showShareModal: false, // NOUVEAU : Modal de partage
    shareAvailableUsers: [], // NOUVEAU : Utilisateurs disponibles pour le partage
    shareSelectedUsers: [], // NOUVEAU : Utilisateurs sélectionnés pour le partage
    shareSearchTerm: '', // NOUVEAU : Terme de recherche pour filtrer les utilisateurs
    messages: [], // NOUVEAU : Messages de la boîte de réception
    showMessages: false, // NOUVEAU : Affichage de la boîte de réception
    unreadCount: 0, // NOUVEAU : Nombre de messages non lus
    showComposeMessage: false, // NOUVEAU : Afficher le formulaire de composition
    composeMessageTo: '', // NOUVEAU : Destinataire du message
    composeMessageSubject: '', // NOUVEAU : Sujet du message
    composeMessageBody: '', // NOUVEAU : Corps du message
    allUsers: [], // NOUVEAU : Liste de tous les utilisateurs pour composition
    showMessagingSection: false // NOUVEAU : Afficher la section messagerie dans la page principale
};

// Données du formulaire
let formData = {
    titre: '',
    categorie: 'factures',
    date: new Date().toISOString().split('T')[0],
    departementArchivage: '', // Département d'archivage
    description: '',
    tags: ''
};

// ===== FONCTIONS API =====
async function apiCall(endpoint, method = 'GET', data = null) {
    state.loading = true; 
    render();
    try {
        const options = { 
            method, 
            headers: { 'Content-Type': 'application/json' } 
        };
        if (data) options.body = JSON.stringify(data);
        const response = await fetch(`${API_URL}${endpoint}`, options);
        const result = await response.json();
        if (!response.ok) throw new Error(result.message || 'Erreur');
        return result;
    } catch (error) {
        showNotification(error.message, 'error');
        throw error;
    } finally {
        state.loading = false; 
        render();
    }
}

// ===== AUTHENTIFICATION =====
async function login(username, password) {
    try {
        const result = await apiCall('/login', 'POST', { username, password });
        if (result.success) {
            state.currentUser = username;
            state.currentUserInfo = result.user; // Stocker les infos complètes (nom, rôle, niveau)
            state.isAuthenticated = true;
            await loadData();
            showNotification(`✅ Bienvenue ${result.user.nom}!`);
            return true;
        }
    } catch (error) {
        return false;
    }
}

async function register(username, password, nom, email, idRole, idDepartement, adminPassword) {
    if (adminPassword !== '0811') {
        showNotification('Mot de passe admin incorrect', 'error');
        return false;
    }
    try {
        const result = await apiCall('/register', 'POST', {
            username,
            password,
            nom,
            email,
            idRole,
            idDepartement
        });
        if (result.success) {
            showNotification('✅ Compte créé!');
            return true;
        }
    } catch (error) {
        return false;
    }
}

function logout() {
    if (confirm('Se déconnecter?')) {
        state.currentUser = null;
        state.currentUserInfo = null;
        state.isAuthenticated = false;
        state.documents = [];
        state.categories = [];
        showNotification('Déconnexion');
        render();
    }
}

// ===== GESTION DES DONNÉES =====
async function loadData() {
    if (!state.currentUser) return;
    try {
        const docs = await apiCall(`/documents/${state.currentUser}?full=false`);
        state.documents = docs;
        const cats = await apiCall(`/categories/${state.currentUser}`);
        state.categories = cats;
        calculateStorageUsage();
        await updateUnreadCount(); // ✅ NOUVEAU: Charger le compteur de messages non lus
        render();
    } catch (error) {
        state.loading = false;
        render();
    }
}

// NOUVEAU : Charger les rôles et départements
async function loadRolesAndDepartements() {
    try {
        const roles = await apiCall('/roles');
        state.roles = roles;
        const departements = await apiCall('/departements');
        state.departements = departements;
        render();
    } catch (error) {
        console.error('Erreur chargement rôles/départements:', error);
    }
}

async function saveDocument(doc) {
    const result = await apiCall('/documents', 'POST', { userId: state.currentUser, ...doc });
    if (result.success) {
        await loadData();
        return result.document;
    }
}

async function deleteDoc(id) {
    if (!confirm('Supprimer?')) return;
    await apiCall(`/documents/${state.currentUser}/${id}`, 'DELETE');
    state.selectedDoc = null;
    await loadData();
    showNotification('Supprimé');
}

// ===== DEMANDE DE SUPPRESSION (pour niveau 2) =====
async function requestDeletion(docId) {
    if (!confirm('Envoyer une demande de suppression au niveau 1 de votre département ?')) return;

    try {
        const result = await apiCall('/api/deletion-requests', 'POST', {
            documentId: docId,
            requestedBy: state.currentUser
        });

        if (result.success) {
            showNotification('✅ Demande de suppression envoyée au niveau 1');
            state.selectedDoc = null;
            render();
        }
    } catch (error) {
        showNotification('❌ Erreur lors de l\'envoi de la demande', 'error');
    }
}

// ===== GESTION DES DEMANDES (pour niveau 1) =====
async function showDeletionRequests() {
    try {
        const requests = await apiCall(`/api/deletion-requests/${state.currentUser}`);
        state.deletionRequests = requests;
        state.showDeletionRequests = true;
        state.showMenu = false;
        render();
    } catch (error) {
        showNotification('❌ Erreur lors du chargement des demandes', 'error');
    }
}

function closeDeletionRequests() {
    state.showDeletionRequests = false;
    render();
}

async function approveDeletion(requestId) {
    if (!confirm('Approuver cette demande de suppression ? Le document sera définitivement supprimé.')) return;

    try {
        const result = await apiCall(`/api/deletion-requests/${requestId}/approve`, 'PUT', {
            approvedBy: state.currentUser
        });

        if (result.success) {
            showNotification('✅ Document supprimé avec succès');
            await showDeletionRequests(); // Recharger la liste
            await loadData(); // Recharger les documents
        }
    } catch (error) {
        showNotification('❌ Erreur lors de l\'approbation', 'error');
    }
}

async function rejectDeletion(requestId) {
    const reason = prompt('Raison du rejet (optionnel):');
    if (reason === null) return; // Annulé

    try {
        const result = await apiCall(`/api/deletion-requests/${requestId}/reject`, 'PUT', {
            rejectedBy: state.currentUser,
            reason: reason || 'Aucune raison fournie'
        });

        if (result.success) {
            showNotification('✅ Demande rejetée');
            await showDeletionRequests(); // Recharger la liste
        }
    } catch (error) {
        showNotification('❌ Erreur lors du rejet', 'error');
    }
}

async function deleteAllDocuments() {
    const count = state.documents.length;
    if (count === 0) {
        showNotification('Aucun document à supprimer', 'error');
        return;
    }
    
    state.showDeleteConfirm = true;
    render();
}

async function confirmDeleteAll() {
    console.log('🗑️ Tentative de suppression pour:', state.currentUser);
    console.log('📊 Documents actuels:', state.documents.length);

    try {
        const result = await apiCall(`/documents/${state.currentUser}/delete-all`, 'DELETE');
        console.log('✅ Réponse du serveur:', result);

        state.showMenu = false;
        state.showDeleteConfirm = false;
        showNotification(`✅ ${result.deletedCount} document(s) supprimé(s)!`);
        await loadData();
    } catch (error) {
        console.error('❌ Erreur lors de la suppression:', error);
        showNotification('Erreur suppression', 'error');
        state.showDeleteConfirm = false;
        render();
    }
}

function cancelDeleteAll() {
    state.showDeleteConfirm = false;
    render();
}

// ===== GESTION DES CATÉGORIES =====
async function addCategory() {
    const nom = document.getElementById('new_cat_nom').value.trim();
    const couleur = document.getElementById('new_cat_couleur').value;
    const icon = document.getElementById('new_cat_icon').value || '📁';
    if (!nom || nom.length < 2) return showNotification('Nom invalide', 'error');
    const id = nom.toLowerCase().replace(/[^a-z0-9]/g, '_');
    await apiCall('/categories', 'POST', { userId: state.currentUser, id, nom, couleur, icon });
    await loadData();
    showNotification('✅ Catégorie ajoutée');
    document.getElementById('new_cat_nom').value = '';
    document.getElementById('new_cat_icon').value = '';
}

async function deleteCategory(catId) {
    const count = state.documents.filter(d => d.categorie === catId).length;
    if (count > 0 && !confirm(`${count} documents seront déplacés vers "Autre"`)) return;
    await apiCall(`/categories/${state.currentUser}/${catId}`, 'DELETE');
    await loadData();
    showNotification('Catégorie supprimée');
}

function startEditCategory(catId) {
    const category = state.categories.find(c => c.id === catId);
    if (category) {
        state.editingCategory = { ...category };
        render();
    }
}

function cancelEditCategory() {
    state.editingCategory = null;
    render();
}

async function saveEditCategory() {
    if (!state.editingCategory) return;

    const nom = document.getElementById('edit_cat_nom').value.trim();
    const couleur = document.getElementById('edit_cat_couleur').value;
    const icon = document.getElementById('edit_cat_icon').value.trim() || '📁';

    if (!nom || nom.length < 2) {
        showNotification('Nom invalide', 'error');
        return;
    }

    await apiCall(`/categories/${state.currentUser}/${state.editingCategory.id}`, 'PUT', { nom, couleur, icon });
    await loadData();
    state.editingCategory = null;
    showNotification('✅ Catégorie modifiée');
}

// ===== GESTION DES DÉPARTEMENTS =====
async function addDepartement() {
    const nom = document.getElementById('new_dept_nom').value.trim();
    const code = document.getElementById('new_dept_code').value.trim();

    if (!nom || !code) {
        showNotification('❌ Nom et code requis', 'error');
        return;
    }

    await apiCall('/api/departements', 'POST', { nom, code });
    await loadRolesAndDepartements();
    showNotification('✅ Département créé');
    document.getElementById('new_dept_nom').value = '';
    document.getElementById('new_dept_code').value = '';
}

async function deleteDepartement(deptId) {
    if (!confirm('Supprimer ce département ?')) return;
    await apiCall(`/api/departements/${deptId}`, 'DELETE');
    await loadRolesAndDepartements();
    showNotification('✅ Département supprimé');
}

function startEditDepartement(deptId) {
    const dept = state.departements.find(d => d._id === deptId);
    if (!dept) return;
    state.editingDepartement = { ...dept };
    render();
}

function cancelEditDepartement() {
    state.editingDepartement = null;
    render();
}

async function saveEditDepartement() {
    if (!state.editingDepartement) return;

    const nom = document.getElementById('edit_dept_nom').value.trim();
    const code = document.getElementById('edit_dept_code').value.trim();

    if (!nom || !code) {
        showNotification('❌ Nom et code requis', 'error');
        return;
    }

    await apiCall(`/api/departements/${state.editingDepartement._id}`, 'PUT', { nom, code });
    await loadRolesAndDepartements();
    state.editingDepartement = null;
    showNotification('✅ Département modifié');
}

// ===== UTILITAIRES =====
function calculateStorageUsage() {
    let totalBytes = 0;
    state.documents.forEach(doc => { 
        if (doc.taille) totalBytes += doc.taille; 
    });
    const usedMB = totalBytes / (1024 * 1024);
    state.storageInfo = {
        usedMB: usedMB.toFixed(2), 
        totalMB: 1000,
        percentUsed: ((usedMB / 1000) * 100).toFixed(1)
    };
}

function formatDate(dateStr) {
    if (!dateStr) return 'N/A';
    try {
        const parts = dateStr.split('T')[0].split('-');
        if (parts.length === 3) {
            const [year, month, day] = parts;
            return `${day}/${month}/${year}`;
        }
        const date = new Date(dateStr + 'T00:00:00');
        if (isNaN(date.getTime())) return dateStr;
        const day = String(date.getDate()).padStart(2, '0');
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const year = date.getFullYear();
        return `${day}/${month}/${year}`;
    } catch (e) {
        return dateStr;
    }
}

function formatSize(bytes) {
    if (!bytes) return '0 B';
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${(bytes / Math.pow(1024, i)).toFixed(2)} ${sizes[i]}`;
}

function showNotification(message, type = 'success') {
    const notif = document.createElement('div');
    notif.className = `fixed top-4 right-4 z-50 px-6 py-4 rounded-xl shadow-2xl animate-fade-in font-semibold ${
        type === 'error' ? 'bg-red-500 text-white' : 
        type === 'warning' ? 'bg-yellow-500 text-white' : 
        'bg-green-500 text-white'
    }`;
    notif.textContent = message;
    document.body.appendChild(notif);
    setTimeout(() => notif.remove(), 3000);
}

async function compressImage(file) {
    return new Promise((resolve) => {
        if (!file.type.startsWith('image/')) {
            const reader = new FileReader();
            reader.onload = (e) => resolve(e.target.result);
            reader.readAsDataURL(file);
            return;
        }
        
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                let width = img.width;
                let height = img.height;
                const maxSize = 1920;
                
                if (width > height && width > maxSize) {
                    height = (height * maxSize) / width;
                    width = maxSize;
                } else if (height > maxSize) {
                    width = (width * maxSize) / height;
                    height = maxSize;
                }
                
                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);
                resolve(canvas.toDataURL('image/jpeg', 0.8));
            };
            img.src = e.target.result;
        };
        reader.readAsDataURL(file);
    });
}

// ===== GESTION DES FICHIERS =====
async function handleFileUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!formData.titre.trim()) {
        showNotification('Titre requis', 'error');
        e.target.value = '';
        return;
    }

    // Validation des extensions autorisées
    const allowedExtensions = [
        // Documents
        '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.txt',
        '.odt', '.ods', '.odp', '.rtf', '.csv',
        // Images
        '.jpg', '.jpeg', '.png', '.gif', '.bmp', '.svg', '.webp',
        // Archives (optionnel)
        '.zip', '.rar'
    ];

    const fileName = file.name.toLowerCase();
    const isAllowed = allowedExtensions.some(ext => fileName.endsWith(ext));

    if (!isAllowed) {
        const ext = fileName.substring(fileName.lastIndexOf('.'));
        showNotification(`❌ Extension "${ext}" non autorisée. Seuls les documents, images et archives sont acceptés.`, 'error');
        e.target.value = '';
        return;
    }

    // Bloquer explicitement les vidéos et audio
    const blockedExtensions = ['.mp4', '.avi', '.mov', '.mkv', '.flv', '.wmv', '.webm',
                               '.mp3', '.wav', '.ogg', '.m4a', '.exe', '.bat', '.sh', '.msi'];
    const isBlocked = blockedExtensions.some(ext => fileName.endsWith(ext));

    if (isBlocked) {
        const ext = fileName.substring(fileName.lastIndexOf('.'));
        showNotification(`🚫 Les fichiers ${ext} (vidéos, audio, exécutables) ne sont pas autorisés`, 'error');
        e.target.value = '';
        return;
    }

    if (file.size > 50 * 1024 * 1024) {
        showNotification('Max 50 MB', 'error');
        e.target.value = '';
        return;
    }
    showNotification('📤 Traitement...', 'warning');
    const contenu = await compressImage(file);
    const newDoc = { 
        ...formData, 
        nomFichier: file.name, 
        taille: file.size, 
        type: file.type, 
        contenu 
    };
    await saveDocument(newDoc);
    state.showUploadForm = false;
    formData = {
        titre: '',
        categorie: 'factures',
        date: new Date().toISOString().split('T')[0],
        departementArchivage: '',
        description: '',
        tags: ''
    };
    showNotification('✅ Ajouté!');
    render();
    e.target.value = '';
}

async function downloadDoc(doc) {
    try {
        // Récupérer le document complet
        const fullDoc = await apiCall(`/documents/${state.currentUser}/${doc._id}`);

        // Enregistrer le téléchargement dans l'historique
        await apiCall(`/documents/${state.currentUser}/${doc._id}/download`, 'POST');

        // Télécharger le fichier
        const link = document.createElement('a');
        link.href = fullDoc.contenu;
        link.download = fullDoc.nomFichier;
        link.click();

        showNotification('📥 Téléchargement en cours...');

        // Recharger les données pour mettre à jour les informations de téléchargement
        await loadData();
    } catch (error) {
        console.error('Erreur téléchargement:', error);
        showNotification('Erreur lors du téléchargement', 'error');
    }
}

// ===== IMPORT/EXPORT =====
async function exportData() {
    const data = { 
        version: '2.3', 
        exportDate: new Date().toISOString(), 
        user: state.currentUser, 
        documents: state.documents, 
        categories: state.categories 
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `cerer_${state.currentUser}_${new Date().toISOString().split('T')[0]}.json`;
    link.click();
    URL.revokeObjectURL(url);
    showNotification('✅ Exporté');
}

async function importData(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 100 * 1024 * 1024) {
        showNotification('Max 100 MB', 'error');
        e.target.value = '';
        return;
    }
    const reader = new FileReader();
    reader.onload = async (event) => {
        try {
            const imported = JSON.parse(event.target.result);
            const docs = Array.isArray(imported) ? imported : imported.documents || [];
            if (docs.length === 0) return showNotification('Aucun document', 'error');
            if (docs.length > 1000) return showNotification('Max 1000', 'error');
            if (!confirm(`Importer ${docs.length} documents?`)) return;
            state.importProgress = { 
                show: true, 
                current: 0, 
                total: docs.length, 
                message: 'Import...' 
            };
            render();
            const result = await apiCall('/documents/bulk', 'POST', { 
                userId: state.currentUser, 
                documents: docs 
            });
            await loadData();
            state.importProgress = { 
                show: false, 
                current: 0, 
                total: 0, 
                message: '' 
            };
            showNotification(`✅ ${result.insertedCount} importés!`);
        } catch (error) {
            state.importProgress = { 
                show: false, 
                current: 0, 
                total: 0, 
                message: '' 
            };
            showNotification('Erreur', 'error');
        }
    };
    reader.readAsText(file);
    e.target.value = '';
}

// ===== FONCTIONS DE FORMATAGE =====
function getCategoryColor(id) { 
    return state.categories.find(c => c.id === id)?.couleur || 'bg-gray-100 text-gray-800'; 
}

function getCategoryName(id) { 
    return state.categories.find(c => c.id === id)?.nom || id; 
}

function getCategoryIcon(id) { 
    return state.categories.find(c => c.id === id)?.icon || '📁'; 
}

// ===== NOUVEAU : TRI DES DOCUMENTS =====
function sortDocuments(docs) {
    const sorted = [...docs];

    switch(state.sortBy) {
        case 'date_desc':
            return sorted.sort((a, b) => {
                const dateA = a.date ? new Date(a.date) : new Date(0);
                const dateB = b.date ? new Date(b.date) : new Date(0);
                return dateB - dateA;
            });
        case 'date_asc':
            return sorted.sort((a, b) => {
                const dateA = a.date ? new Date(a.date) : new Date(0);
                const dateB = b.date ? new Date(b.date) : new Date(0);
                return dateA - dateB;
            });
        case 'titre_asc':
            return sorted.sort((a, b) => (a.titre || '').localeCompare(b.titre || ''));
        case 'titre_desc':
            return sorted.sort((a, b) => (b.titre || '').localeCompare(a.titre || ''));
        case 'taille_desc':
            return sorted.sort((a, b) => (b.taille || 0) - (a.taille || 0));
        case 'taille_asc':
            return sorted.sort((a, b) => (a.taille || 0) - (b.taille || 0));
        default:
            // Par défaut, tri par date de création (createdAt)
            return sorted.sort((a, b) => {
                const dateA = a.createdAt ? new Date(a.createdAt) : new Date(0);
                const dateB = b.createdAt ? new Date(b.createdAt) : new Date(0);
                return dateB - dateA;
            });
    }
}

function getFilteredDocs() {
    let filtered = state.documents.filter(doc => {
        // ✅ Recherche améliorée : ID du document, titre, description ou tags
        const searchLower = state.searchTerm.toLowerCase();
        const matchSearch = !state.searchTerm ||
            (doc.idDocument && doc.idDocument.toLowerCase().includes(searchLower)) ||
            doc.titre.toLowerCase().includes(searchLower) ||
            (doc.description && doc.description.toLowerCase().includes(searchLower)) ||
            (doc.tags && doc.tags.toLowerCase().includes(searchLower));

        const matchCategory = state.selectedCategory === 'tous' ||
            doc.categorie === state.selectedCategory;

        const matchDepartement = state.selectedDepartement === 'tous' ||
            doc.departementArchivage === state.selectedDepartement;

        let matchDate = true;
        if (state.dateFrom || state.dateTo) {
            const dateToCheck = state.dateType === 'ajout' ? doc.createdAt : doc.date;

            if (state.dateFrom) {
                matchDate = matchDate && new Date(dateToCheck) >= new Date(state.dateFrom);
            }
            if (state.dateTo) {
                matchDate = matchDate && new Date(dateToCheck) <= new Date(state.dateTo + 'T23:59:59');
            }
        }

        return matchSearch && matchCategory && matchDepartement && matchDate;
    });

    // ✅ Tri par date d'ajout : Plus récent en haut
    filtered.sort((a, b) => {
        const dateA = a.createdAt ? new Date(a.createdAt) : new Date(0);
        const dateB = b.createdAt ? new Date(b.createdAt) : new Date(0);
        return dateB - dateA; // Décroissant (plus récent en premier)
    });

    return filtered;
}

// ===== NOUVEAU : PRÉVISUALISATION DOCUMENT =====
async function showDocDetail(id) {
    const doc = state.documents.find(d => d._id === id);
    if (!doc) return;
    
    // Charger le contenu complet du document
    const fullDoc = await apiCall(`/documents/${state.currentUser}/${id}`);
    state.selectedDoc = fullDoc;
    render();
}

// ===== ACTIONS UI =====
function closeDocDetail() { 
    state.selectedDoc = null; 
    render(); 
}

function toggleMenu() { 
    state.showMenu = !state.showMenu; 
    render(); 
}

function toggleUploadForm() { 
    state.showUploadForm = !state.showUploadForm; 
    state.showCategories = false; 
    render(); 
}

function toggleCategories() {
    state.showCategories = !state.showCategories;
    state.showUploadForm = false;
    state.showDepartements = false;
    render();
}

function toggleDepartements() {
    state.showDepartements = !state.showDepartements;
    state.showUploadForm = false;
    state.showCategories = false;
    render();
}

function toggleRegister() {
    state.showRegister = !state.showRegister;
    render();
}

// ===== PARTAGE DE DOCUMENTS =====
async function openShareModal(docId) {
    try {
        // Charger TOUS les utilisateurs de TOUS les départements (sauf l'utilisateur actuel)
        const allUsers = await apiCall('/api/users');
        // Filtrer pour exclure l'utilisateur actuel
        const users = allUsers.filter(u => u.username !== state.currentUser);

        state.shareAvailableUsers = users;
        state.shareSelectedUsers = [];
        state.showShareModal = true;
        render();
    } catch (error) {
        showNotification('Erreur lors du chargement des utilisateurs', 'error');
    }
}

function closeShareModal() {
    state.showShareModal = false;
    state.shareAvailableUsers = [];
    state.shareSelectedUsers = [];
    state.shareSearchTerm = ''; // Réinitialiser la recherche
    render();
}

function toggleUserSelection(username) {
    const index = state.shareSelectedUsers.indexOf(username);
    if (index > -1) {
        // Désélectionner
        state.shareSelectedUsers.splice(index, 1);
    } else {
        // Sélectionner
        state.shareSelectedUsers.push(username);
    }
    render();
}

async function confirmShare() {
    if (!state.selectedDoc || state.shareSelectedUsers.length === 0) {
        showNotification('Veuillez sélectionner au moins un utilisateur', 'error');
        return;
    }

    try {
        const result = await apiCall(
            `/documents/${state.currentUser}/${state.selectedDoc._id}/share`,
            'POST',
            { targetUsers: state.shareSelectedUsers }
        );

        if (result.success) {
            showNotification(`✅ Document partagé avec ${state.shareSelectedUsers.length} utilisateur(s)`);
            closeShareModal();
        }
    } catch (error) {
        showNotification('Erreur lors du partage', 'error');
    }
}

// ✅ NOUVEAU: Mettre à jour le terme de recherche de partage
function updateShareSearch(value) {
    state.shareSearchTerm = value.toLowerCase();
    render();
}

// ✅ NOUVEAU: Sélectionner / Désélectionner tous les utilisateurs visibles
function toggleSelectAll() {
    const filteredUsers = getFilteredShareUsers();

    if (state.shareSelectedUsers.length === filteredUsers.length) {
        // Tout est déjà sélectionné, on désélectionne tout
        state.shareSelectedUsers = [];
    } else {
        // Sélectionner tous les utilisateurs visibles
        state.shareSelectedUsers = filteredUsers.map(u => u.username);
    }
    render();
}

// ✅ NOUVEAU: Obtenir les utilisateurs filtrés par recherche
function getFilteredShareUsers() {
    if (!state.shareSearchTerm) {
        return state.shareAvailableUsers;
    }

    return state.shareAvailableUsers.filter(user => {
        const searchTerm = state.shareSearchTerm.toLowerCase();
        return user.nom.toLowerCase().includes(searchTerm) ||
               user.username.toLowerCase().includes(searchTerm) ||
               user.email.toLowerCase().includes(searchTerm) ||
               user.departement.toLowerCase().includes(searchTerm);
    });
}

// ============================================
// FONCTIONS DE MESSAGERIE
// ============================================

// Ouvrir la boîte de réception
async function openMessages() {
    try {
        state.showMenu = false;
        state.showMessages = true;
        await loadMessages();
        render();
    } catch (error) {
        console.error('Erreur ouverture messagerie:', error);
        showNotification('Erreur lors de l\'ouverture de la messagerie', 'error');
    }
}

// Charger les messages
async function loadMessages() {
    try {
        const messages = await apiCall(`/messages/${state.currentUser}`);
        state.messages = messages;
        await updateUnreadCount();
    } catch (error) {
        console.error('Erreur chargement messages:', error);
    }
}

// Mettre à jour le compteur de messages non lus
async function updateUnreadCount() {
    try {
        const result = await apiCall(`/messages/${state.currentUser}/unread-count`);
        state.unreadCount = result.count;
    } catch (error) {
        console.error('Erreur comptage messages:', error);
    }
}

// Fermer la boîte de réception
function closeMessages() {
    state.showMessages = false;
    render();
}

// Marquer un message comme lu
async function markMessageAsRead(messageId) {
    try {
        await apiCall(`/messages/${messageId}/read`, 'PUT');
        await loadMessages();
        render();
    } catch (error) {
        console.error('Erreur marquage message:', error);
    }
}

// Supprimer un message
async function deleteMessage(messageId) {
    if (!confirm('Supprimer ce message ?')) return;

    try {
        await apiCall(`/messages/${messageId}`, 'DELETE');
        showNotification('Message supprimé');
        await loadMessages();
        render();
    } catch (error) {
        console.error('Erreur suppression message:', error);
        showNotification('Erreur lors de la suppression', 'error');
    }
}

// Approuver une demande de suppression depuis la messagerie
async function approveFromMessage(requestId) {
    try {
        const result = await apiCall(`/deletion-requests/${requestId}/approve`, 'PUT', {
            approvedBy: state.currentUser
        });

        if (result.success) {
            showNotification('✅ Demande approuvée - Document supprimé');
            await loadMessages();
            await loadData();
            render();
        }
    } catch (error) {
        console.error('Erreur approbation:', error);
        showNotification('Erreur lors de l\'approbation', 'error');
    }
}

// Rejeter une demande de suppression depuis la messagerie
async function rejectFromMessage(requestId) {
    const reason = prompt('Raison du rejet (optionnel):');
    if (reason === null) return;

    try {
        const result = await apiCall(`/deletion-requests/${requestId}/reject`, 'PUT', {
            rejectedBy: state.currentUser,
            reason: reason || 'Aucune raison fournie'
        });

        if (result.success) {
            showNotification('✅ Demande rejetée');
            await loadMessages();
            render();
        }
    } catch (error) {
        console.error('Erreur rejet:', error);
        showNotification('Erreur lors du rejet', 'error');
    }
}

// Charger tous les utilisateurs pour la composition de messages
async function loadAllUsers() {
    try {
        const result = await apiCall(`/users-for-sharing/${state.currentUser}`);
        if (result.success) {
            state.allUsers = result.users;
        }
    } catch (error) {
        console.error('Erreur chargement utilisateurs:', error);
    }
}

// Ouvrir le formulaire de composition de message
async function openComposeMessage() {
    await loadAllUsers();
    state.showComposeMessage = true;
    state.composeMessageTo = '';
    state.composeMessageSubject = '';
    state.composeMessageBody = '';
    render();
}

// Fermer le formulaire de composition
function closeComposeMessage() {
    state.showComposeMessage = false;
    render();
}

// Envoyer un nouveau message
async function sendNewMessage() {
    if (!state.composeMessageTo || !state.composeMessageSubject || !state.composeMessageBody) {
        showNotification('Veuillez remplir tous les champs', 'error');
        return;
    }

    try {
        const result = await apiCall('/messages', 'POST', {
            from: state.currentUser,
            to: state.composeMessageTo,
            subject: state.composeMessageSubject,
            body: state.composeMessageBody,
            type: 'normal'
        });

        if (result.success) {
            showNotification('✅ Message envoyé avec succès');
            closeComposeMessage();
            await loadMessages();
            render();
        }
    } catch (error) {
        console.error('Erreur envoi message:', error);
        showNotification('Erreur lors de l\'envoi du message', 'error');
    }
}

// Basculer l'affichage de la section messagerie
async function toggleMessagingSection() {
    state.showMessagingSection = !state.showMessagingSection;
    if (state.showMessagingSection) {
        // Initialiser le système de messagerie amélioré
        await initMessaging();
    }
    render();
}

// ============================================
// FONCTIONS HISTORIQUE DES PARTAGES
// ============================================
// Note: L'historique des partages est maintenant affiché uniquement dans l'aperçu du document

function toggleFilters() {
    state.showFilters = !state.showFilters;
    render();
}

function updateFormData(field, value) {
    formData[field] = value;
}

function updateTempSearch(value) { 
    state.tempSearchTerm = value; 
}

function updateTempCategory(value) {
    state.tempSelectedCategory = value;
}

function updateTempDepartement(value) {
    state.tempSelectedDepartement = value;
}

function updateTempDateFrom(value) {
    state.tempDateFrom = value;
}

function updateTempDateTo(value) {
    state.tempDateTo = value;
}

function updateTempDateType(value) {
    state.tempDateType = value;
}

// NOUVEAU : Changer le tri
function changeSortBy(value) {
    state.sortBy = value;
    render();
}

function applyFilters() {
    if (state.tempDateFrom && state.tempDateTo) {
        const dateDebut = new Date(state.tempDateFrom);
        const dateFin = new Date(state.tempDateTo);

        if (dateDebut > dateFin) {
            showNotification('⚠️ La date de début doit être antérieure à la date de fin', 'error');
            return;
        }
    }

    state.searchTerm = state.tempSearchTerm;
    state.selectedCategory = state.tempSelectedCategory;
    state.selectedDepartement = state.tempSelectedDepartement;
    state.dateFrom = state.tempDateFrom;
    state.dateTo = state.tempDateTo;
    state.dateType = state.tempDateType;
    render();
}

function resetFilters() {
    state.searchTerm = '';
    state.selectedCategory = 'tous';
    state.selectedDepartement = 'tous';
    state.dateFrom = '';
    state.dateTo = '';
    state.dateType = 'document';
    state.tempSearchTerm = '';
    state.tempSelectedCategory = 'tous';
    state.tempSelectedDepartement = 'tous';
    state.tempDateFrom = '';
    state.tempDateTo = '';
    state.tempDateType = 'document';
    render();
}

async function handleLogin() {
    const username = document.getElementById('login_username').value.trim();
    const password = document.getElementById('login_password').value;
    if (!username || !password) return showNotification('Remplir tous les champs', 'error');
    await login(username, password);
}

async function handleRegister() {
    const nom = document.getElementById('reg_nom').value.trim();
    const email = document.getElementById('reg_email').value.trim();
    const username = document.getElementById('reg_username').value.trim();
    const password = document.getElementById('reg_password').value;
    const passwordConfirm = document.getElementById('reg_password_confirm').value;
    const idRole = document.getElementById('reg_role').value;
    const idDepartement = document.getElementById('reg_departement').value;
    const adminPassword = document.getElementById('reg_admin_password').value;

    if (!nom || !email || !username || !password || !passwordConfirm || !idRole || !idDepartement || !adminPassword) {
        return showNotification('Veuillez remplir tous les champs', 'error');
    }
    if (username.length < 3 || password.length < 4) {
        return showNotification('Username: 3+, Password: 4+', 'error');
    }
    if (password !== passwordConfirm) {
        return showNotification('Les mots de passe ne correspondent pas', 'error');
    }
    const success = await register(username, password, nom, email, idRole, idDepartement, adminPassword);
    if (success) {
        state.showRegister = false;
        render();
    }
}

function getStorageColorClass() {
    const percent = parseFloat(state.storageInfo.percentUsed);
    if (percent >= 90) return 'bg-red-500';
    if (percent >= 75) return 'bg-orange-500';
    if (percent >= 50) return 'bg-yellow-500';
    return 'bg-green-500';
}

// ===== RENDU =====
function render() {
    const colorOptions = [
        { value: 'bg-blue-100 text-blue-800', label: '🔵 Bleu' },
        { value: 'bg-green-100 text-green-800', label: '🟢 Vert' },
        { value: 'bg-yellow-100 text-yellow-800', label: '🟡 Jaune' },
        { value: 'bg-red-100 text-red-800', label: '🔴 Rouge' },
        { value: 'bg-purple-100 text-purple-800', label: '🟣 Violet' },
        { value: 'bg-pink-100 text-pink-800', label: '🩷 Rose' },
        { value: 'bg-orange-100 text-orange-800', label: '🟠 Orange' },
        { value: 'bg-gray-100 text-gray-800', label: '⚪ Gris' }
    ];
    
    const app = document.getElementById('app');
    
    if (!state.isAuthenticated) {
        app.innerHTML = `
            <div class="min-h-screen flex items-center justify-center gradient-bg">
                <div class="bg-white p-8 rounded-3xl shadow-2xl w-full max-w-md animate-fade-in">
                    <div class="text-center mb-8">
                        <div class="flex justify-center mb-4">
                            <img src="/logo_white.png" alt="Logo C.E.R.E.R" class="w-20 h-20 animate-float" style="filter: drop-shadow(0 4px 6px rgba(59, 130, 246, 0.3));" onerror="this.style.display='none'; this.nextElementSibling.style.display='block';">
                            <div class="logo-icon" style="display: none;">🗄️</div>
                        </div>
                        <h1 class="logo-text mb-2">Archivage C.E.R.E.R</h1>
                        <p class="text-gray-600 font-medium">Système de gestion documentaire</p>
                    </div>
                    
                    ${state.showRegister ? `
                        <div class="space-y-3">
                            <h2 class="text-xl font-semibold text-gray-700 mb-2">Créer un compte</h2>

                            <input id="reg_nom" type="text" placeholder="Nom complet"
                                   class="w-full px-4 py-3 border-2 rounded-xl input-modern">

                            <input id="reg_email" type="email" placeholder="Email"
                                   class="w-full px-4 py-3 border-2 rounded-xl input-modern">

                            <input id="reg_username" type="text" placeholder="Nom d'utilisateur (3+ caractères)"
                                   class="w-full px-4 py-3 border-2 rounded-xl input-modern">

                            <input id="reg_password" type="password" placeholder="Mot de passe (4+ caractères)"
                                   class="w-full px-4 py-3 border-2 rounded-xl input-modern">

                            <input id="reg_password_confirm" type="password" placeholder="Confirmer le mot de passe"
                                   class="w-full px-4 py-3 border-2 rounded-xl input-modern">

                            <select id="reg_role" class="w-full px-4 py-3 border-2 rounded-xl input-modern">
                                <option value="">-- Choisir un rôle --</option>
                                ${state.roles.map(role => `
                                    <option value="${role._id}">
                                        ${role.libelle.charAt(0).toUpperCase() + role.libelle.slice(1)} - ${role.description}
                                    </option>
                                `).join('')}
                            </select>

                            <select id="reg_departement" class="w-full px-4 py-3 border-2 rounded-xl input-modern">
                                <option value="">-- Choisir un département --</option>
                                ${state.departements.map(dept => `
                                    <option value="${dept._id}">
                                        ${dept.nom}
                                    </option>
                                `).join('')}
                            </select>

                            <input id="reg_admin_password" type="password" placeholder="Mot de passe administrateur"
                                   class="w-full px-4 py-3 border-2 rounded-xl input-modern">

                            <button onclick="handleRegister()"
                                    class="w-full btn-success text-white py-3 rounded-xl font-semibold transition">
                                Créer le compte
                            </button>
                            <button onclick="toggleRegister()"
                                    class="w-full text-gray-600 hover:text-gray-800 py-2">
                                ← Retour à la connexion
                            </button>
                        </div>
                    ` : `
                        <div class="space-y-4">
                            <h2 class="text-xl font-semibold text-gray-700">Connexion</h2>
                            <input id="login_username" type="text" placeholder="Nom d'utilisateur" 
                                   class="w-full px-4 py-3 border-2 rounded-xl input-modern"
                                   onkeypress="if(event.key==='Enter') handleLogin()">
                            <input id="login_password" type="password" placeholder="Mot de passe" 
                                   class="w-full px-4 py-3 border-2 rounded-xl input-modern"
                                   onkeypress="if(event.key==='Enter') handleLogin()">
                            <button onclick="handleLogin()" 
                                    class="w-full btn-primary text-white py-3 rounded-xl font-semibold transition btn-shine">
                                Se connecter
                            </button>
                            <button onclick="toggleRegister()" 
                                    class="w-full text-sm text-gray-600 hover:text-gray-800 py-2">
                                Créer un nouveau compte
                            </button>
                            
                            <div class="mt-6 pt-4 border-t border-gray-200">
                                <p class="text-center text-xs text-gray-500">
                                    Logiciel d'archivage développé par le service informatique du C.E.R.E.R
                                </p>
                            </div>
                        </div>
                    `}
                </div>
            </div>
        `;
        return;
    }
    
    const filteredDocs = getFilteredDocs();
    const activeFilters = state.searchTerm || state.selectedCategory !== 'tous' || state.dateFrom || state.dateTo;
    
    app.innerHTML = `
        <div class="min-h-screen" style="background: linear-gradient(135deg, #e0f2fe 0%, #d1fae5 100%);">
            <!-- HEADER ULTRA-COMPACT -->
            <header class="header-glass sticky top-0 z-40 shadow-lg">
                <div class="max-w-7xl mx-auto px-4 py-3">
                    <div class="flex justify-between items-center">
                        <div class="logo-container">
                            <img src="/logo_white.png" alt="Logo C.E.R.E.R" class="w-10 h-10" style="filter: drop-shadow(0 2px 4px rgba(59, 130, 246, 0.3));">
                            <div>
                                <h1 class="logo-text" style="font-size: 1rem;">C.E.R.E.R</h1>
                                <p class="text-xs text-gray-600">Bonjour, <strong>${state.currentUser}</strong></p>
                            </div>
                        </div>
                        <div class="flex gap-2">
                            <button onclick="toggleUploadForm()"
                                    class="px-4 py-2 btn-primary text-white rounded-lg hover:shadow-lg transition text-sm font-semibold">
                                ➕ Ajouter
                            </button>
                            <button onclick="toggleMessagingSection()"
                                    class="px-4 py-2 ${state.showMessagingSection ? 'bg-gradient-to-br from-blue-500 to-blue-600 text-white' : 'bg-gradient-to-br from-gray-100 to-gray-200'} rounded-lg hover:shadow-lg transition text-sm font-semibold relative">
                                📬 Boîte de réception
                                ${state.unreadCount > 0 ? `
                                    <span class="absolute -top-2 -right-2 px-2 py-1 bg-red-600 text-white text-xs font-bold rounded-full animate-pulse">
                                        ${state.unreadCount}
                                    </span>
                                ` : ''}
                            </button>
                            <button onclick="toggleFilters()"
                                    class="px-4 py-2 ${state.showFilters ? 'bg-gradient-to-br from-blue-500 to-green-500 text-white' : 'bg-gradient-to-br from-gray-100 to-gray-200'} rounded-lg hover:shadow-lg transition text-sm font-semibold">
                                🔍 Filtres
                            </button>
                            <button onclick="toggleMenu()"
                                    class="px-3 py-2 bg-gradient-to-br from-gray-100 to-gray-200 rounded-lg hover:shadow-lg transition">
                                ☰
                            </button>
                        </div>
                    </div>
                </div>

                <!-- PANNEAU DE FILTRES ESCAMOTABLE -->
                ${state.showFilters ? `
                <div class="border-t border-gray-200 bg-gradient-to-br from-blue-50 to-green-50" style="animation: slideDown 0.3s ease-out;">
                    <div class="max-w-7xl mx-auto px-4 py-4 space-y-4">
                        <!-- Statistiques -->
                        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div class="bg-gradient-to-br from-blue-500 to-blue-600 p-4 rounded-xl shadow-lg text-white">
                                <div class="flex items-center justify-between">
                                    <div>
                                        <p class="text-sm opacity-90">Total documents</p>
                                        <p class="text-3xl font-bold mt-1">${state.documents.length}</p>
                                    </div>
                                    <div class="text-5xl opacity-80">📊</div>
                                </div>
                            </div>
                            ${state.currentUserInfo && state.currentUserInfo.niveau === 1 ? `
                                <div class="bg-gradient-to-br from-purple-500 to-purple-600 p-4 rounded-xl shadow-lg text-white cursor-pointer" onclick="toggleStatsDetails()">
                                    <div class="flex items-center justify-between">
                                        <div>
                                            <p class="text-sm opacity-90">Documents par département</p>
                                            <p class="text-xl font-bold mt-1">
                                                ${state.departements.map(dept => {
                                                    const count = state.documents.filter(doc => doc.departementArchivage === dept.nom).length;
                                                    return `${dept.nom}: ${count}`;
                                                }).join(' • ')}
                                            </p>
                                        </div>
                                        <div class="text-5xl opacity-80">🏢</div>
                                    </div>
                                </div>
                            ` : `
                                <div class="bg-gradient-to-br from-green-500 to-green-600 p-4 rounded-xl shadow-lg text-white">
                                    <div class="flex items-center justify-between">
                                        <div>
                                            <p class="text-sm opacity-90">Espace utilisé</p>
                                            <p class="text-3xl font-bold mt-1">${state.storageInfo.usedMB} MB</p>
                                        </div>
                                        <div class="text-5xl opacity-80">💾</div>
                                    </div>
                                </div>
                            `}
                        </div>

                        <div class="flex gap-3 flex-wrap">
                            <div class="flex-1 min-w-[200px]">
                                <input type="text" placeholder="🔍 Rechercher par ID, nom ou tags..."
                                       value="${state.tempSearchTerm}"
                                       oninput="updateTempSearch(this.value)"
                                       class="w-full px-4 py-3 text-sm rounded-lg border-2 focus:ring-2 focus:ring-blue-500 outline-none shadow-sm">
                            </div>
                            <select onchange="updateTempCategory(this.value)"
                                    class="px-4 py-2 text-sm border-2 rounded-lg outline-none font-medium">
                                <option value="tous" ${state.tempSelectedCategory === 'tous' ? 'selected' : ''}>📁 Toutes catégories</option>
                                ${state.categories.map(cat => `
                                    <option value="${cat.id}" ${state.tempSelectedCategory === cat.id ? 'selected' : ''}>
                                        ${cat.icon} ${cat.nom}
                                    </option>
                                `).join('')}
                            </select>
                            <select onchange="updateTempDepartement(this.value)"
                                    class="px-4 py-2 text-sm border-2 rounded-lg outline-none font-medium">
                                <option value="tous" ${state.tempSelectedDepartement === 'tous' ? 'selected' : ''}>🏢 Tous départements</option>
                                ${state.departements.map(dept => `
                                    <option value="${dept.nom}" ${state.tempSelectedDepartement === dept.nom ? 'selected' : ''}>
                                        🏢 ${dept.nom}
                                    </option>
                                `).join('')}
                            </select>
                            <select onchange="changeSortBy(this.value)"
                                    class="px-4 py-2 text-sm border-2 rounded-lg outline-none font-medium bg-white">
                                <option value="" ${state.sortBy === '' ? 'selected' : ''}>🔍 Aucun tri spécifique</option>
                                <option value="date_desc" ${state.sortBy === 'date_desc' ? 'selected' : ''}>📄 Plus récent document</option>
                                <option value="date_asc" ${state.sortBy === 'date_asc' ? 'selected' : ''}>📄 Plus ancien document</option>
                                <option value="titre_asc" ${state.sortBy === 'titre_asc' ? 'selected' : ''}>🔤 A → Z</option>
                                <option value="titre_desc" ${state.sortBy === 'titre_desc' ? 'selected' : ''}>🔤 Z → A</option>
                                <option value="taille_desc" ${state.sortBy === 'taille_desc' ? 'selected' : ''}>📦 Plus grande taille</option>
                                <option value="taille_asc" ${state.sortBy === 'taille_asc' ? 'selected' : ''}>📦 Plus petite taille</option>
                            </select>
                        </div>

                        <div class="bg-white border-2 border-blue-200 rounded-lg p-3">
                            <div class="flex flex-col gap-3">
                                <div class="flex items-center gap-4 flex-wrap">
                                    <span class="text-sm font-bold text-blue-800">📅 Filtrer par date:</span>
                                    <div class="flex gap-4">
                                        <label class="flex items-center gap-2 cursor-pointer">
                                            <input type="radio" name="dateType" value="document"
                                                   ${state.tempDateType === 'document' ? 'checked' : ''}
                                                   onchange="updateTempDateType('document')"
                                                   class="text-blue-600" />
                                            <span class="text-sm font-medium">Date du document</span>
                                        </label>
                                        <label class="flex items-center gap-2 cursor-pointer">
                                            <input type="radio" name="dateType" value="ajout"
                                                   ${state.tempDateType === 'ajout' ? 'checked' : ''}
                                                   onchange="updateTempDateType('ajout')"
                                                   class="text-blue-600" />
                                            <span class="text-sm font-medium">Date d'ajout</span>
                                        </label>
                                    </div>
                                </div>
                                
                                <div class="flex gap-3 flex-wrap">
                                    <div class="flex-1 min-w-[150px]">
                                        <label class="block text-xs text-gray-700 font-medium mb-1">Date de début</label>
                                        <input type="date" value="${state.tempDateFrom}" 
                                               onchange="updateTempDateFrom(this.value)" 
                                               class="w-full px-3 py-2 border-2 rounded-lg text-sm input-modern" />
                                    </div>
                                    <div class="flex-1 min-w-[150px]">
                                        <label class="block text-xs text-gray-700 font-medium mb-1">Date de fin</label>
                                        <input type="date" value="${state.tempDateTo}" 
                                               onchange="updateTempDateTo(this.value)" 
                                               class="w-full px-3 py-2 border-2 rounded-lg text-sm input-modern" />
                                    </div>
                                </div>
                            </div>
                        </div>
                        
                        <div class="flex gap-2 flex-wrap">
                            <button onclick="applyFilters()"
                                    class="px-6 py-2 btn-primary text-white rounded-lg hover:shadow-lg transition text-sm font-semibold">
                                🔎 Appliquer
                            </button>
                            ${activeFilters ? `
                                <button onclick="resetFilters()"
                                        class="px-6 py-2 bg-gradient-to-br from-red-500 to-red-600 text-white rounded-lg hover:shadow-lg transition text-sm font-semibold">
                                    ✖ Réinitialiser
                                </button>
                            ` : ''}
                            <button onclick="toggleFilters()"
                                    class="px-6 py-2 bg-gradient-to-br from-gray-100 to-gray-200 rounded-lg hover:shadow-lg transition text-sm font-semibold ml-auto">
                                ⬆ Masquer les filtres
                            </button>
                        </div>
                        
                        ${activeFilters ? `
                            <div class="bg-green-50 border-2 border-green-200 rounded-lg p-3">
                                <p class="text-sm text-green-800">
                                    <strong>✓ ${filteredDocs.length}</strong> document(s) sur <strong>${state.documents.length}</strong>
                                    ${state.searchTerm ? ` • "${state.searchTerm}"` : ''}
                                    ${state.selectedCategory !== 'tous' ? ` • ${getCategoryName(state.selectedCategory)}` : ''}
                                    ${state.dateFrom ? ` • ${formatDate(state.dateFrom)}` : ''}
                                    ${state.dateTo ? ` → ${formatDate(state.dateTo)}` : ''}
                                </p>
                            </div>
                        ` : ''}
                    </div>
                </div>
                ` : ''}
            </header>

            <main class="max-w-7xl mx-auto px-4 py-4">

                ${state.showMessagingSection ? renderMessaging() : ''}

                <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    ${filteredDocs.map(doc => `
                        <div onclick="showDocDetail('${doc._id}')"
                             class="doc-card p-5 rounded-2xl shadow-md cursor-pointer animate-fade-in hover:shadow-xl transition-shadow">
                            <div class="flex justify-between items-start mb-3">
                                <h3 class="font-bold text-gray-800 flex-1 text-lg">${doc.titre}</h3>
                                <span class="text-3xl">${getCategoryIcon(doc.categorie)}</span>
                            </div>
                            <span class="category-badge inline-block px-3 py-1 text-sm rounded-full ${getCategoryColor(doc.categorie)} font-medium mb-3">
                                ${getCategoryName(doc.categorie)}
                            </span>
                            <div class="mt-3 space-y-2 border-t pt-3">
                                ${doc.idDocument ? `
                                <p class="text-sm text-blue-600 font-semibold flex items-center gap-2">
                                    🆔 ${doc.idDocument}
                                </p>
                                ` : ''}
                                <p class="text-sm text-gray-600 flex items-center gap-2">
                                    📄 ${formatDate(doc.date)}
                                </p>
                                <p class="text-xs text-green-600 font-medium flex items-center gap-2">
                                    ➕ Ajouté: ${formatDate(doc.createdAt)}
                                </p>
                                <p class="text-xs text-gray-500 flex items-center gap-2">
                                    📦 ${formatSize(doc.taille)}
                                </p>
                            </div>
                        </div>
                    `).join('')}
                </div>
                
                ${filteredDocs.length === 0 ? `
                    <div class="text-center py-20 animate-fade-in">
                        <div class="text-6xl mb-4">🔭</div>
                        <p class="text-gray-500 text-xl mb-6">Aucun document trouvé</p>
                        <button onclick="toggleUploadForm()" 
                                class="px-8 py-4 btn-primary text-white rounded-xl hover:shadow-lg transition font-semibold text-lg">
                            ➕ Ajouter un document
                        </button>
                    </div>
                ` : ''}
            </main>
            
            ${state.showMenu ? `
                <div class="fixed inset-0 bg-black bg-opacity-50 z-50 backdrop-blur-sm" onclick="toggleMenu()"></div>
                <div class="fixed right-0 top-0 h-full w-80 sidebar-menu shadow-2xl z-50 p-6 overflow-y-auto animate-slide-in">
                    <button onclick="toggleMenu()" class="absolute top-4 right-4 text-2xl text-gray-600 hover:text-gray-800">✖</button>
                    <h2 class="text-2xl font-bold mb-6 bg-gradient-to-r from-blue-600 to-green-600 bg-clip-text text-transparent">Menu</h2>

                    <!-- Affichage du rôle et niveau -->
                    ${state.currentUserInfo ? `
                        <div class="mb-4 p-3 bg-gradient-to-br from-blue-50 to-green-50 rounded-xl">
                            <p class="text-sm font-semibold text-gray-700">${state.currentUserInfo.nom}</p>
                            <p class="text-xs text-gray-600">Niveau ${state.currentUserInfo.niveau} - ${state.currentUserInfo.role}</p>
                        </div>
                    ` : ''}

                    <div class="space-y-2">
                        ${state.currentUserInfo && state.currentUserInfo.niveau === 1 ? `
                            <!-- Menu complet pour NIVEAU 1 (Admin) -->
                            <button onclick="toggleCategories()" class="w-full text-left px-4 py-4 hover:bg-gradient-to-r hover:from-blue-50 hover:to-green-50 rounded-xl transition font-medium">
                                📂 Gérer les catégories
                            </button>
                            <button onclick="toggleDepartements()" class="w-full text-left px-4 py-4 hover:bg-gradient-to-r hover:from-blue-50 hover:to-green-50 rounded-xl transition font-medium">
                                🏢 Gérer les départements
                            </button>
                            <button onclick="showDeletionRequests()" class="w-full text-left px-4 py-4 hover:bg-gradient-to-r hover:from-orange-50 hover:to-red-50 rounded-xl transition font-medium">
                                📋 Demandes de suppression
                            </button>
                            <button onclick="exportData()" class="w-full text-left px-4 py-4 hover:bg-gradient-to-r hover:from-blue-50 hover:to-green-50 rounded-xl transition font-medium">
                                💾 Exporter les données
                            </button>
                            <label class="block w-full text-left px-4 py-4 hover:bg-gradient-to-r hover:from-blue-50 hover:to-green-50 rounded-xl cursor-pointer transition font-medium">
                                📥 Importer des données
                                <input type="file" accept=".json" onchange="importData(event)" class="hidden">
                            </label>
                            <button onclick="deleteAllDocuments()" class="w-full text-left px-4 py-4 hover:bg-red-50 text-red-600 rounded-xl transition font-medium">
                                🗑️ Tout supprimer
                            </button>
                        ` : ''}

                        <!-- ✅ NOUVEAU: Boîte de réception des messages pour tous les niveaux -->
                        <button onclick="toggleMessagingSection()" class="w-full text-left px-4 py-4 hover:bg-gradient-to-r hover:from-blue-50 hover:to-green-50 rounded-xl transition font-medium relative">
                            📬 Boîte de réception des messages
                            ${state.unreadCount > 0 ? `
                                <span class="absolute right-4 top-4 px-2 py-1 bg-red-500 text-white text-xs font-bold rounded-full">
                                    ${state.unreadCount}
                                </span>
                            ` : ''}
                        </button>

                        <!-- Déconnexion pour tous les niveaux -->
                        <button onclick="logout()" class="w-full text-left px-4 py-4 hover:bg-gradient-to-r hover:from-blue-50 hover:to-green-50 rounded-xl transition font-medium">
                            🚪 Déconnexion
                        </button>
                    </div>
                </div>
            ` : ''}
            
            ${state.showUploadForm ? `
                <div class="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4 backdrop-blur-sm" 
                     onclick="if(event.target === this) toggleUploadForm()">
                    <div class="modal-glass rounded-2xl p-8 max-w-md w-full shadow-2xl animate-fade-in max-h-[90vh] overflow-y-auto" onclick="event.stopPropagation()">
                        <h2 class="text-2xl font-bold mb-6 bg-gradient-to-r from-blue-600 to-green-600 bg-clip-text text-transparent">➕ Ajouter un document</h2>
                        <div class="space-y-4">
                            <input type="text" placeholder="Titre du document *" value="${formData.titre}"
                                   oninput="updateFormData('titre', this.value)"
                                   class="w-full px-4 py-3 border-2 rounded-xl input-modern">
                            <select onchange="updateFormData('categorie', this.value)" 
                                    class="w-full px-4 py-3 border-2 rounded-xl input-modern font-medium">
                                ${state.categories.map(cat => `
                                    <option value="${cat.id}" ${formData.categorie === cat.id ? 'selected' : ''}>
                                        ${cat.icon} ${cat.nom}
                                    </option>
                                `).join('')}
                            </select>
                            <div>
                                <label class="block text-sm font-semibold text-gray-700 mb-1">📄 Date du document</label>
                                <input type="date" value="${formData.date}"
                                       onchange="updateFormData('date', this.value)"
                                       class="w-full px-4 py-3 border-2 rounded-xl input-modern">
                            </div>
                            <select onchange="updateFormData('departementArchivage', this.value)"
                                    class="w-full px-4 py-3 border-2 rounded-xl input-modern">
                                <option value="">🏢 Sélectionner le département d'archivage</option>
                                ${state.departements.map(dept => `
                                    <option value="${dept._id}" ${formData.departementArchivage === dept._id ? 'selected' : ''}>
                                        ${dept.nom}
                                    </option>
                                `).join('')}
                            </select>
                            <textarea placeholder="Description (optionnelle)" 
                                      oninput="updateFormData('description', this.value)"
                                      class="w-full px-4 py-3 border-2 rounded-xl input-modern resize-none"
                                      rows="3">${formData.description}</textarea>
                            <input type="text" placeholder="Tags (séparés par des virgules)" value="${formData.tags}"
                                   oninput="updateFormData('tags', this.value)"
                                   class="w-full px-4 py-3 border-2 rounded-xl input-modern">
                            <label class="block w-full px-6 py-4 btn-primary text-white rounded-xl text-center cursor-pointer hover:shadow-lg font-semibold transition">
                                🔎 Choisir un fichier
                                <input type="file" onchange="handleFileUpload(event)" class="hidden">
                            </label>
                            <button onclick="toggleUploadForm()" 
                                    class="w-full px-6 py-3 bg-gradient-to-br from-gray-100 to-gray-200 rounded-xl hover:shadow-md transition font-medium">
                                Annuler
                            </button>
                        </div>
                    </div>
                </div>
            ` : ''}
            
            ${state.showCategories ? `
                <div class="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4 backdrop-blur-sm" 
                     onclick="if(event.target === this) toggleCategories()">
                    <div class="modal-glass rounded-2xl p-8 max-w-md w-full max-h-[80vh] overflow-y-auto shadow-2xl animate-fade-in" onclick="event.stopPropagation()">
                        <h2 class="text-2xl font-bold mb-6 bg-gradient-to-r from-blue-600 to-green-600 bg-clip-text text-transparent">📂 Gérer les catégories</h2>
                        <div class="space-y-3 mb-6">
                            ${state.categories.map(cat => `
                                ${state.editingCategory && state.editingCategory.id === cat.id ? `
                                    <!-- Mode édition -->
                                    <div class="p-4 bg-blue-50 rounded-xl space-y-3">
                                        <div class="flex items-center gap-2 mb-2">
                                            <span class="text-lg font-bold">✏️ Modifier</span>
                                        </div>
                                        <input id="edit_cat_nom" type="text" value="${cat.nom}" placeholder="Nom de la catégorie"
                                               class="w-full px-3 py-2 border-2 rounded-lg input-modern text-sm">
                                        <input id="edit_cat_icon" type="text" value="${cat.icon}" placeholder="Emoji"
                                               class="w-full px-3 py-2 border-2 rounded-lg input-modern text-sm">
                                        <select id="edit_cat_couleur" class="w-full px-3 py-2 border-2 rounded-lg input-modern text-sm">
                                            ${colorOptions.map(opt => `
                                                <option value="${opt.value}" ${cat.couleur === opt.value ? 'selected' : ''}>${opt.label}</option>
                                            `).join('')}
                                        </select>
                                        <div class="flex gap-2">
                                            <button onclick="saveEditCategory()"
                                                    class="flex-1 px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 transition text-sm font-semibold">
                                                ✅ Sauvegarder
                                            </button>
                                            <button onclick="cancelEditCategory()"
                                                    class="flex-1 px-4 py-2 bg-gray-300 text-gray-700 rounded-lg hover:bg-gray-400 transition text-sm font-medium">
                                                ❌ Annuler
                                            </button>
                                        </div>
                                    </div>
                                ` : `
                                    <!-- Mode affichage normal -->
                                    <div class="flex justify-between items-center p-4 hover:bg-gradient-to-r hover:from-blue-50 hover:to-green-50 rounded-xl transition">
                                        <span class="font-medium">${cat.icon} ${cat.nom}</span>
                                        <div class="flex gap-2">
                                            <button onclick="startEditCategory('${cat.id}')"
                                                    class="text-blue-500 hover:text-blue-700 text-xl transition" title="Modifier">
                                                ✏️
                                            </button>
                                            <button onclick="deleteCategory('${cat.id}')"
                                                    class="text-red-500 hover:text-red-700 text-xl transition" title="Supprimer">
                                                🗑️
                                            </button>
                                        </div>
                                    </div>
                                `}
                            `).join('')}
                        </div>
                        <div class="border-t-2 border-gray-200 pt-6 space-y-4">
                            <h3 class="font-bold text-lg">➕ Nouvelle catégorie</h3>
                            <input id="new_cat_nom" type="text" placeholder="Nom de la catégorie"
                                   class="w-full px-4 py-3 border-2 rounded-xl input-modern">
                            <input id="new_cat_icon" type="text" placeholder="Emoji (ex: 📊)"
                                   class="w-full px-4 py-3 border-2 rounded-xl input-modern">
                            <select id="new_cat_couleur" 
                                    class="w-full px-4 py-3 border-2 rounded-xl input-modern font-medium">
                                ${colorOptions.map(opt => `
                                    <option value="${opt.value}">${opt.label}</option>
                                `).join('')}
                            </select>
                            <button onclick="addCategory()" 
                                    class="w-full px-6 py-4 btn-success text-white rounded-xl hover:shadow-lg transition font-semibold">
                                ✅ Ajouter la catégorie
                            </button>
                            <button onclick="toggleCategories()" 
                                    class="w-full px-6 py-3 bg-gradient-to-br from-gray-100 to-gray-200 rounded-xl hover:shadow-md transition font-medium">
                                Fermer
                            </button>
                        </div>
                    </div>
                </div>
            ` : ''}

            ${state.showDepartements ? `
                <div class="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4 backdrop-blur-sm"
                     onclick="if(event.target === this) toggleDepartements()">
                    <div class="modal-glass rounded-2xl p-8 max-w-md w-full max-h-[80vh] overflow-y-auto shadow-2xl animate-fade-in" onclick="event.stopPropagation()">
                        <h2 class="text-2xl font-bold mb-6 bg-gradient-to-r from-blue-600 to-green-600 bg-clip-text text-transparent">🏢 Gérer les départements</h2>
                        <div class="space-y-3 mb-6">
                            ${state.departements.map(dept => `
                                ${state.editingDepartement && state.editingDepartement._id === dept._id ? `
                                    <!-- Mode édition -->
                                    <div class="p-4 bg-blue-50 rounded-xl space-y-3">
                                        <div class="flex items-center gap-2 mb-2">
                                            <span class="text-lg font-bold">✏️ Modifier</span>
                                        </div>
                                        <input id="edit_dept_nom" type="text" value="${dept.nom}" placeholder="Nom du département"
                                               class="w-full px-3 py-2 border-2 rounded-lg input-modern text-sm">
                                        <input id="edit_dept_code" type="text" value="${dept.code}" placeholder="Code (ex: INFO)"
                                               class="w-full px-3 py-2 border-2 rounded-lg input-modern text-sm">
                                        <div class="flex gap-2">
                                            <button onclick="saveEditDepartement()"
                                                    class="flex-1 px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 transition text-sm font-semibold">
                                                ✅ Sauvegarder
                                            </button>
                                            <button onclick="cancelEditDepartement()"
                                                    class="flex-1 px-4 py-2 bg-gray-300 text-gray-700 rounded-lg hover:bg-gray-400 transition text-sm font-medium">
                                                ❌ Annuler
                                            </button>
                                        </div>
                                    </div>
                                ` : `
                                    <!-- Mode affichage normal -->
                                    <div class="flex justify-between items-center p-4 hover:bg-gradient-to-r hover:from-blue-50 hover:to-green-50 rounded-xl transition">
                                        <span class="font-medium">🏢 ${dept.nom} (${dept.code})</span>
                                        <div class="flex gap-2">
                                            <button onclick="startEditDepartement('${dept._id}')"
                                                    class="text-blue-500 hover:text-blue-700 text-xl transition" title="Modifier">
                                                ✏️
                                            </button>
                                            <button onclick="deleteDepartement('${dept._id}')"
                                                    class="text-red-500 hover:text-red-700 text-xl transition" title="Supprimer">
                                                🗑️
                                            </button>
                                        </div>
                                    </div>
                                `}
                            `).join('')}
                        </div>
                        <div class="border-t-2 border-gray-200 pt-6 space-y-4">
                            <h3 class="font-bold text-lg">➕ Nouveau département</h3>
                            <input id="new_dept_nom" type="text" placeholder="Nom du département"
                                   class="w-full px-4 py-3 border-2 rounded-xl input-modern">
                            <input id="new_dept_code" type="text" placeholder="Code (ex: INFO, MATH)"
                                   class="w-full px-4 py-3 border-2 rounded-xl input-modern">
                            <button onclick="addDepartement()"
                                    class="w-full px-6 py-4 btn-success text-white rounded-xl hover:shadow-lg transition font-semibold">
                                ✅ Ajouter le département
                            </button>
                            <button onclick="toggleDepartements()"
                                    class="w-full px-6 py-3 bg-gradient-to-br from-gray-100 to-gray-200 rounded-xl hover:shadow-md transition font-medium">
                                Fermer
                            </button>
                        </div>
                    </div>
                </div>
            ` : ''}

            ${state.showDeletionRequests ? `
                <div class="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4 backdrop-blur-sm"
                     onclick="if(event.target === this) closeDeletionRequests()">
                    <div class="modal-glass rounded-2xl p-8 max-w-4xl w-full max-h-[80vh] overflow-y-auto shadow-2xl animate-fade-in" onclick="event.stopPropagation()">
                        <div class="flex justify-between items-center mb-6">
                            <h2 class="text-2xl font-bold bg-gradient-to-r from-orange-600 to-red-600 bg-clip-text text-transparent">📋 Demandes de suppression</h2>
                            <button onclick="closeDeletionRequests()" class="text-2xl text-gray-600 hover:text-gray-800">✖</button>
                        </div>

                        ${state.deletionRequests.length === 0 ? `
                            <div class="text-center py-12">
                                <div class="text-6xl mb-4">✅</div>
                                <p class="text-gray-500 text-lg">Aucune demande en attente</p>
                            </div>
                        ` : `
                            <div class="space-y-4">
                                ${state.deletionRequests.map(request => `
                                    <div class="bg-white border-2 border-orange-200 rounded-xl p-5 shadow-sm hover:shadow-md transition">
                                        <div class="flex justify-between items-start mb-3">
                                            <div class="flex-1">
                                                <h3 class="font-bold text-lg text-gray-800 mb-1">${request.documentTitle}</h3>
                                                <p class="text-sm text-blue-600 font-semibold">🆔 ${request.documentIdDocument}</p>
                                            </div>
                                            <span class="px-3 py-1 bg-orange-100 text-orange-800 rounded-full text-xs font-semibold">
                                                ⏳ En attente
                                            </span>
                                        </div>

                                        <div class="border-t pt-3 mt-3 space-y-2 text-sm text-gray-600">
                                            <p><strong>👤 Demandeur:</strong> ${request.requesterName} (${request.requestedBy})</p>
                                            <p><strong>📅 Date de demande:</strong> ${formatDate(request.createdAt)}</p>
                                        </div>

                                        <div class="flex gap-3 mt-4">
                                            <button onclick="approveDeletion('${request._id}')"
                                                    class="flex-1 px-4 py-3 bg-gradient-to-br from-green-500 to-green-600 text-white rounded-xl hover:shadow-lg transition font-semibold flex items-center justify-center gap-2">
                                                <span class="text-lg">✅</span> Approuver
                                            </button>
                                            <button onclick="rejectDeletion('${request._id}')"
                                                    class="flex-1 px-4 py-3 bg-gradient-to-br from-red-500 to-red-600 text-white rounded-xl hover:shadow-lg transition font-semibold flex items-center justify-center gap-2">
                                                <span class="text-lg">❌</span> Rejeter
                                            </button>
                                        </div>
                                    </div>
                                `).join('')}
                            </div>
                        `}
                    </div>
                </div>
            ` : ''}

            <!-- NOUVEAU : Détail du document AVEC PRÉVISUALISATION -->
            ${state.selectedDoc ? `
                <div class="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4 backdrop-blur-sm" 
                     onclick="if(event.target === this) closeDocDetail()">
                    <div class="modal-glass rounded-2xl p-8 max-w-5xl w-full max-h-[90vh] overflow-y-auto shadow-2xl animate-fade-in" onclick="event.stopPropagation()">
                        <div class="flex justify-between items-start mb-6">
                            <h2 class="text-3xl font-bold text-gray-800">${state.selectedDoc.titre}</h2>
                            <button onclick="closeDocDetail()" class="text-2xl text-gray-600 hover:text-gray-800 transition">✖</button>
                        </div>
                        
                        <!-- PRÉVISUALISATION -->
                        <div class="mb-6 bg-gradient-to-br from-gray-50 to-gray-100 rounded-2xl p-6 border-2 border-gray-200">
                            <div class="flex items-center justify-between mb-4">
                                <h3 class="font-bold text-lg text-gray-700 flex items-center gap-2">
                                    <span class="text-2xl">👁️</span> Aperçu du document
                                </h3>
                                <span class="text-sm text-gray-500 bg-white px-3 py-1 rounded-full">
                                    ${state.selectedDoc.nomFichier}
                                </span>
                            </div>
                            
                            <div class="bg-white rounded-xl p-4 shadow-inner">
                                ${state.selectedDoc.type.startsWith('image/') ? `
                                    <img src="${state.selectedDoc.contenu}" 
                                         alt="${state.selectedDoc.titre}" 
                                         class="w-full h-auto max-h-[500px] object-contain rounded-lg cursor-zoom-in"
                                         onclick="window.open(this.src, '_blank')"
                                         title="Cliquer pour agrandir">
                                ` : state.selectedDoc.type === 'application/pdf' ? `
                                    <div class="relative" style="height: 600px;">
                                        <iframe src="${state.selectedDoc.contenu}#toolbar=0" 
                                                class="w-full h-full rounded-lg border-2 border-gray-200"
                                                title="Aperçu PDF"></iframe>
                                        <p class="text-center text-sm text-gray-600 mt-3">
                                            💡 Faites défiler pour voir tout le document
                                        </p>
                                    </div>
                                ` : state.selectedDoc.type.includes('word') || state.selectedDoc.type.includes('document') || state.selectedDoc.nomFichier.endsWith('.doc') || state.selectedDoc.nomFichier.endsWith('.docx') ? `
                                    <div class="text-center py-16">
                                        <div class="text-6xl mb-4">📝</div>
                                        <p class="text-gray-700 font-bold text-xl mb-2">
                                            Document Microsoft Word
                                        </p>
                                        <p class="text-gray-600 text-base mt-3 mb-2">
                                            <strong>Fichier:</strong> ${state.selectedDoc.nomFichier}
                                        </p>
                                        <p class="text-gray-600 text-base mb-4">
                                            <strong>Taille:</strong> ${formatSize(state.selectedDoc.taille)}
                                        </p>
                                        <div class="bg-blue-50 border-2 border-blue-200 rounded-lg p-4 mx-auto max-w-md mb-4">
                                            <p class="text-sm text-blue-800 font-medium">
                                                💡 Téléchargez ce document pour l'ouvrir dans Microsoft Word
                                            </p>
                                        </div>
                                        <button onclick="downloadDoc(state.selectedDoc)"
                                                class="mt-2 px-8 py-4 btn-primary text-white rounded-xl hover:shadow-lg transition font-semibold text-lg">
                                            📥 Télécharger le document
                                        </button>
                                    </div>
                                ` : state.selectedDoc.type.includes('excel') || state.selectedDoc.type.includes('sheet') || state.selectedDoc.nomFichier.endsWith('.xls') || state.selectedDoc.nomFichier.endsWith('.xlsx') ? `
                                    <div class="text-center py-16">
                                        <div class="text-6xl mb-4">📊</div>
                                        <p class="text-gray-700 font-bold text-xl mb-2">
                                            Tableur Microsoft Excel
                                        </p>
                                        <p class="text-gray-600 text-base mt-3 mb-2">
                                            <strong>Fichier:</strong> ${state.selectedDoc.nomFichier}
                                        </p>
                                        <p class="text-gray-600 text-base mb-4">
                                            <strong>Taille:</strong> ${formatSize(state.selectedDoc.taille)}
                                        </p>
                                        <div class="bg-green-50 border-2 border-green-200 rounded-lg p-4 mx-auto max-w-md mb-4">
                                            <p class="text-sm text-green-800 font-medium">
                                                💡 Téléchargez ce tableur pour l'ouvrir dans Microsoft Excel
                                            </p>
                                        </div>
                                        <button onclick="downloadDoc(state.selectedDoc)"
                                                class="mt-2 px-8 py-4 btn-success text-white rounded-xl hover:shadow-lg transition font-semibold text-lg">
                                            📥 Télécharger le tableur
                                        </button>
                                    </div>
                                ` : state.selectedDoc.type.includes('powerpoint') || state.selectedDoc.type.includes('presentation') || state.selectedDoc.nomFichier.endsWith('.ppt') || state.selectedDoc.nomFichier.endsWith('.pptx') ? `
                                    <div class="text-center py-16">
                                        <div class="text-6xl mb-4">🎞️</div>
                                        <p class="text-gray-700 font-bold text-xl mb-2">
                                            Présentation PowerPoint
                                        </p>
                                        <p class="text-gray-600 text-base mt-3 mb-2">
                                            <strong>Fichier:</strong> ${state.selectedDoc.nomFichier}
                                        </p>
                                        <p class="text-gray-600 text-base mb-4">
                                            <strong>Taille:</strong> ${formatSize(state.selectedDoc.taille)}
                                        </p>
                                        <div class="bg-orange-50 border-2 border-orange-200 rounded-lg p-4 mx-auto max-w-md mb-4">
                                            <p class="text-sm text-orange-800 font-medium">
                                                💡 Téléchargez cette présentation pour l'ouvrir dans PowerPoint
                                            </p>
                                        </div>
                                        <button onclick="downloadDoc(state.selectedDoc)"
                                                class="mt-2 px-8 py-4 bg-gradient-to-br from-orange-500 to-red-500 text-white rounded-xl hover:shadow-lg transition font-semibold text-lg">
                                            📥 Télécharger la présentation
                                        </button>
                                    </div>
                                ` : `
                                    <div class="text-center py-16">
                                        <div class="text-6xl mb-4">📄</div>
                                        <p class="text-gray-600 font-medium">
                                            Aperçu non disponible pour ce type de fichier
                                        </p>
                                        <p class="text-sm text-gray-500 mt-2">
                                            Type: ${state.selectedDoc.type}
                                        </p>
                                        <button onclick="downloadDoc(state.selectedDoc)"
                                                class="mt-4 px-6 py-3 btn-primary text-white rounded-xl hover:shadow-lg transition">
                                            📥 Télécharger pour voir
                                        </button>
                                    </div>
                                `}
                            </div>
                        </div>
                        
                        <!-- INFORMATIONS -->
                        <div class="space-y-4 mb-8 bg-white rounded-xl p-6 border border-gray-200">
                            <h3 class="font-bold text-lg text-gray-800 mb-4">ℹ️ Informations</h3>
                            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                                ${state.selectedDoc.idDocument ? `
                                <div class="flex items-center gap-2">
                                    <strong class="text-gray-700">🆔 ID Document:</strong>
                                    <span class="text-blue-600 font-semibold">${state.selectedDoc.idDocument}</span>
                                </div>
                                ` : ''}
                                <div class="flex items-center gap-3">
                                    <strong class="text-gray-700">Catégorie:</strong>
                                    <span class="category-badge inline-block px-3 py-1 text-sm rounded-full ${getCategoryColor(state.selectedDoc.categorie)} font-medium">
                                        ${getCategoryIcon(state.selectedDoc.categorie)} ${getCategoryName(state.selectedDoc.categorie)}
                                    </span>
                                </div>
                                ${state.selectedDoc.departementArchivage ? `
                                <div class="flex items-center gap-2">
                                    <strong class="text-gray-700">🏢 Département d'archivage:</strong>
                                    <span class="text-gray-600 font-semibold">${state.selectedDoc.departementArchivage}</span>
                                </div>
                                ` : ''}
                                <div class="flex items-center gap-2">
                                    <strong class="text-gray-700">📄 Date document:</strong>
                                    <span class="text-gray-600">${formatDate(state.selectedDoc.date)}</span>
                                </div>
                                <div class="flex items-center gap-2">
                                    <strong class="text-gray-700">📦 Taille:</strong>
                                    <span class="text-gray-600">${formatSize(state.selectedDoc.taille)}</span>
                                </div>
                            </div>
                            ${state.selectedDoc.description ? `
                                <div class="pt-4 border-t border-gray-200">
                                    <strong class="text-gray-700">📝 Description:</strong>
                                    <p class="text-gray-600 mt-2">${state.selectedDoc.description}</p>
                                </div>
                            ` : ''}
                            ${state.selectedDoc.tags ? `
                                <div class="pt-4 border-t border-gray-200">
                                    <strong class="text-gray-700">🏷️ Tags:</strong>
                                    <p class="text-gray-600 mt-2">${state.selectedDoc.tags}</p>
                                </div>
                            ` : ''}

                            <!-- ✅ TRAÇABILITÉ -->
                            ${state.selectedDoc.archivePar ? `
                                <div class="pt-4 border-t border-gray-200">
                                    <strong class="text-gray-700">👤 Archivé par:</strong>
                                    <div class="text-gray-600 mt-2 space-y-1">
                                        <p><strong>${state.selectedDoc.archivePar.nomComplet}</strong></p>
                                        ${state.selectedDoc.archivePar.role ? `<p class="text-sm">Rôle: ${state.selectedDoc.archivePar.role} (Niveau ${state.selectedDoc.archivePar.niveau})</p>` : ''}
                                        ${state.selectedDoc.archivePar.departement ? `<p class="text-sm">Département: ${state.selectedDoc.archivePar.departement}</p>` : ''}
                                        <p class="text-sm text-gray-500">
                                            Le ${formatDate(state.selectedDoc.archivePar.date)} à ${new Date(state.selectedDoc.archivePar.date).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                                        </p>
                                    </div>
                                </div>
                            ` : ''}

                            ${state.selectedDoc.historiqueConsultations && state.selectedDoc.historiqueConsultations.length > 0 ? `
                                <div class="pt-4 border-t border-gray-200">
                                    <strong class="text-gray-700">👁️ Dernières consultations (${state.selectedDoc.historiqueConsultations.length}):</strong>
                                    <div class="mt-2 max-h-60 overflow-y-auto space-y-2">
                                        ${state.selectedDoc.historiqueConsultations.slice(-10).reverse().map(c => `
                                            <div class="bg-gray-50 p-3 rounded-lg text-sm">
                                                <p class="font-semibold text-gray-800">${c.nomComplet}</p>
                                                ${c.role ? `<p class="text-gray-600">Rôle: ${c.role} (Niveau ${c.niveau})</p>` : ''}
                                                ${c.departement ? `<p class="text-gray-600">Département: ${c.departement}</p>` : ''}
                                                <p class="text-gray-500 text-xs mt-1">
                                                    ${formatDate(c.date)} à ${new Date(c.date).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                                                </p>
                                            </div>
                                        `).join('')}
                                    </div>
                                </div>
                            ` : ''}

                            ${state.selectedDoc.historiqueTelechargements && state.selectedDoc.historiqueTelechargements.length > 0 ? `
                                <div class="pt-4 border-t border-gray-200">
                                    <strong class="text-gray-700">📥 Derniers téléchargements (${state.selectedDoc.historiqueTelechargements.length}):</strong>
                                    <div class="mt-2 max-h-60 overflow-y-auto space-y-2">
                                        ${state.selectedDoc.historiqueTelechargements.slice(-10).reverse().map(t => `
                                            <div class="bg-blue-50 p-3 rounded-lg text-sm">
                                                <p class="font-semibold text-gray-800">${t.nomComplet}</p>
                                                ${t.role ? `<p class="text-gray-600">Rôle: ${t.role} (Niveau ${t.niveau})</p>` : ''}
                                                ${t.departement ? `<p class="text-gray-600">Département: ${t.departement}</p>` : ''}
                                                <p class="text-gray-500 text-xs mt-1">
                                                    ${formatDate(t.date)} à ${new Date(t.date).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                                                </p>
                                            </div>
                                        `).join('')}
                                    </div>
                                </div>
                            ` : ''}

                            ${state.selectedDoc.historiquePartages && state.selectedDoc.historiquePartages.length > 0 ? `
                                <div class="pt-4 border-t border-gray-200">
                                    <strong class="text-gray-700">🔗 Historique des partages (${state.selectedDoc.historiquePartages.length}):</strong>
                                    <div class="mt-2 max-h-60 overflow-y-auto space-y-2">
                                        ${state.selectedDoc.historiquePartages.slice(-10).reverse().map(p => `
                                            <div class="bg-gradient-to-r from-green-50 to-blue-50 p-3 rounded-lg text-sm border-2 border-green-200">
                                                <div class="flex items-start justify-between mb-2">
                                                    <div class="flex-1">
                                                        <p class="font-semibold text-gray-800 flex items-center gap-2">
                                                            <span class="text-blue-600">👤 ${p.sharedByName || p.sharedBy}</span>
                                                            <span class="text-gray-400">→</span>
                                                            <span class="text-green-600">👤 ${p.sharedWithName || p.sharedWith}</span>
                                                        </p>
                                                    </div>
                                                </div>
                                                <div class="grid grid-cols-2 gap-2 mt-2 text-xs">
                                                    <div class="bg-white rounded p-2">
                                                        <p class="text-gray-500">Partagé par:</p>
                                                        <p class="font-semibold text-gray-700">${p.sharedBy}</p>
                                                        ${p.sharedByRole ? `<p class="text-gray-600">${p.sharedByRole} (Niv. ${p.sharedByNiveau || 'N/A'})</p>` : ''}
                                                        ${p.sharedByDepartement ? `<p class="text-gray-600">📍 ${p.sharedByDepartement}</p>` : ''}
                                                    </div>
                                                    <div class="bg-white rounded p-2">
                                                        <p class="text-gray-500">Partagé avec:</p>
                                                        <p class="font-semibold text-gray-700">${p.sharedWith}</p>
                                                        ${p.sharedWithRole ? `<p class="text-gray-600">${p.sharedWithRole} (Niv. ${p.sharedWithNiveau || 'N/A'})</p>` : ''}
                                                        ${p.sharedWithDepartement ? `<p class="text-gray-600">📍 ${p.sharedWithDepartement}</p>` : ''}
                                                    </div>
                                                </div>
                                                <p class="text-gray-500 text-xs mt-2 text-center bg-white rounded p-1">
                                                    📅 ${formatDate(p.sharedAt)} à ${new Date(p.sharedAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                                                </p>
                                            </div>
                                        `).join('')}
                                    </div>
                                </div>
                            ` : ''}
                        </div>

                        <!-- ACTIONS selon niveau -->
                        <div class="flex gap-3 flex-wrap">
                            <!-- Télécharger : Tous les niveaux -->
                            <button onclick="downloadDoc(state.selectedDoc)"
                                    class="flex-1 min-w-[200px] px-6 py-4 btn-primary text-white rounded-xl hover:shadow-lg transition font-semibold flex items-center justify-center gap-2">
                                <span class="text-xl">📥</span> Télécharger
                            </button>

                            ${state.currentUserInfo && state.currentUserInfo.niveau === 1 ? `
                                <!-- NIVEAU 1 : Télécharger, Partager (sauf ses propres docs) et Supprimer N'IMPORTE QUEL document -->
                                ${state.selectedDoc.idUtilisateur !== state.currentUser ? `
                                    <button onclick="openShareModal('${state.selectedDoc._id}')"
                                            class="flex-1 min-w-[200px] px-6 py-4 bg-gradient-to-br from-blue-500 to-blue-600 text-white rounded-xl hover:shadow-lg transition font-semibold flex items-center justify-center gap-2">
                                        <span class="text-xl">📤</span> Partager
                                    </button>
                                ` : ''}
                                <button onclick="deleteDoc('${state.selectedDoc._id}')"
                                        class="flex-1 min-w-[200px] px-6 py-4 bg-gradient-to-br from-red-500 to-red-600 text-white rounded-xl hover:shadow-lg transition font-semibold flex items-center justify-center gap-2">
                                    <span class="text-xl">🗑️</span> Supprimer
                                </button>
                            ` : ''}

                            ${state.currentUserInfo && state.currentUserInfo.niveau === 2 ? `
                                <!-- NIVEAU 2 : Télécharger, Partager (sauf ses propres docs) et Demander suppression -->
                                ${state.selectedDoc.idUtilisateur !== state.currentUser ? `
                                    <button onclick="openShareModal('${state.selectedDoc._id}')"
                                            class="flex-1 min-w-[200px] px-6 py-4 bg-gradient-to-br from-blue-500 to-blue-600 text-white rounded-xl hover:shadow-lg transition font-semibold flex items-center justify-center gap-2">
                                        <span class="text-xl">📤</span> Partager
                                    </button>
                                ` : ''}
                                ${state.selectedDoc.idUtilisateur === state.currentUser ? `
                                    <button onclick="requestDeletion('${state.selectedDoc._id}')"
                                        class="flex-1 min-w-[200px] px-6 py-4 bg-gradient-to-br from-orange-500 to-red-600 text-white rounded-xl hover:shadow-lg transition font-semibold flex items-center justify-center gap-2">
                                    <span class="text-xl">📝</span> Demander suppression
                                </button>
                                ` : ''}
                            ` : ''}

                            <!-- NIVEAU 3 : Seulement télécharger (pas d'action supplémentaire) -->
                        </div>
                    </div>
                </div>
            ` : ''}
            
            ${state.showDeleteConfirm ? `
                <div class="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
                    <div class="modal-glass rounded-2xl p-8 max-w-md w-full shadow-2xl animate-fade-in">
                        <h2 class="text-2xl font-bold mb-4 text-red-600">🚨 DERNIÈRE CONFIRMATION 🚨</h2>
                        <p class="text-lg mb-4">TOUS tes <strong>${state.documents.length} documents</strong> seront DÉFINITIVEMENT supprimés!</p>
                        <p class="text-gray-700 mb-6">Es-tu VRAIMENT sûr(e)?</p>
                        <div class="flex gap-3">
                            <button onclick="confirmDeleteAll()"
                                    class="flex-1 px-6 py-4 bg-gradient-to-br from-red-500 to-red-600 text-white rounded-xl hover:shadow-lg transition font-semibold">
                                ✅ OUI, tout supprimer
                            </button>
                            <button onclick="cancelDeleteAll()"
                                    class="flex-1 px-6 py-4 bg-gradient-to-br from-gray-100 to-gray-200 rounded-xl hover:shadow-md transition font-medium">
                                ❌ Annuler
                            </button>
                        </div>
                    </div>
                </div>
            ` : ''}

            ${state.showShareModal ? `
                <div class="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4 backdrop-blur-sm"
                     onclick="if(event.target === this) closeShareModal()">
                    <div class="modal-glass rounded-2xl p-8 max-w-2xl w-full max-h-[80vh] overflow-y-auto shadow-2xl animate-fade-in" onclick="event.stopPropagation()">
                        <div class="flex justify-between items-start mb-6">
                            <h2 class="text-3xl font-bold text-gray-800">📤 Partager le document</h2>
                            <button onclick="closeShareModal()" class="text-2xl text-gray-600 hover:text-gray-800 transition">✖</button>
                        </div>

                        <div class="mb-6">
                            <p class="text-gray-600 mb-2">Document: <strong>${state.selectedDoc ? state.selectedDoc.titre : ''}</strong></p>
                            <p class="text-sm text-gray-500">Sélectionnez les utilisateurs avec qui partager ce document</p>
                        </div>

                        ${state.shareAvailableUsers.length === 0 ? `
                            <div class="text-center py-8">
                                <div class="text-4xl mb-3">👥</div>
                                <p class="text-gray-600">Chargement des utilisateurs...</p>
                            </div>
                        ` : `
                            <!-- ✅ NOUVEAU: Barre de recherche -->
                            <div class="mb-4">
                                <input type="text"
                                       placeholder="🔍 Rechercher un utilisateur (nom, email, département)..."
                                       value="${state.shareSearchTerm}"
                                       oninput="updateShareSearch(this.value)"
                                       class="w-full px-4 py-3 border-2 border-gray-300 rounded-xl focus:border-blue-500 focus:ring-2 focus:ring-blue-200 transition">
                            </div>

                            <!-- ✅ NOUVEAU: Bouton Tout sélectionner / Tout désélectionner -->
                            <div class="mb-4 flex items-center justify-between bg-blue-50 p-3 rounded-xl">
                                <span class="text-sm text-gray-700">
                                    ${state.shareSelectedUsers.length} utilisateur(s) sélectionné(s) sur ${getFilteredShareUsers().length}
                                </span>
                                <button onclick="toggleSelectAll()"
                                        class="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition font-medium text-sm">
                                    ${state.shareSelectedUsers.length === getFilteredShareUsers().length ? '❌ Tout désélectionner' : '✅ Tout sélectionner'}
                                </button>
                            </div>

                            <!-- Liste des utilisateurs -->
                            <div class="space-y-2 max-h-96 overflow-y-auto mb-6 border-2 border-gray-200 rounded-xl p-2">
                                ${getFilteredShareUsers().length === 0 ? `
                                    <div class="text-center py-8 text-gray-500">
                                        <div class="text-4xl mb-2">🔍</div>
                                        <p>Aucun utilisateur trouvé</p>
                                    </div>
                                ` : getFilteredShareUsers().map(user => `
                                    <label class="flex items-center gap-3 p-4 bg-white rounded-xl hover:shadow-md transition cursor-pointer border-2 ${state.shareSelectedUsers.includes(user.username) ? 'border-blue-500 bg-blue-50' : 'border-gray-200'}">
                                        <input type="checkbox"
                                               ${state.shareSelectedUsers.includes(user.username) ? 'checked' : ''}
                                               onchange="toggleUserSelection('${user.username}')"
                                               class="w-5 h-5 text-blue-600 rounded focus:ring-2 focus:ring-blue-500">
                                        <div class="flex-1">
                                            <div class="font-semibold text-gray-800">${user.nom}</div>
                                            <div class="text-sm text-gray-600">
                                                ${user.email} • ${user.departement}
                                            </div>
                                        </div>
                                    </label>
                                `).join('')}
                            </div>

                            <!-- Boutons d'action -->
                            <div class="flex gap-3">
                                <button onclick="confirmShare()"
                                        class="flex-1 px-6 py-4 bg-gradient-to-br from-blue-500 to-blue-600 text-white rounded-xl hover:shadow-lg transition font-semibold flex items-center justify-center gap-2"
                                        ${state.shareSelectedUsers.length === 0 ? 'disabled opacity-50 cursor-not-allowed' : ''}>
                                    <span class="text-xl">✅</span> Valider le partage (${state.shareSelectedUsers.length})
                                </button>
                                <button onclick="closeShareModal()"
                                        class="px-6 py-4 bg-gradient-to-br from-gray-100 to-gray-200 rounded-xl hover:shadow-md transition font-medium">
                                    ❌ Annuler
                                </button>
                            </div>
                        `}
                    </div>
                </div>
            ` : ''}

            ${state.showComposeMessage ? `
                <div class="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4 backdrop-blur-sm"
                     onclick="if(event.target === this) closeComposeMessage()">
                    <div class="modal-glass rounded-2xl p-8 max-w-2xl w-full shadow-2xl animate-fade-in" onclick="event.stopPropagation()">
                        <div class="flex justify-between items-start mb-6">
                            <h2 class="text-3xl font-bold text-gray-800">✉️ Nouveau message</h2>
                            <button onclick="closeComposeMessage()" class="text-2xl text-gray-600 hover:text-gray-800 transition">✖</button>
                        </div>

                        <div class="space-y-4">
                            <div>
                                <label class="block text-sm font-semibold text-gray-700 mb-2">Destinataire *</label>
                                <select onchange="state.composeMessageTo = this.value; render();"
                                        class="w-full px-4 py-3 border-2 border-gray-300 rounded-xl focus:border-blue-500 focus:ring-2 focus:ring-blue-200 transition">
                                    <option value="">-- Sélectionner un utilisateur --</option>
                                    ${state.allUsers.map(user => `
                                        <option value="${user.username}" ${state.composeMessageTo === user.username ? 'selected' : ''}>
                                            ${user.nom} (${user.username}) - ${user.departement}
                                        </option>
                                    `).join('')}
                                </select>
                            </div>

                            <div>
                                <label class="block text-sm font-semibold text-gray-700 mb-2">Sujet *</label>
                                <input type="text"
                                       value="${state.composeMessageSubject}"
                                       oninput="state.composeMessageSubject = this.value"
                                       placeholder="Entrez le sujet du message"
                                       class="w-full px-4 py-3 border-2 border-gray-300 rounded-xl focus:border-blue-500 focus:ring-2 focus:ring-blue-200 transition">
                            </div>

                            <div>
                                <label class="block text-sm font-semibold text-gray-700 mb-2">Message *</label>
                                <textarea
                                       oninput="state.composeMessageBody = this.value"
                                       placeholder="Entrez votre message..."
                                       rows="8"
                                       class="w-full px-4 py-3 border-2 border-gray-300 rounded-xl focus:border-blue-500 focus:ring-2 focus:ring-blue-200 transition resize-none">${state.composeMessageBody}</textarea>
                            </div>

                            <div class="flex gap-3">
                                <button onclick="sendNewMessage()"
                                        class="flex-1 px-6 py-4 bg-gradient-to-br from-blue-500 to-blue-600 text-white rounded-xl hover:shadow-lg transition font-semibold">
                                    ✅ Envoyer le message
                                </button>
                                <button onclick="closeComposeMessage()"
                                        class="px-6 py-4 bg-gradient-to-br from-gray-100 to-gray-200 rounded-xl hover:shadow-md transition font-medium">
                                    ❌ Annuler
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            ` : ''}

            ${state.showMessages ? `
                <div class="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4 backdrop-blur-sm"
                     onclick="if(event.target === this) closeMessages()">
                    <div class="modal-glass rounded-2xl p-8 max-w-4xl w-full max-h-[85vh] overflow-y-auto shadow-2xl animate-fade-in" onclick="event.stopPropagation()">
                        <div class="flex justify-between items-start mb-6">
                            <div>
                                <h2 class="text-3xl font-bold text-gray-800">📬 Boîte de réception</h2>
                                <p class="text-sm text-gray-600 mt-1">${state.messages.length} message(s) • ${state.unreadCount} non lu(s)</p>
                            </div>
                            <button onclick="closeMessages()" class="text-2xl text-gray-600 hover:text-gray-800 transition">✖</button>
                        </div>

                        ${state.messages.length === 0 ? `
                            <div class="text-center py-16">
                                <div class="text-6xl mb-4">📭</div>
                                <p class="text-xl text-gray-600 font-semibold mb-2">Aucun message</p>
                                <p class="text-gray-500">Votre boîte de réception est vide</p>
                            </div>
                        ` : `
                            <div class="space-y-3">
                                ${state.messages.map(msg => `
                                    <div class="bg-white rounded-xl p-5 border-2 ${msg.read ? 'border-gray-200' : 'border-blue-400 bg-blue-50'} hover:shadow-md transition">
                                        <div class="flex justify-between items-start mb-3">
                                            <div class="flex items-center gap-3">
                                                ${!msg.read ? '<div class="w-3 h-3 bg-blue-500 rounded-full"></div>' : ''}
                                                <div>
                                                    <div class="font-bold text-gray-800 text-lg">${msg.subject}</div>
                                                    <div class="text-sm text-gray-600">De: ${msg.fromName} (${msg.from})</div>
                                                </div>
                                            </div>
                                            <div class="text-xs text-gray-500">
                                                ${new Date(msg.createdAt).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                                            </div>
                                        </div>

                                        <div class="text-gray-700 mb-4 p-4 bg-gray-50 rounded-lg border border-gray-200 whitespace-pre-line">
                                            ${msg.body}
                                        </div>

                                        <div class="flex gap-2 flex-wrap">
                                            ${!msg.read ? `
                                                <button onclick="markMessageAsRead('${msg._id}')"
                                                        class="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition text-sm font-medium">
                                                    ✅ Marquer comme lu
                                                </button>
                                            ` : ''}

                                            ${msg.type === 'deletion-request' && msg.relatedData ? `
                                                <button onclick="approveFromMessage('${msg.relatedData.requestId}')"
                                                        class="px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 transition text-sm font-medium">
                                                    ✅ Approuver la suppression
                                                </button>
                                                <button onclick="rejectFromMessage('${msg.relatedData.requestId}')"
                                                        class="px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 transition text-sm font-medium">
                                                    ❌ Rejeter la demande
                                                </button>
                                            ` : ''}

                                            <button onclick="deleteMessage('${msg._id}')"
                                                    class="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition text-sm font-medium">
                                                🗑️ Supprimer
                                            </button>
                                        </div>
                                    </div>
                                `).join('')}
                            </div>
                        `}

                        <div class="mt-6 flex gap-3">
                            <button onclick="loadMessages(); render();"
                                    class="flex-1 px-6 py-3 bg-blue-500 text-white rounded-xl hover:bg-blue-600 transition font-medium">
                                🔄 Actualiser
                            </button>
                            <button onclick="closeMessages()"
                                    class="px-6 py-3 bg-gray-200 text-gray-700 rounded-xl hover:bg-gray-300 transition font-medium">
                                ❌ Fermer
                            </button>
                        </div>
                    </div>
                </div>
            ` : ''}

            ${state.loading ? `
                <div class="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center backdrop-blur-sm">
                    <div class="modal-glass p-8 rounded-2xl shadow-2xl">
                        <div class="loader mx-auto mb-4"></div>
                        <p class="text-lg font-semibold text-gray-700">⏳ Chargement...</p>
                    </div>
                </div>
            ` : ''}
        </div>
    `;
}

// Initialisation
render();
loadRolesAndDepartements(); // Charger les rôles et départements au démarrage