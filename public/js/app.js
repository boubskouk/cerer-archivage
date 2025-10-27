// ===== CONFIGURATION =====

// État de l'application
const state = {
    documents: [], 
    categories: [], 
    searchTerm: '', 
    selectedCategory: 'tous',
    dateFrom: '',
    dateTo: '',
    dateType: 'document',
    tempSearchTerm: '', 
    tempSelectedCategory: 'tous',
    tempDateFrom: '',
    tempDateTo: '',
    tempDateType: 'document',
    selectedDoc: null, 
    showUploadForm: false, 
    showMenu: false, 
    showCategories: false,
    showDeleteConfirm: false,
    isAuthenticated: false, 
    currentUser: null, 
    showRegister: false,
    storageInfo: { usedMB: 0, totalMB: 1000, percentUsed: 0 },
    loading: false, 
    importProgress: { show: false, current: 0, total: 0, message: '' },
    sortBy: 'dateAjout_desc' // NOUVEAU : Tri par défaut
};

// Données du formulaire
let formData = {
    titre: '', 
    categorie: 'factures', 
    date: new Date().toISOString().split('T')[0],
    dateAjout: new Date().toISOString().split('T')[0],
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
            state.isAuthenticated = true;
            await loadData();
            showNotification(`✅ Bienvenue ${username}!`);
            return true;
        }
    } catch (error) { 
        return false; 
    }
}

async function register(username, password, adminPassword) {
    if (adminPassword !== '0811') {
        showNotification('Mot de passe admin incorrect', 'error');
        return false;
    }
    try {
        const result = await apiCall('/register', 'POST', { username, password });
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
        render();
    } catch (error) { 
        state.loading = false; 
        render(); 
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
    const count = state.documents.length;
    try {
        await apiCall(`/documents/${state.currentUser}/delete-all`, 'DELETE');
        state.showMenu = false;
        state.showDeleteConfirm = false;
        showNotification(`✅ ${count} documents supprimés!`);
        await loadData();
    } catch (error) {
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
        dateAjout: new Date().toISOString().split('T')[0],
        description: '', 
        tags: '' 
    };
    showNotification('✅ Ajouté!');
    render();
    e.target.value = '';
}

async function downloadDoc(doc) {
    const fullDoc = await apiCall(`/documents/${state.currentUser}/${doc._id}`);
    const link = document.createElement('a');
    link.href = fullDoc.contenu;
    link.download = fullDoc.nomFichier;
    link.click();
    showNotification('Téléchargement');
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
        case 'dateAjout_desc':
            return sorted.sort((a, b) => new Date(b.dateAjout) - new Date(a.dateAjout));
        case 'dateAjout_asc':
            return sorted.sort((a, b) => new Date(a.dateAjout) - new Date(b.dateAjout));
        case 'date_desc':
            return sorted.sort((a, b) => new Date(b.date) - new Date(a.date));
        case 'date_asc':
            return sorted.sort((a, b) => new Date(a.date) - new Date(b.date));
        case 'titre_asc':
            return sorted.sort((a, b) => a.titre.localeCompare(b.titre));
        case 'titre_desc':
            return sorted.sort((a, b) => b.titre.localeCompare(a.titre));
        case 'taille_desc':
            return sorted.sort((a, b) => (b.taille || 0) - (a.taille || 0));
        case 'taille_asc':
            return sorted.sort((a, b) => (a.taille || 0) - (b.taille || 0));
        default:
            return sorted;
    }
}

function getFilteredDocs() {
    let filtered = state.documents.filter(doc => {
        const matchSearch = !state.searchTerm || 
            doc.titre.toLowerCase().includes(state.searchTerm.toLowerCase()) ||
            (doc.description && doc.description.toLowerCase().includes(state.searchTerm.toLowerCase())) ||
            (doc.tags && doc.tags.toLowerCase().includes(state.searchTerm.toLowerCase()));
        
        const matchCategory = state.selectedCategory === 'tous' || 
            doc.categorie === state.selectedCategory;
        
        let matchDate = true;
        if (state.dateFrom || state.dateTo) {
            const dateToCheck = state.dateType === 'ajout' ? doc.dateAjout : doc.date;
            
            if (state.dateFrom) {
                matchDate = matchDate && new Date(dateToCheck) >= new Date(state.dateFrom);
            }
            if (state.dateTo) {
                matchDate = matchDate && new Date(dateToCheck) <= new Date(state.dateTo + 'T23:59:59');
            }
        }
        
        return matchSearch && matchCategory && matchDate;
    });
    
    // NOUVEAU : Appliquer le tri
    return sortDocuments(filtered);
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
    render(); 
}

function toggleRegister() { 
    state.showRegister = !state.showRegister; 
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
    state.dateFrom = state.tempDateFrom;
    state.dateTo = state.tempDateTo;
    state.dateType = state.tempDateType;
    render();
}

function resetFilters() {
    state.searchTerm = '';
    state.selectedCategory = 'tous';
    state.dateFrom = '';
    state.dateTo = '';
    state.dateType = 'document';
    state.tempSearchTerm = '';
    state.tempSelectedCategory = 'tous';
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
    const username = document.getElementById('reg_username').value.trim();
    const password = document.getElementById('reg_password').value;
    const passwordConfirm = document.getElementById('reg_password_confirm').value;
    const adminPassword = document.getElementById('reg_admin_password').value;
    if (!username || !password || !passwordConfirm || !adminPassword) {
        return showNotification('Remplir tous', 'error');
    }
    if (username.length < 3 || password.length < 4) {
        return showNotification('Username: 3+, Password: 4+', 'error');
    }
    if (password !== passwordConfirm) {
        return showNotification('Mots de passe différents', 'error');
    }
    const success = await register(username, password, adminPassword);
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
                        <div class="space-y-4">
                            <h2 class="text-xl font-semibold text-gray-700">Créer un compte</h2>
                            <input id="reg_username" type="text" placeholder="Nom d'utilisateur (3+ caractères)" 
                                   class="w-full px-4 py-3 border-2 rounded-xl input-modern">
                            <input id="reg_password" type="password" placeholder="Mot de passe (4+ caractères)" 
                                   class="w-full px-4 py-3 border-2 rounded-xl input-modern">
                            <input id="reg_password_confirm" type="password" placeholder="Confirmer le mot de passe" 
                                   class="w-full px-4 py-3 border-2 rounded-xl input-modern">
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
            <header class="header-glass sticky top-0 z-40 shadow-lg">
                <div class="max-w-7xl mx-auto px-4 py-4">
                    <div class="flex justify-between items-center mb-4">
                        <div class="logo-container">
                            <img src="/logo_white.png" alt="Logo C.E.R.E.R" class="w-16 h-16 animate-float" style="filter: drop-shadow(0 4px 6px rgba(59, 130, 246, 0.3));">
                            <div>
                                <h1 class="logo-text">C.E.R.E.R</h1>
                                <p class="text-sm text-gray-600">Bonjour, <strong>${state.currentUser}</strong></p>
                            </div>
                        </div>
                        <div class="flex gap-2">
                            <button onclick="toggleUploadForm()" 
                                    class="px-6 py-3 btn-primary text-white rounded-xl hover:shadow-lg transition font-semibold">
                                ➕ Ajouter
                            </button>
                            <button onclick="toggleMenu()" 
                                    class="px-4 py-3 bg-gradient-to-br from-gray-100 to-gray-200 rounded-xl hover:shadow-lg transition">
                                ☰
                            </button>
                        </div>
                    </div>
                    
                    <div class="flex flex-col gap-3">
                        <div class="flex gap-3 flex-wrap">
                            <div class="flex-1 min-w-[200px] search-bar">
                                <input type="text" placeholder="🔍 Rechercher un document..." 
                                       value="${state.tempSearchTerm}"
                                       oninput="updateTempSearch(this.value)"
                                       class="w-full px-4 py-3 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition">
                            </div>
                            <select onchange="updateTempCategory(this.value)" 
                                    class="px-4 py-3 border-2 rounded-xl input-modern outline-none font-medium">
 value="tous" ${state.tempSelectedCategory === 'tous' ? 'selected' : ''}>📚 Toutes catégories</option>
                                ${state.categories.map(cat => `
                                    <option value="${cat.id}" ${state.tempSelectedCategory === cat.id ? 'selected' : ''}>
                                        ${cat.icon} ${cat.nom}
                                    </option>
                                `).join('')}
                            </select>
                            
                            <!-- NOUVEAU : Sélecteur de tri -->
                            <select onchange="changeSortBy(this.value)" 
                                    class="px-4 py-3 border-2 rounded-xl input-modern outline-none font-medium bg-white">
                                <option value="dateAjout_desc" ${state.sortBy === 'dateAjout_desc' ? 'selected' : ''}>📅 Plus récent (ajout)</option>
                                <option value="dateAjout_asc" ${state.sortBy === 'dateAjout_asc' ? 'selected' : ''}>📅 Plus ancien (ajout)</option>
                                <option value="date_desc" ${state.sortBy === 'date_desc' ? 'selected' : ''}>📄 Plus récent (document)</option>
                                <option value="date_asc" ${state.sortBy === 'date_asc' ? 'selected' : ''}>📄 Plus ancien (document)</option>
                                <option value="titre_asc" ${state.sortBy === 'titre_asc' ? 'selected' : ''}>🔤 A → Z</option>
                                <option value="titre_desc" ${state.sortBy === 'titre_desc' ? 'selected' : ''}>🔤 Z → A</option>
                                <option value="taille_desc" ${state.sortBy === 'taille_desc' ? 'selected' : ''}>📦 Plus gros</option>
                                <option value="taille_asc" ${state.sortBy === 'taille_asc' ? 'selected' : ''}>📦 Plus petit</option>
                            </select>
                        </div>
                        
                        <div class="bg-blue-50 border-2 border-blue-200 rounded-xl p-4">
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
                        
                        <div class="flex gap-2">
                            <button onclick="applyFilters()" 
                                    class="px-6 py-3 btn-primary text-white rounded-xl hover:shadow-lg transition font-semibold">
                                🔎 Filtrer
                            </button>
                            ${activeFilters ? `
                                <button onclick="resetFilters()" 
                                        class="px-6 py-3 bg-gradient-to-br from-red-500 to-red-600 text-white rounded-xl hover:shadow-lg transition font-semibold">
                                    ✖ Réinitialiser
                                </button>
                            ` : ''}
                        </div>
                        
                        ${activeFilters ? `
                            <div class="bg-green-50 border-2 border-green-200 rounded-xl p-3">
                                <p class="text-sm text-green-800">
                                    <strong>✓ ${filteredDocs.length}</strong> document(s) trouvé(s) sur <strong>${state.documents.length}</strong>
                                    ${state.searchTerm ? ` • Recherche: "${state.searchTerm}"` : ''}
                                    ${state.selectedCategory !== 'tous' ? ` • Catégorie: ${getCategoryName(state.selectedCategory)}` : ''}
                                    ${state.dateFrom || state.dateTo ? ` • ${state.dateType === 'ajout' ? 'Date d\'ajout' : 'Date du document'}` : ''}
                                    ${state.dateFrom ? ` • Depuis: ${formatDate(state.dateFrom)}` : ''}
                                    ${state.dateTo ? ` • Jusqu'à: ${formatDate(state.dateTo)}` : ''}
                                </p>
                            </div>
                        ` : ''}
                    </div>
                </div>
            </header>
            
            <main class="max-w-7xl mx-auto px-4 py-8">
                <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                    <div class="stat-card p-4 rounded-xl shadow-md border-blue-500">
                        <div class="flex items-center gap-3">
                            <div class="text-3xl">📊</div>
                            <div>
                                <p class="text-sm text-gray-600">Total documents</p>
                                <p class="text-2xl font-bold text-blue-600">${state.documents.length}</p>
                            </div>
                        </div>
                    </div>
                    <div class="stat-card p-4 rounded-xl shadow-md border-green-500">
                        <div class="flex items-center gap-3">
                            <div class="text-3xl">📁</div>
                            <div>
                                <p class="text-sm text-gray-600">Catégories</p>
                                <p class="text-2xl font-bold text-green-600">${state.categories.length}</p>
                            </div>
                        </div>
                    </div>
                    <div class="stat-card p-4 rounded-xl shadow-md border-purple-500">
                        <div class="flex items-center gap-3">
                            <div class="text-3xl">💾</div>
                            <div>
                                <p class="text-sm text-gray-600">Stockage utilisé</p>
                                <p class="text-2xl font-bold text-purple-600">${state.storageInfo.usedMB} MB</p>
                            </div>
                        </div>
                    </div>
                </div>
                
                <div class="mb-6 flex justify-between items-center">
                    <h2 class="text-xl font-bold text-gray-800">
                        ${filteredDocs.length} document(s) ${activeFilters ? 'trouvé(s)' : ''}
                    </h2>
                </div>
                
                <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    ${filteredDocs.map(doc => `
                        <div onclick="showDocDetail('${doc._id}')" 
                             class="doc-card p-5 rounded-2xl shadow-md cursor-pointer animate-fade-in">
                            <div class="flex justify-between items-start mb-3">
                                <h3 class="font-bold text-gray-800 flex-1 text-lg">${doc.titre}</h3>
                                <span class="text-3xl">${getCategoryIcon(doc.categorie)}</span>
                            </div>
                            <span class="category-badge inline-block px-3 py-1 text-sm rounded-full ${getCategoryColor(doc.categorie)} font-medium">
                                ${getCategoryName(doc.categorie)}
                            </span>
                            <div class="mt-4 space-y-1">
                                <p class="text-sm text-gray-600 flex items-center gap-2">
                                    📄 Date doc: ${formatDate(doc.date)}
                                </p>
                                ${doc.dateAjout ? `
                                <p class="text-xs text-gray-500 flex items-center gap-2">
                                    ➕ Ajouté: ${formatDate(doc.dateAjout)}
                                </p>
                                ` : ''}
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
                    <div class="space-y-2">
                        <button onclick="toggleCategories()" class="w-full text-left px-4 py-4 hover:bg-gradient-to-r hover:from-blue-50 hover:to-green-50 rounded-xl transition font-medium">
                            📂 Gérer les catégories
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
                        <button onclick="logout()" class="w-full text-left px-4 py-4 hover:bg-gradient-to-r hover:from-blue-50 hover:to-green-50 rounded-xl transition font-medium">
                            🚪 Déconnexion
                        </button>
                    </div>
                    <div class="mt-8 storage-badge p-5 rounded-2xl">
                        <p class="text-sm font-bold mb-3 text-gray-700">📊 Stockage</p>
                        <div class="w-full bg-gray-200 rounded-full h-3 mb-2 overflow-hidden">
                            <div class="${getStorageColorClass()} progress-bar h-3 rounded-full transition-all duration-500" 
                                 style="width: ${state.storageInfo.percentUsed}%"></div>
                        </div>
                        <p class="text-xs text-gray-600 font-medium">
                            ${state.storageInfo.usedMB} MB / ${state.storageInfo.totalMB} MB (${state.storageInfo.percentUsed}%)
                        </p>
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
                            <div>
                                <label class="block text-sm font-semibold text-gray-700 mb-1">➕ Date d'ajout</label>
                                <input type="date" value="${formData.dateAjout}"
                                       onchange="updateFormData('dateAjout', this.value)"
                                       class="w-full px-4 py-3 border-2 rounded-xl input-modern">
                            </div>
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
                                <div class="flex justify-between items-center p-4 hover:bg-gradient-to-r hover:from-blue-50 hover:to-green-50 rounded-xl transition">
                                    <span class="font-medium">${cat.icon} ${cat.nom}</span>
                                    <button onclick="deleteCategory('${cat.id}')" 
                                            class="text-red-500 hover:text-red-700 text-xl transition">
                                        🗑️
                                    </button>
                                </div>
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
                                <div class="flex items-center gap-3">
                                    <strong class="text-gray-700">Catégorie:</strong> 
                                    <span class="category-badge inline-block px-3 py-1 text-sm rounded-full ${getCategoryColor(state.selectedDoc.categorie)} font-medium">
                                        ${getCategoryIcon(state.selectedDoc.categorie)} ${getCategoryName(state.selectedDoc.categorie)}
                                    </span>
                                </div>
                                <div class="flex items-center gap-2">
                                    <strong class="text-gray-700">📄 Date document:</strong> 
                                    <span class="text-gray-600">${formatDate(state.selectedDoc.date)}</span>
                                </div>
                                ${state.selectedDoc.dateAjout ? `
                                <div class="flex items-center gap-2">
                                    <strong class="text-gray-700">➕ Date d'ajout:</strong> 
                                    <span class="text-gray-600">${formatDate(state.selectedDoc.dateAjout)}</span>
                                </div>
                                ` : ''}
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
                        </div>
                        
                        <!-- ACTIONS -->
                        <div class="flex gap-3">
                            <button onclick="downloadDoc(state.selectedDoc)" 
                                    class="flex-1 px-6 py-4 btn-primary text-white rounded-xl hover:shadow-lg transition font-semibold flex items-center justify-center gap-2">
                                <span class="text-xl">📥</span> Télécharger
                            </button>
                            <button onclick="deleteDoc('${state.selectedDoc._id}')" 
                                    class="flex-1 px-6 py-4 bg-gradient-to-br from-red-500 to-red-600 text-white rounded-xl hover:shadow-lg transition font-semibold flex items-center justify-center gap-2">
                                <span class="text-xl">🗑️</span> Supprimer
                            </button>
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