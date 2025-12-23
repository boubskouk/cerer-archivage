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
    showUsersManagement: false,
    editingUser: null,
    allUsersForManagement: [],
    showRolesManagement: false,
    editingRole: null,
    showAdvancedStats: false,
    showDeleteConfirm: false,
    isAuthenticated: false,
    isCheckingSession: true, // NOUVEAU : Vérifier si on restaure une session
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
    showMessagingSection: false, // NOUVEAU : Afficher la section messagerie dans la page principale
    userSearchTerm: '', // NOUVEAU : Terme de recherche pour filtrer les utilisateurs destinataires
    showUserDropdown: false, // NOUVEAU : Afficher le dropdown de recherche
    selectedUser: null // NOUVEAU : Utilisateur sélectionné
};

// Données du formulaire
let formData = {
    titre: '',
    categorie: 'factures',
    date: new Date().toISOString().split('T')[0],
    departementArchivage: '', // Département d'archivage
    description: '',
    tags: '',
    locked: false // Verrouillage du document (niveau 1 uniquement)
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

// ===== GESTION DES SESSIONS =====

// Sauvegarder la session dans sessionStorage (expire à la fermeture du navigateur)
function saveSession(username, userInfo) {
    try {
        sessionStorage.setItem('cerer_session', JSON.stringify({
            username,
            userInfo,
            timestamp: Date.now()
        }));
    } catch (error) {
        console.error('Erreur sauvegarde session:', error);
    }
}

// Restaurer la session depuis sessionStorage
async function restoreSession() {
    try {
        const sessionData = sessionStorage.getItem('cerer_session');
        if (!sessionData) {
            state.isCheckingSession = false;
            return false;
        }

        const { username, userInfo, timestamp } = JSON.parse(sessionData);

        // Vérifier que la session n'est pas trop ancienne (7 jours)
        const sevenDays = 7 * 24 * 60 * 60 * 1000;
        if (Date.now() - timestamp > sevenDays) {
            clearSession();
            state.isCheckingSession = false;
            return false;
        }

        // Vérifier que la session est toujours valide côté serveur
        const result = await apiCall('/verify-session', 'POST', { username });
        if (result.success) {
            state.currentUser = username;
            state.currentUserInfo = userInfo;
            state.isAuthenticated = true;
            state.isCheckingSession = false;

            // Démarrer le système de déconnexion automatique
            startInactivityTimer();

            await loadData();
            return true;
        } else {
            clearSession();
            state.isCheckingSession = false;
            return false;
        }
    } catch (error) {
        console.error('Erreur restauration session:', error);
        clearSession();
        state.isCheckingSession = false;
        return false;
    }
}

// Nettoyer la session
function clearSession() {
    try {
        sessionStorage.removeItem('cerer_session');
    } catch (error) {
        console.error('Erreur nettoyage session:', error);
    }
}

// ===== SYSTÈME DE DÉCONNEXION AUTOMATIQUE =====
let inactivityTimer = null;
const INACTIVITY_TIMEOUT = 10 * 60 * 1000; // 10 minutes en millisecondes

// Démarrer le système de détection d'inactivité
function startInactivityTimer() {
    // Réinitialiser le timer existant
    resetInactivityTimer();

    // Événements à surveiller pour détecter l'activité
    const events = ['mousedown', 'mousemove', 'keypress', 'scroll', 'touchstart', 'click'];

    // Ajouter les écouteurs d'événements
    events.forEach(event => {
        document.addEventListener(event, resetInactivityTimer, true);
    });
}

// Réinitialiser le timer d'inactivité
function resetInactivityTimer() {
    // Annuler le timer existant
    if (inactivityTimer) {
        clearTimeout(inactivityTimer);
    }

    // Ne démarrer le timer que si l'utilisateur est connecté
    if (state.isAuthenticated) {
        inactivityTimer = setTimeout(() => {
            console.log('Déconnexion automatique après inactivité');
            logout(true); // Déconnexion automatique
        }, INACTIVITY_TIMEOUT);
    }
}

// Arrêter le système de détection d'inactivité
function stopInactivityTimer() {
    if (inactivityTimer) {
        clearTimeout(inactivityTimer);
        inactivityTimer = null;
    }

    // Retirer tous les écouteurs d'événements
    const events = ['mousedown', 'mousemove', 'keypress', 'scroll', 'touchstart', 'click'];
    events.forEach(event => {
        document.removeEventListener(event, resetInactivityTimer, true);
    });
}

// Démarrer le timer de réinitialisation automatique des filtres (5 minutes)
function startFilterResetTimer() {
    // Arrêter le timer existant s'il y en a un
    if (window.filterResetTimer) {
        clearInterval(window.filterResetTimer);
    }

    // Créer un nouveau timer qui se déclenche toutes les 5 minutes
    window.filterResetTimer = setInterval(() => {
        console.log('🔄 Réinitialisation automatique des filtres après 5 minutes');
        resetFilters();
        showNotification('🔄 Filtres réinitialisés automatiquement', 'info');
    }, 5 * 60 * 1000); // 5 minutes en millisecondes
}

// ===== AUTHENTIFICATION =====
async function login(username, password) {
    try {
        const result = await apiCall('/login', 'POST', { username, password });
        if (result.success) {
            state.currentUser = username;
            state.currentUserInfo = result.user; // Stocker les infos complètes (nom, rôle, niveau)
            state.isAuthenticated = true;

            // ✅ NOUVEAU: Vérifier si l'utilisateur doit changer son mot de passe
            if (result.mustChangePassword || result.firstLogin) {
                // Sauvegarder temporairement les identifiants pour le changement de mot de passe
                state.tempPassword = password;
                state.mustChangePassword = true;

                // Afficher le formulaire de changement de mot de passe obligatoire
                render();
                showNotification('🔐 Vous devez changer votre mot de passe', 'warning');
                return true;
            }

            // Sauvegarder la session
            saveSession(username, result.user);

            // Démarrer le système de déconnexion automatique
            startInactivityTimer();

            // Démarrer le timer de réinitialisation automatique des filtres
            startFilterResetTimer();

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

// ✅ NOUVEAU: Gérer le changement de mot de passe obligatoire
async function handlePasswordChange() {
    const oldPassword = document.getElementById('change_old_password').value;
    const newPassword = document.getElementById('change_new_password').value;
    const confirmPassword = document.getElementById('change_confirm_password').value;

    // Validations
    if (!oldPassword || !newPassword || !confirmPassword) {
        showNotification('❌ Veuillez remplir tous les champs', 'error');
        return;
    }

    if (newPassword.length < 4) {
        showNotification('❌ Le nouveau mot de passe doit contenir au moins 4 caractères', 'error');
        return;
    }

    if (newPassword !== confirmPassword) {
        showNotification('❌ Les mots de passe ne correspondent pas', 'error');
        return;
    }

    if (oldPassword === newPassword) {
        showNotification('❌ Le nouveau mot de passe doit être différent de l\'ancien', 'error');
        return;
    }

    try {
        const result = await apiCall('/change-password', 'POST', {
            username: state.currentUser,
            oldPassword,
            newPassword,
            confirmPassword
        });

        if (result.success) {
            showNotification('✅ Mot de passe modifié avec succès!');

            // Marquer que le mot de passe a été changé
            state.mustChangePassword = false;
            state.tempPassword = null;

            // Sauvegarder la session et charger les données
            saveSession(state.currentUser, state.currentUserInfo);
            startInactivityTimer();
            startFilterResetTimer();
            await loadData();

            // Afficher l'interface principale
            render();
        }
    } catch (error) {
        console.error('Erreur lors du changement de mot de passe:', error);
    }
}

async function logout(isAutoLogout = false) {
    if (!isAutoLogout) {
        const confirmed = await customConfirm({
            title: 'Déconnexion',
            message: 'Êtes-vous sûr de vouloir vous déconnecter ?',
            confirmText: 'Oui, me déconnecter',
            cancelText: 'Annuler',
            type: 'warning',
            icon: '👋'
        });

        if (!confirmed) return;
    }

    // Réinitialiser tous les filtres avant de se déconnecter
    resetFilters();

    // Arrêter le timer de réinitialisation automatique
    if (window.filterResetTimer) {
        clearInterval(window.filterResetTimer);
        window.filterResetTimer = null;
    }

    // Nettoyer la session
    clearSession();

    // Arrêter le système de détection d'inactivité
    stopInactivityTimer();

    state.currentUser = null;
    state.currentUserInfo = null;
    state.isAuthenticated = false;
    state.documents = [];
    state.categories = [];

    if (isAutoLogout) {
        showNotification('⏰ Déconnexion automatique après 10 minutes d\'inactivité', 'warning');
    } else {
        showNotification('✅ Déconnexion réussie');
    }

    render();
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
        const rolesData = await apiCall('/roles');
        state.roles = rolesData.roles || [];
        const deptsData = await apiCall('/departements');
        state.departements = deptsData.departements || [];
        console.log('✅ Rôles et départements chargés:', state.roles.length, 'rôles,', state.departements.length, 'départements');
        render();
    } catch (error) {
        console.error('❌ Erreur chargement rôles/départements:', error);
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
    const confirmed = await customConfirm({
        title: 'Supprimer le document',
        message: 'Voulez-vous vraiment supprimer ce document ? Cette action est irréversible.',
        confirmText: 'Oui, supprimer',
        cancelText: 'Annuler',
        type: 'danger',
        icon: '🗑️'
    });

    if (!confirmed) return;

    await apiCall(`/documents/${state.currentUser}/${id}`, 'DELETE');
    state.selectedDoc = null;
    await loadData();
    showNotification('✅ Document supprimé');
}

// Verrouiller/Déverrouiller un document (niveau 1 uniquement)
async function toggleDocumentLock(docId) {
    try {
        const result = await apiCall(`/documents/${state.currentUser}/${docId}/toggle-lock`, 'POST');

        if (result.success) {
            // Mettre à jour le document dans l'état
            const doc = state.documents.find(d => d._id === docId);
            if (doc) {
                doc.locked = result.locked;
                doc.lockedBy = result.lockedBy;
            }

            // Mettre à jour le document sélectionné si c'est lui
            if (state.selectedDoc && state.selectedDoc._id === docId) {
                state.selectedDoc.locked = result.locked;
                state.selectedDoc.lockedBy = result.lockedBy;
            }

            showNotification(result.locked ? '🔒 Document verrouillé' : '🔓 Document déverrouillé');
            render();
        } else {
            showNotification(result.message || 'Erreur lors du verrouillage', 'error');
        }
    } catch (error) {
        console.error('Erreur toggleDocumentLock:', error);
        showNotification('Erreur lors du verrouillage', 'error');
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

    if (count > 0) {
        const confirmed = await customConfirm({
            title: 'Supprimer la catégorie',
            message: `Cette catégorie contient ${count} document(s). Les documents seront déplacés vers "Autre". Continuer ?`,
            confirmText: 'Oui, supprimer',
            cancelText: 'Annuler',
            type: 'warning',
            icon: '⚠️'
        });

        if (!confirmed) return;
    } else {
        const confirmed = await customConfirm({
            title: 'Supprimer la catégorie',
            message: 'Voulez-vous vraiment supprimer cette catégorie ?',
            confirmText: 'Oui, supprimer',
            cancelText: 'Annuler',
            type: 'danger',
            icon: '🗑️'
        });

        if (!confirmed) return;
    }

    try {
        await apiCall(`/categories/${state.currentUser}/${catId}`, 'DELETE');
        await loadData();
        showNotification('✅ Catégorie supprimée');
    } catch (error) {
        console.error('Erreur suppression catégorie:', error);
    }
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

    await apiCall('/departements', 'POST', { nom, code });
    await loadRolesAndDepartements();
    showNotification('✅ Département créé');
    document.getElementById('new_dept_nom').value = '';
    document.getElementById('new_dept_code').value = '';
}

async function deleteDepartement(deptId) {
    const confirmed = await customConfirm({
        title: 'Supprimer le département',
        message: 'Voulez-vous vraiment supprimer ce département ? Cette action est irréversible.',
        confirmText: 'Oui, supprimer',
        cancelText: 'Annuler',
        type: 'danger',
        icon: '🗑️'
    });

    if (!confirmed) return;

    try {
        await apiCall(`/departements/${deptId}`, 'DELETE');
        await loadRolesAndDepartements();
        showNotification('✅ Département supprimé');
    } catch (error) {
        console.error('Erreur suppression département:', error);
    }
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

    await apiCall(`/departements/${state.editingDepartement._id}`, 'PUT', { nom, code });
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

// Copier l'ID d'un document dans le presse-papiers
function copyDocumentId(docId) {
    if (!docId) {
        showNotification('Aucun ID à copier', 'error');
        return;
    }

    // Méthode moderne avec l'API Clipboard
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(docId)
            .then(() => {
                showNotification(`✅ ID copié : ${docId}`, 'success');
            })
            .catch(err => {
                console.error('Erreur copie clipboard:', err);
                // Fallback vers la méthode ancienne
                fallbackCopyToClipboard(docId);
            });
    } else {
        // Fallback pour les navigateurs plus anciens
        fallbackCopyToClipboard(docId);
    }
}

// Méthode de fallback pour copier dans le presse-papiers
function fallbackCopyToClipboard(text) {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();

    try {
        const successful = document.execCommand('copy');
        if (successful) {
            showNotification(`✅ ID copié : ${text}`, 'success');
        } else {
            showNotification('Erreur lors de la copie', 'error');
        }
    } catch (err) {
        console.error('Erreur copie fallback:', err);
        showNotification('Erreur lors de la copie', 'error');
    }

    document.body.removeChild(textarea);
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
        tags: '',
        locked: false
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

// ===== ÉDITION OFFICE =====

// Vérifier si un fichier est un fichier Office éditable
function isEditableOfficeFile(fileName) {
    if (!fileName) return false;
    const ext = fileName.toLowerCase();
    return ext.endsWith('.xlsx') || ext.endsWith('.xls');
}

// Vérifier si un fichier est un document Office (Word, Excel, PowerPoint)
function isOfficeDocument(fileName) {
    if (!fileName) return false;
    const ext = fileName.toLowerCase().split('.').pop();
    const officeExtensions = ['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'odt', 'ods', 'odp'];
    return officeExtensions.includes(ext);
}

// Éditer un document Excel
async function editExcelDocument(doc) {
    try {
        // Créer une interface modale pour l'édition
        const modalHtml = `
            <div id="editExcelModal" class="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
                <div class="modal-glass rounded-2xl p-8 max-w-4xl w-full max-h-[90vh] overflow-y-auto shadow-2xl animate-fade-in">
                    <div class="flex justify-between items-start mb-6">
                        <h2 class="text-3xl font-bold text-gray-800">✏️ Éditer le tableur Excel</h2>
                        <button onclick="closeEditExcelModal()" class="text-2xl text-red-600 hover:text-red-800 font-bold transition">✖</button>
                    </div>

                    <div class="mb-6 bg-blue-50 p-4 rounded-xl border-2 border-blue-200">
                        <p class="text-gray-700"><strong>📊 Fichier:</strong> ${doc.nomFichier}</p>
                        <p class="text-sm text-blue-900 font-semibold mt-2">Modifiez les cellules ci-dessous. Format: <code>A1</code>, <code>B2</code>, etc.</p>
                    </div>

                    <div id="cellEditsContainer" class="space-y-3 mb-6">
                        <div class="flex gap-3 items-center">
                            <input type="text" id="cell_0" placeholder="Cellule (ex: A1)"
                                   class="w-32 px-3 py-2 border-2 rounded-lg input-modern">
                            <input type="text" id="value_0" placeholder="Nouvelle valeur"
                                   class="flex-1 px-3 py-2 border-2 rounded-lg input-modern">
                        </div>
                    </div>

                    <button onclick="addCellEditRow()"
                            class="w-full px-4 py-3 bg-gray-100 text-gray-700 rounded-xl hover:bg-gray-200 transition font-medium mb-6">
                        ➕ Ajouter une cellule
                    </button>

                    <div class="flex gap-3">
                        <button onclick="saveExcelEdits('${doc._id}')"
                                class="flex-1 px-6 py-4 bg-gradient-to-br from-green-500 to-green-600 text-white rounded-xl hover:shadow-lg transition font-semibold">
                            ✅ Enregistrer les modifications
                        </button>
                        <button onclick="closeEditExcelModal()"
                                class="flex-1 px-6 py-4 bg-gray-200 text-gray-700 rounded-xl hover:bg-gray-300 transition font-medium">
                            ❌ Annuler
                        </button>
                    </div>
                </div>
            </div>
        `;

        // Ajouter la modale au DOM
        const container = document.createElement('div');
        container.innerHTML = modalHtml;
        document.body.appendChild(container.firstElementChild);

    } catch (error) {
        console.error('Erreur ouverture éditeur:', error);
        showNotification('Erreur lors de l\'ouverture de l\'éditeur', 'error');
    }
}

// Ajouter une ligne de cellule à éditer
function addCellEditRow() {
    const container = document.getElementById('cellEditsContainer');
    const count = container.children.length;

    const newRow = document.createElement('div');
    newRow.className = 'flex gap-3 items-center';
    newRow.innerHTML = `
        <input type="text" id="cell_${count}" placeholder="Cellule (ex: B${count + 1})"
               class="w-32 px-3 py-2 border-2 rounded-lg input-modern">
        <input type="text" id="value_${count}" placeholder="Nouvelle valeur"
               class="flex-1 px-3 py-2 border-2 rounded-lg input-modern">
        <button onclick="this.parentElement.remove()"
                class="px-3 py-2 bg-red-100 text-red-600 rounded-lg hover:bg-red-200 transition">
            🗑️
        </button>
    `;
    container.appendChild(newRow);
}

// Enregistrer les modifications Excel
async function saveExcelEdits(docId) {
    try {
        const container = document.getElementById('cellEditsContainer');
        const cellUpdates = {};

        // Récupérer toutes les modifications
        for (let i = 0; i < container.children.length; i++) {
            const cellInput = document.getElementById(`cell_${i}`);
            const valueInput = document.getElementById(`value_${i}`);

            if (cellInput && valueInput && cellInput.value.trim() && valueInput.value.trim()) {
                cellUpdates[cellInput.value.trim().toUpperCase()] = valueInput.value.trim();
            }
        }

        if (Object.keys(cellUpdates).length === 0) {
            showNotification('⚠️ Aucune modification à enregistrer', 'warning');
            return;
        }

        showNotification('⏳ Modification du tableur en cours...', 'info');

        // Appeler l'API d'édition
        const result = await apiCall(`/office/edit-excel/${docId}`, 'POST', { cellUpdates });

        if (result.success) {
            showNotification('✅ Tableur modifié avec succès !', 'success');
            closeEditExcelModal();
            await loadData(); // Recharger les documents
        } else {
            showNotification('❌ Erreur lors de la modification', 'error');
        }

    } catch (error) {
        console.error('Erreur sauvegarde Excel:', error);
        showNotification('Erreur lors de la sauvegarde', 'error');
    }
}

// Fermer la modale d'édition
function closeEditExcelModal() {
    const modal = document.getElementById('editExcelModal');
    if (modal) {
        modal.remove();
    }
}

// Créer un nouveau rapport Excel
async function createExcelReport() {
    try {
        // Créer une interface pour la création de rapport
        const modalHtml = `
            <div id="createExcelModal" class="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
                <div class="modal-glass rounded-2xl p-8 max-w-4xl w-full max-h-[90vh] overflow-y-auto shadow-2xl animate-fade-in">
                    <div class="flex justify-between items-start mb-6">
                        <h2 class="text-3xl font-bold text-gray-800">📊 Créer un rapport Excel</h2>
                        <button onclick="closeCreateExcelModal()" class="text-2xl text-red-600 hover:text-red-800 font-bold transition">✖</button>
                    </div>

                    <div class="space-y-4 mb-6">
                        <div>
                            <label class="block text-sm font-semibold text-gray-700 mb-2">Nom du fichier</label>
                            <input type="text" id="excelFileName"
                                   placeholder="rapport-documents.xlsx"
                                   class="w-full px-4 py-3 border-2 rounded-xl input-modern">
                        </div>

                        <div>
                            <label class="block text-sm font-semibold text-gray-700 mb-2">Type de rapport</label>
                            <select id="reportType" class="w-full px-4 py-3 border-2 rounded-xl input-modern">
                                <option value="documents">Liste de tous les documents</option>
                                <option value="categories">Documents par catégorie</option>
                                <option value="stats">Statistiques générales</option>
                            </select>
                        </div>
                    </div>

                    <div class="flex gap-3">
                        <button onclick="generateExcelReport()"
                                class="flex-1 px-6 py-4 bg-gradient-to-br from-green-500 to-green-600 text-white rounded-xl hover:shadow-lg transition font-semibold">
                            ✅ Générer le rapport
                        </button>
                        <button onclick="closeCreateExcelModal()"
                                class="flex-1 px-6 py-4 bg-gray-200 text-gray-700 rounded-xl hover:bg-gray-300 transition font-medium">
                            ❌ Annuler
                        </button>
                    </div>
                </div>
            </div>
        `;

        // Ajouter la modale au DOM
        const container = document.createElement('div');
        container.innerHTML = modalHtml;
        document.body.appendChild(container.firstElementChild);

    } catch (error) {
        console.error('Erreur création rapport:', error);
        showNotification('Erreur lors de l\'ouverture', 'error');
    }
}

// Générer le rapport Excel
async function generateExcelReport() {
    try {
        const fileName = document.getElementById('excelFileName').value.trim() || 'rapport.xlsx';
        const reportType = document.getElementById('reportType').value;

        let data = [];
        let sheetName = 'Rapport';

        if (reportType === 'documents') {
            data = [
                ['ID', 'Titre', 'Catégorie', 'Date', 'Taille', 'Fichier'],
                ...state.documents.map(doc => [
                    doc.idDocument || doc._id,
                    doc.titre,
                    getCategoryName(doc.categorie),
                    formatDate(doc.dateAjout),
                    formatSize(doc.taille),
                    doc.nomFichier
                ])
            ];
            sheetName = 'Documents';
        } else if (reportType === 'categories') {
            const catCounts = {};
            state.documents.forEach(doc => {
                const catName = getCategoryName(doc.categorie);
                catCounts[catName] = (catCounts[catName] || 0) + 1;
            });
            data = [
                ['Catégorie', 'Nombre de documents'],
                ...Object.entries(catCounts).map(([cat, count]) => [cat, count])
            ];
            sheetName = 'Catégories';
        } else if (reportType === 'stats') {
            const totalSize = state.documents.reduce((sum, doc) => sum + doc.taille, 0);
            data = [
                ['Statistique', 'Valeur'],
                ['Total de documents', state.documents.length],
                ['Taille totale', formatSize(totalSize)],
                ['Catégories', state.categories.length],
                ['Date du rapport', new Date().toLocaleDateString('fr-FR')]
            ];
            sheetName = 'Statistiques';
        }

        showNotification('⏳ Génération du rapport en cours...', 'info');

        // Appeler l'API de création
        const result = await apiCall('/office/create-excel', 'POST', {
            data,
            fileName,
            sheetName
        });

        if (result.success) {
            // Télécharger le fichier
            const link = document.createElement('a');
            link.href = `data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,${result.content}`;
            link.download = fileName;
            link.click();

            showNotification('✅ Rapport généré et téléchargé !', 'success');
            closeCreateExcelModal();
        } else {
            showNotification('❌ Erreur lors de la génération', 'error');
        }

    } catch (error) {
        console.error('Erreur génération rapport:', error);
        showNotification('Erreur lors de la génération', 'error');
    }
}

// Fermer la modale de création
function closeCreateExcelModal() {
    const modal = document.getElementById('createExcelModal');
    if (modal) {
        modal.remove();
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

            const confirmed = await customConfirm({
                title: 'Importer des documents',
                message: `Voulez-vous importer ${docs.length} document(s) ?`,
                confirmText: 'Oui, importer',
                cancelText: 'Annuler',
                type: 'info',
                icon: '📥'
            });

            if (!confirmed) return;
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

async function toggleUsersManagement() {
    state.showUsersManagement = !state.showUsersManagement;
    if (state.showUsersManagement) {
        try {
            // Charger les rôles et départements si pas déjà chargés
            if (!Array.isArray(state.roles) || state.roles.length === 0) {
                const rolesData = await apiCall('/roles');
                state.roles = rolesData.roles || [];
            }
            if (!Array.isArray(state.departements) || state.departements.length === 0) {
                const deptsData = await apiCall('/departements');
                state.departements = deptsData.departements || [];
            }

            // Charger tous les utilisateurs
            const users = await apiCall('/users');
            state.allUsersForManagement = users;

            console.log('✅ Données chargées pour gestion utilisateurs');
        } catch (error) {
            console.error('❌ Erreur chargement utilisateurs:', error);
        }
    }
    state.showUploadForm = false;
    state.showCategories = false;
    state.showDepartements = false;
    state.showRolesManagement = false;
    state.showAdvancedStats = false;
    render();
}

async function toggleRolesManagement() {
    state.showRolesManagement = !state.showRolesManagement;
    if (state.showRolesManagement) {
        // Charger tous les rôles
        await loadRolesAndDepartements();
    }
    state.showUploadForm = false;
    state.showCategories = false;
    state.showDepartements = false;
    state.showUsersManagement = false;
    state.showAdvancedStats = false;
    render();
}

function toggleAdvancedStats() {
    state.showAdvancedStats = !state.showAdvancedStats;
    state.showUploadForm = false;
    state.showCategories = false;
    state.showDepartements = false;
    state.showUsersManagement = false;
    state.showRolesManagement = false;
    render();
}

async function toggleRegister() {
    state.showRegister = !state.showRegister;

    // Charger les rôles et départements si on ouvre le formulaire d'inscription
    if (state.showRegister) {
        try {
            console.log('📋 Chargement des rôles et départements...');
            console.log('📋 État actuel - roles:', state.roles, 'departements:', state.departements);

            // Toujours charger si les données ne sont pas un tableau valide
            if (!Array.isArray(state.roles) || state.roles.length === 0) {
                console.log('🔄 Chargement des rôles...');
                const rolesData = await getRoles();
                console.log('✅ Rôles reçus:', rolesData);
                state.roles = rolesData.roles || [];
                console.log('✅ state.roles mis à jour:', state.roles);
            }

            if (!Array.isArray(state.departements) || state.departements.length === 0) {
                console.log('🔄 Chargement des départements...');
                const deptsData = await getDepartements();
                console.log('✅ Départements reçus:', deptsData);
                state.departements = deptsData.departements || [];
                console.log('✅ state.departements mis à jour:', state.departements);
            }

            console.log('✅ Chargement terminé. Nombre de rôles:', state.roles?.length, 'Nombre de départements:', state.departements?.length);
        } catch (error) {
            console.error('❌ Erreur chargement rôles/départements:', error);
            showNotification('Erreur lors du chargement des données', 'error');
        }
    }

    render();
}

// ===== PARTAGE DE DOCUMENTS =====
async function openShareModal(docId) {
    try {
        // Charger TOUS les utilisateurs de TOUS les départements (sauf l'utilisateur actuel)
        const allUsers = await apiCall('/users');
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

    // Mettre à jour uniquement la liste au lieu de tout recharger
    updateShareUsersList();
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

    // Filtrer uniquement la liste des utilisateurs sans recharger toute la page
    updateShareUsersList();
}

// Mettre à jour uniquement la liste des utilisateurs (sans tout re-render)
function updateShareUsersList() {
    const container = document.querySelector('.share-users-list-container');
    if (!container) return;

    const filteredUsers = getFilteredShareUsers();

    if (filteredUsers.length === 0) {
        container.innerHTML = `
            <div class="text-center py-12 text-gray-500">
                <div class="text-6xl mb-3 opacity-50">🔍</div>
                <p class="text-lg font-semibold">Aucun utilisateur trouvé</p>
                <p class="text-sm mt-2">Essayez un autre terme de recherche</p>
            </div>
        `;
    } else {
        container.innerHTML = filteredUsers.map(user => `
            <label class="flex items-center gap-3 p-4 rounded-lg hover:shadow-md transition cursor-pointer border-2 ${state.shareSelectedUsers.includes(user.username) ? 'border-green-400 bg-green-50 shadow-sm' : 'border-gray-200 bg-white hover:border-blue-300'}">
                <input type="checkbox"
                       ${state.shareSelectedUsers.includes(user.username) ? 'checked' : ''}
                       onchange="toggleUserSelection('${user.username}')"
                       class="w-5 h-5 accent-blue-500 rounded cursor-pointer">
                <div class="flex-1">
                    <div class="font-bold text-gray-900 text-base mb-1">${user.nom}</div>
                    <div class="text-sm text-gray-600">
                        📧 ${user.email}
                    </div>
                    <div class="text-sm text-blue-600 font-medium mt-1">
                        🏢 ${user.departement}
                    </div>
                </div>
                ${state.shareSelectedUsers.includes(user.username) ? '<span class="text-2xl text-green-600">✓</span>' : '<span class="text-2xl text-gray-300">○</span>'}
            </label>
        `).join('');
    }

    // Mettre à jour le compteur
    updateShareCounter();
}

// Mettre à jour le compteur de sélection
function updateShareCounter() {
    const counterSelected = document.querySelector('.share-counter-selected');
    const counterTotal = document.querySelector('.share-counter-total');
    const selectAllBtn = document.querySelector('.share-select-all-btn');
    const confirmBtn = document.querySelector('.share-confirm-btn');

    if (counterSelected) {
        counterSelected.textContent = `${state.shareSelectedUsers.length} sélectionné(s)`;
    }

    if (counterTotal) {
        counterTotal.textContent = `sur ${getFilteredShareUsers().length} utilisateur(s) disponible(s)`;
    }

    if (selectAllBtn) {
        const filteredUsers = getFilteredShareUsers();
        selectAllBtn.textContent = state.shareSelectedUsers.length === filteredUsers.length ? '✖ Tout désélectionner' : '✓ Tout sélectionner';
    }

    if (confirmBtn) {
        const span = confirmBtn.querySelector('span:last-child');
        if (span) {
            span.textContent = `Partager avec ${state.shareSelectedUsers.length} utilisateur(s)`;
        }

        if (state.shareSelectedUsers.length === 0) {
            confirmBtn.disabled = true;
            confirmBtn.classList.add('opacity-50', 'cursor-not-allowed');
            confirmBtn.classList.remove('hover:from-blue-600', 'hover:to-blue-700');
        } else {
            confirmBtn.disabled = false;
            confirmBtn.classList.remove('opacity-50', 'cursor-not-allowed');
            confirmBtn.classList.add('hover:from-blue-600', 'hover:to-blue-700');
        }
    }
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

    // Mettre à jour uniquement la liste au lieu de tout recharger
    updateShareUsersList();
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
    const confirmed = await customConfirm({
        title: 'Supprimer le message',
        message: 'Voulez-vous vraiment supprimer ce message ?',
        confirmText: 'Oui, supprimer',
        cancelText: 'Annuler',
        type: 'danger',
        icon: '🗑️'
    });

    if (!confirmed) return;

    try {
        await apiCall(`/messages/${messageId}`, 'DELETE');
        showNotification('✅ Message supprimé');
        await loadMessages();
        render();
    } catch (error) {
        console.error('Erreur suppression message:', error);
        showNotification('Erreur lors de la suppression', 'error');
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
    state.userSearchTerm = '';
    state.showUserDropdown = false;
    state.selectedUser = null;
    render();
}

// Fermer le formulaire de composition
function closeComposeMessage() {
    state.showComposeMessage = false;
    state.userSearchTerm = '';
    state.showUserDropdown = false;
    state.selectedUser = null;
    render();
}

// Gérer la recherche d'utilisateurs
function handleUserSearch(value) {
    state.userSearchTerm = value;
    state.showUserDropdown = true; // Toujours afficher le dropdown
    if (value.length === 0) {
        // Si le champ est vide, ne pas réinitialiser la sélection
        // pour permettre de voir la liste complète
    } else {
        // Si on tape, réinitialiser la sélection
        state.selectedUser = null;
        state.composeMessageTo = '';
    }
    render();
}

// Filtrer les utilisateurs selon le terme de recherche
function getFilteredUsers() {
    // Si pas de terme de recherche, afficher TOUS les utilisateurs
    if (!state.userSearchTerm || state.userSearchTerm.trim() === '') {
        return state.allUsers.slice(0, 20); // Afficher les 20 premiers utilisateurs
    }

    const searchLower = state.userSearchTerm.toLowerCase();
    return state.allUsers.filter(user => {
        return (
            user.nom.toLowerCase().includes(searchLower) ||
            user.username.toLowerCase().includes(searchLower) ||
            (user.departement && user.departement.toLowerCase().includes(searchLower)) ||
            (user.role && user.role.toLowerCase().includes(searchLower))
        );
    }).slice(0, 20); // Augmenter la limite à 20 résultats
}

// Sélectionner un utilisateur
function selectUser(username) {
    const user = state.allUsers.find(u => u.username === username);
    if (user) {
        state.selectedUser = user;
        state.composeMessageTo = username;
        state.showUserDropdown = false;
        state.userSearchTerm = `${user.nom} (${user.username})${user.niveau !== 1 ? ` - ${user.departement}` : ''}`;
        render();
    }
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

// Gérer le changement de rôle pour désactiver le département si niveau 1
function handleRoleChange() {
    const roleSelect = document.getElementById('reg_role');
    const departementContainer = document.getElementById('departement_container');
    const departementSelect = document.getElementById('reg_departement');

    if (!roleSelect || !departementContainer || !departementSelect) return;

    const selectedOption = roleSelect.options[roleSelect.selectedIndex];
    const niveau = selectedOption ? parseInt(selectedOption.getAttribute('data-niveau')) : null;

    if (niveau === 1) {
        // Niveau 1 : désactiver et masquer le département
        departementSelect.disabled = true;
        departementSelect.value = '';
        departementContainer.style.opacity = '0.5';
        departementContainer.style.pointerEvents = 'none';
    } else {
        // Autres niveaux : activer le département
        departementSelect.disabled = false;
        departementContainer.style.opacity = '1';
        departementContainer.style.pointerEvents = 'auto';
    }
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

    // Vérifier le niveau du rôle sélectionné
    const roleSelect = document.getElementById('reg_role');
    const selectedOption = roleSelect.options[roleSelect.selectedIndex];
    const niveau = selectedOption ? parseInt(selectedOption.getAttribute('data-niveau')) : null;

    // Pour niveau 1, le département n'est pas requis
    if (niveau === 1) {
        if (!nom || !email || !username || !password || !passwordConfirm || !idRole || !adminPassword) {
            return showNotification('Veuillez remplir tous les champs', 'error');
        }
    } else {
        if (!nom || !email || !username || !password || !passwordConfirm || !idRole || !idDepartement || !adminPassword) {
            return showNotification('Veuillez remplir tous les champs', 'error');
        }
    }
    if (username.length < 3 || password.length < 4) {
        return showNotification('Username: 3+, Password: 4+', 'error');
    }
    if (password !== passwordConfirm) {
        return showNotification('Les mots de passe ne correspondent pas', 'error');
    }
    // Pour niveau 1, envoyer null pour le département
    const finalIdDepartement = niveau === 1 ? null : idDepartement;
    const success = await register(username, password, nom, email, idRole, finalIdDepartement, adminPassword);
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

    // Afficher un loader pendant la vérification de session
    if (state.isCheckingSession) {
        app.innerHTML = `
            <div class="min-h-screen flex items-center justify-center gradient-bg">
                <div class="text-center">
                    <div class="loader mx-auto mb-4"></div>
                    <p class="text-lg font-semibold text-white">⏳ Restauration de la session...</p>
                </div>
            </div>
        `;
        return;
    }

    if (!state.isAuthenticated) {
        app.innerHTML = `
            <div class="min-h-screen flex items-center justify-center gradient-bg">
                <div class="bg-white p-10 rounded-3xl shadow-2xl w-full max-w-md animate-fade-in border-4 border-blue-400">
                    <div class="text-center mb-8">
                        <div class="flex justify-center mb-4">
                            <div class="bg-white p-4 rounded-3xl shadow-2xl border-4 border-gray-200">
                                <img src="/logo_white.png" alt="Logo C.E.R.E.R" class="w-20 h-20 animate-float" style="filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.2));" onerror="this.style.display='none'; this.nextElementSibling.style.display='block';">
                                <div class="logo-icon text-6xl" style="display: none;">🗄️</div>
                            </div>
                        </div>
                        <h1 class="text-3xl font-black text-gray-900 mb-2">Archivage C.E.R.E.R</h1>
                        <p class="text-gray-700 font-bold text-base">Système de gestion documentaire</p>
                    </div>
                    
                    ${state.showRegister ? `
                        <div class="space-y-3">
                            <h2 class="text-2xl font-black text-gray-900 mb-4 border-b-4 border-blue-500 pb-2">Créer un compte</h2>

                            <input id="reg_nom" type="text" placeholder="Nom complet"
                                   class="w-full px-4 py-3 border-2 rounded-xl input-modern">

                            <input id="reg_email" type="email" placeholder="Email"
                                   class="w-full px-4 py-3 border-2 rounded-xl input-modern">

                            <input id="reg_username" type="text" placeholder="Nom d'utilisateur (3+ caractères)"
                                   class="w-full px-4 py-3 border-2 rounded-xl input-modern">

                            <div class="relative">
                                <input id="reg_password" type="password" placeholder="Mot de passe (4+ caractères)"
                                       class="w-full px-4 py-3 pr-12 border-2 rounded-xl input-modern">
                                <button type="button" onclick="togglePasswordVisibility('reg_password')"
                                        class="absolute right-3 top-1/2 -translate-y-1/2 text-gray-600 hover:text-gray-900 focus:outline-none text-xl">
                                    <span id="reg_password_icon">👁️</span>
                                </button>
                            </div>

                            <div class="relative">
                                <input id="reg_password_confirm" type="password" placeholder="Confirmer le mot de passe"
                                       class="w-full px-4 py-3 pr-12 border-2 rounded-xl input-modern">
                                <button type="button" onclick="togglePasswordVisibility('reg_password_confirm')"
                                        class="absolute right-3 top-1/2 -translate-y-1/2 text-gray-600 hover:text-gray-900 focus:outline-none text-xl">
                                    <span id="reg_password_confirm_icon">👁️</span>
                                </button>
                            </div>

                            <select id="reg_role" class="w-full px-4 py-3 border-2 rounded-xl input-modern" onchange="handleRoleChange()">
                                <option value="">-- Choisir un rôle --</option>
                                ${(state.roles && Array.isArray(state.roles) ? state.roles : []).map(role => `
                                    <option value="${role._id}" data-niveau="${role.niveau}">
                                        ${role.libelle.charAt(0).toUpperCase() + role.libelle.slice(1)} - ${role.description}
                                    </option>
                                `).join('')}
                            </select>

                            <div id="departement_container">
                                <select id="reg_departement" class="w-full px-4 py-3 border-2 rounded-xl input-modern">
                                    <option value="">-- Choisir un département --</option>
                                    ${(state.departements && Array.isArray(state.departements) ? state.departements : []).map(dept => `
                                        <option value="${dept._id}">
                                            ${dept.nom}
                                        </option>
                                    `).join('')}
                                </select>
                                <p class="text-xs text-gray-700 font-semibold mt-1 bg-blue-50 p-2 rounded border-l-4 border-blue-500">💡 Les administrateurs de niveau 1 n'ont pas de département spécifique</p>
                            </div>

                            <div class="relative">
                                <input id="reg_admin_password" type="password" placeholder="Mot de passe administrateur"
                                       class="w-full px-4 py-3 pr-12 border-2 rounded-xl input-modern">
                                <button type="button" onclick="togglePasswordVisibility('reg_admin_password')"
                                        class="absolute right-3 top-1/2 -translate-y-1/2 text-gray-600 hover:text-gray-900 focus:outline-none text-xl">
                                    <span id="reg_admin_password_icon">👁️</span>
                                </button>
                            </div>

                            <button onclick="handleRegister()"
                                    class="w-full btn-success text-white py-3 rounded-xl font-semibold transition">
                                Créer le compte
                            </button>
                            <button onclick="toggleRegister()"
                                    class="w-full text-gray-700 font-bold hover:text-gray-900 py-3 bg-gray-100 rounded-xl hover:bg-gray-200 transition">
                                ← Retour à la connexion
                            </button>
                        </div>
                    ` : `
                        <div class="space-y-4">
                            <h2 class="text-2xl font-black text-gray-900 mb-4 border-b-4 border-blue-500 pb-2">Connexion</h2>
                            <input id="login_username" type="text" placeholder="Nom d'utilisateur"
                                   class="w-full px-4 py-3 border-2 rounded-xl input-modern"
                                   onkeypress="if(event.key==='Enter') handleLogin()">
                            <div class="relative">
                                <input id="login_password" type="password" placeholder="Mot de passe"
                                       class="w-full px-4 py-3 pr-12 border-2 rounded-xl input-modern"
                                       onkeypress="if(event.key==='Enter') handleLogin()">
                                <button type="button" onclick="togglePasswordVisibility('login_password')"
                                        class="absolute right-3 top-1/2 -translate-y-1/2 text-gray-600 hover:text-gray-900 focus:outline-none text-xl">
                                    <span id="login_password_icon">👁️</span>
                                </button>
                            </div>
                            <button onclick="handleLogin()" 
                                    class="w-full btn-primary text-white py-3 rounded-xl font-semibold transition btn-shine">
                                Se connecter
                            </button>
                            <button onclick="toggleRegister()"
                                    class="w-full text-sm text-gray-700 font-bold hover:text-gray-900 py-3 bg-gray-100 rounded-xl hover:bg-gray-200 transition">
                                ➕ Créer un nouveau compte
                            </button>

                            <div class="mt-6 pt-4 border-t-2 border-gray-300">
                                <p class="text-center text-sm text-gray-800 font-bold bg-gray-50 p-3 rounded-lg">
                                    💼 Logiciel développé par le service informatique du C.E.R.E.R
                                </p>
                            </div>
                        </div>
                    `}
                </div>
            </div>
        `;
        return;
    }

    // ✅ NOUVEAU: Formulaire de changement de mot de passe obligatoire
    if (state.mustChangePassword) {
        app.innerHTML = `
            <div class="min-h-screen flex items-center justify-center gradient-bg">
                <div class="bg-white p-10 rounded-3xl shadow-2xl w-full max-w-md animate-fade-in border-4 border-yellow-400">
                    <div class="text-center mb-8">
                        <div class="text-6xl mb-4">🔐</div>
                        <h1 class="text-3xl font-black text-gray-900 mb-2">Changement de mot de passe requis</h1>
                        <p class="text-gray-700 font-medium text-sm">Pour votre sécurité, vous devez changer votre mot de passe avant de continuer</p>
                    </div>

                    <div class="space-y-4">
                        <div class="bg-yellow-50 border-2 border-yellow-300 rounded-xl p-4 mb-4">
                            <p class="text-sm text-yellow-800 font-medium">
                                ⚠️ <strong>Important :</strong> Créez un nouveau mot de passe sécurisé (minimum 4 caractères)
                            </p>
                        </div>

                        <div class="relative">
                            <input id="change_old_password" type="password" placeholder="Ancien mot de passe"
                                   class="w-full px-4 py-3 pr-12 border-2 rounded-xl input-modern">
                            <button type="button" onclick="togglePasswordVisibility('change_old_password')"
                                    class="absolute right-3 top-1/2 -translate-y-1/2 text-gray-600 hover:text-gray-900 focus:outline-none text-xl">
                                <span id="change_old_password_icon">👁️</span>
                            </button>
                        </div>

                        <div class="relative">
                            <input id="change_new_password" type="password" placeholder="Nouveau mot de passe (4+ caractères)"
                                   class="w-full px-4 py-3 pr-12 border-2 rounded-xl input-modern">
                            <button type="button" onclick="togglePasswordVisibility('change_new_password')"
                                    class="absolute right-3 top-1/2 -translate-y-1/2 text-gray-600 hover:text-gray-900 focus:outline-none text-xl">
                                <span id="change_new_password_icon">👁️</span>
                            </button>
                        </div>

                        <div class="relative">
                            <input id="change_confirm_password" type="password" placeholder="Confirmer le nouveau mot de passe"
                                   class="w-full px-4 py-3 pr-12 border-2 rounded-xl input-modern">
                            <button type="button" onclick="togglePasswordVisibility('change_confirm_password')"
                                    class="absolute right-3 top-1/2 -translate-y-1/2 text-gray-600 hover:text-gray-900 focus:outline-none text-xl">
                                <span id="change_confirm_password_icon">👁️</span>
                            </button>
                        </div>

                        <button onclick="handlePasswordChange()"
                                class="w-full btn-primary text-white py-3 rounded-xl font-semibold transition btn-shine">
                            ✅ Changer mon mot de passe
                        </button>

                        <div class="mt-6 pt-4 border-t-2 border-gray-300">
                            <p class="text-center text-xs text-gray-600">
                                💡 Conseil : Utilisez un mot de passe unique que vous n'utilisez nulle part ailleurs
                            </p>
                        </div>
                    </div>
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
                                <p class="text-xs text-blue-900 font-bold">Bonjour, <strong>${state.currentUser}</strong></p>
                            </div>
                        </div>
                        <div class="flex gap-2">
                            <button onclick="toggleUploadForm()"
                                    class="nav-btn ${state.showUploadForm ? 'nav-btn-active' : 'nav-btn-inactive'}">
                                ➕ Ajouter
                            </button>
                            <button onclick="toggleMessagingSection()"
                                    class="nav-btn ${state.showMessagingSection ? 'nav-btn-active' : 'nav-btn-inactive'} relative">
                                📬 Boîte de réception
                                ${state.unreadCount > 0 ? `
                                    <span class="absolute -top-2 -right-2 px-2 py-1 bg-red-600 text-white text-xs font-bold rounded-full animate-pulse border-2 border-white shadow-lg">
                                        ${state.unreadCount}
                                    </span>
                                ` : ''}
                            </button>
                            <button onclick="toggleFilters()"
                                    class="nav-btn ${state.showFilters ? 'nav-btn-active' : 'nav-btn-inactive'}">
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
                                <div class="bg-gradient-to-br from-purple-500 to-purple-600 p-4 rounded-xl shadow-lg text-white cursor-pointer" onclick="toggleAdvancedStats()">
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
                                        <label class="block text-xs text-blue-900 font-bold mb-1">📅 Date de début</label>
                                        <input type="date" value="${state.tempDateFrom}"
                                               onchange="updateTempDateFrom(this.value)"
                                               class="w-full px-3 py-2 border-2 rounded-lg text-sm input-modern" />
                                    </div>
                                    <div class="flex-1 min-w-[150px]">
                                        <label class="block text-xs text-blue-900 font-bold mb-1">📅 Date de fin</label>
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

                <div class="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-3">
                    ${filteredDocs.map(doc => `
                        <div onclick="showDocDetail('${doc._id}')"
                             class="doc-card p-3 rounded-xl shadow-md cursor-pointer animate-fade-in hover:shadow-xl transition-shadow ${doc.locked ? 'locked' : ''}">
                            <div class="flex justify-between items-start mb-2">
                                <h3 class="font-bold text-gray-800 flex-1 text-base">${doc.titre}</h3>
                                <div class="flex items-center gap-1">
                                    ${doc.locked ? '<span class="text-2xl" title="Document verrouillé">🔒</span>' : ''}
                                    <span class="text-3xl">${getCategoryIcon(doc.categorie)}</span>
                                </div>
                            </div>
                            <span class="category-badge inline-block px-2 py-1 text-xs rounded-full ${getCategoryColor(doc.categorie)} font-medium mb-2">
                                ${getCategoryName(doc.categorie)}
                            </span>
                            ${doc.locked ? `
                                <div class="mb-2 px-2 py-1 bg-gradient-to-r from-red-100 to-orange-100 border border-red-400 rounded">
                                    <p class="text-xs font-bold text-red-700 flex items-center gap-1">
                                        🔒 ${doc.lockedBy ? doc.lockedBy.nomComplet : 'VERROUILLÉ'}
                                    </p>
                                </div>
                            ` : ''}
                            <div class="mt-2 space-y-1 border-t pt-2">
                                ${doc.idDocument ? `
                                <div class="flex items-center gap-1">
                                    <p class="text-xs text-blue-600 font-semibold flex items-center gap-1">
                                        🆔 ${doc.idDocument}
                                    </p>
                                    <button onclick="event.stopPropagation(); copyDocumentId('${doc.idDocument}')"
                                            class="px-1 py-0.5 bg-blue-500 hover:bg-blue-600 text-white text-xs rounded transition font-semibold"
                                            title="Copier l'ID">
                                        📋
                                    </button>
                                </div>
                                ` : ''}
                                <p class="text-xs text-gray-600 flex items-center gap-1">
                                    📄 ${formatDate(doc.date)}
                                </p>
                                <p class="text-xs text-green-600 font-medium flex items-center gap-1">
                                    ➕ ${formatDate(doc.createdAt)}
                                </p>
                                <p class="text-xs text-gray-500 flex items-center gap-1">
                                    📦 ${formatSize(doc.taille)}
                                </p>
                            </div>
                        </div>
                    `).join('')}
                </div>
                
                ${filteredDocs.length === 0 ? `
                    <div class="text-center py-20 animate-fade-in">
                        <div class="text-6xl mb-4">🔭</div>
                        <p class="text-blue-900 font-bold text-xl mb-6">Aucun document trouvé</p>
                        <button onclick="toggleUploadForm()" 
                                class="px-8 py-4 btn-primary text-white rounded-xl hover:shadow-lg transition font-semibold text-lg">
                            ➕ Ajouter un document
                        </button>
                    </div>
                ` : ''}
            </main>
            
            ${state.showMenu ? `
                <div class="fixed inset-0 bg-black bg-opacity-50 z-50 backdrop-blur-sm" onclick="toggleMenu()"></div>
                <div class="fixed right-0 top-0 h-screen w-80 sidebar-menu shadow-2xl z-50 animate-slide-in flex flex-col">
                    <div class="flex-shrink-0 p-6 pb-4 border-b border-gray-200">
                        <button onclick="toggleMenu()" class="absolute top-4 right-4 text-2xl text-red-600 hover:text-red-800 font-bold">✖</button>
                        <h2 class="text-2xl font-bold bg-gradient-to-r from-blue-600 to-green-600 bg-clip-text text-transparent">Menu</h2>
                    </div>
                    <div class="flex-1 overflow-y-auto p-6 pt-4">
                        <!-- Affichage du rôle et niveau -->
                        ${state.currentUserInfo ? `
                            <div class="mb-4 p-3 bg-gradient-to-br from-blue-50 to-green-50 rounded-xl">
                                <p class="text-sm font-semibold text-gray-700">${state.currentUserInfo.nom}</p>
                                <p class="text-xs text-blue-900 font-bold">Niveau ${state.currentUserInfo.niveau} - ${state.currentUserInfo.role}</p>
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
                                <button onclick="toggleUsersManagement()" class="w-full text-left px-4 py-4 hover:bg-gradient-to-r hover:from-purple-50 hover:to-pink-50 rounded-xl transition font-medium">
                                    👥 Gérer les utilisateurs
                                </button>
                                <button onclick="toggleAdvancedStats()" class="w-full text-left px-4 py-4 hover:bg-gradient-to-r hover:from-green-50 hover:to-teal-50 rounded-xl transition font-medium">
                                    📊 Statistiques avancées
                                </button>
                                <button onclick="createExcelReport()" class="w-full text-left px-4 py-4 hover:bg-gradient-to-r hover:from-green-50 hover:to-emerald-50 rounded-xl transition font-medium">
                                    📊 Créer un rapport Excel
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

                            ${state.currentUserInfo && state.currentUserInfo.niveau === 1 ? `
                                <div class="flex items-center gap-3 p-4 bg-gradient-to-r from-yellow-50 to-orange-50 rounded-xl border-2 border-yellow-400">
                                    <input type="checkbox"
                                           id="lockDocument"
                                           ${formData.locked ? 'checked' : ''}
                                           onchange="updateFormData('locked', this.checked)"
                                           class="w-5 h-5 accent-orange-500 cursor-pointer">
                                    <label for="lockDocument" class="cursor-pointer font-bold text-white flex items-center gap-2" style="color: white !important; text-shadow: 0 2px 4px rgba(0, 0, 0, 0.5);">
                                        <span class="text-xl">${formData.locked ? '🔒' : '🔓'}</span>
                                        ${formData.locked ? 'Document verrouillé' : 'Verrouiller ce document'}
                                        <span class="text-xs text-yellow-300 font-bold">(niveau 1 uniquement)</span>
                                    </label>
                                </div>
                            ` : ''}

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

            <!-- NOUVEAU : Gestion des utilisateurs -->
            ${renderUsersManagement()}

            <!-- NOUVEAU : Gestion des rôles -->
            ${renderRolesManagement()}

            <!-- NOUVEAU : Statistiques avancées -->
            ${renderAdvancedStats()}

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
                                    <div>
                                        <div class="bg-gradient-to-br from-blue-50 to-indigo-50 p-4 rounded-lg mb-4 border-2 border-blue-200">
                                            <div class="flex items-center justify-between mb-3">
                                                <div class="flex items-center gap-3">
                                                    <span class="text-4xl">📝</span>
                                                    <div>
                                                        <p class="font-bold text-lg text-gray-800">Document Microsoft Word</p>
                                                        <p class="text-sm text-gray-600">${state.selectedDoc.nomFichier} • ${formatSize(state.selectedDoc.taille)}</p>
                                                    </div>
                                                </div>
                                                <button onclick="downloadDoc(state.selectedDoc)"
                                                        class="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition font-medium text-sm">
                                                    📥 Télécharger
                                                </button>
                                            </div>
                                        </div>
                                        ${window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' ? `
                                            <div class="text-center py-12 bg-gradient-to-br from-blue-50 to-indigo-100 rounded-xl border-2 border-blue-300">
                                                <div class="text-6xl mb-4 animate-bounce">📝</div>
                                                <p class="text-xl font-bold text-gray-800 mb-3">Aperçu en mode local</p>
                                                <p class="text-gray-600 mb-6 max-w-md mx-auto">
                                                    Le visualiseur Office Online nécessite une URL publique.
                                                    Téléchargez le document pour l'ouvrir dans Microsoft Word.
                                                </p>
                                                <div class="bg-white rounded-lg p-6 max-w-lg mx-auto mb-6 shadow-lg">
                                                    <div class="grid grid-cols-2 gap-4 text-sm">
                                                        <div class="text-left">
                                                            <p class="text-gray-500">Fichier:</p>
                                                            <p class="font-semibold text-gray-800">${state.selectedDoc.nomFichier}</p>
                                                        </div>
                                                        <div class="text-left">
                                                            <p class="text-gray-500">Taille:</p>
                                                            <p class="font-semibold text-gray-800">${formatSize(state.selectedDoc.taille)}</p>
                                                        </div>
                                                        <div class="text-left">
                                                            <p class="text-gray-500">Type:</p>
                                                            <p class="font-semibold text-gray-800">Microsoft Word</p>
                                                        </div>
                                                        <div class="text-left">
                                                            <p class="text-gray-500">Format:</p>
                                                            <p class="font-semibold text-gray-800">${state.selectedDoc.nomFichier.split('.').pop().toUpperCase()}</p>
                                                        </div>
                                                    </div>
                                                </div>
                                                <button onclick="downloadDoc(state.selectedDoc)"
                                                        class="px-8 py-4 bg-gradient-to-br from-blue-500 to-blue-600 text-white rounded-xl hover:shadow-lg transition font-semibold text-lg transform hover:scale-105">
                                                    📥 Télécharger et ouvrir dans Word
                                                </button>
                                                <p class="text-xs text-gray-500 mt-4">
                                                    💡 Le visualiseur fonctionnera automatiquement une fois déployé en production
                                                </p>
                                            </div>
                                        ` : `
                                            <div class="relative bg-white rounded-lg" style="height: 700px;">
                                                <!-- Office Online désactivé: causait des erreurs XML -->
                                                <div class="flex items-center justify-center h-full bg-gradient-to-br from-gray-50 to-gray-100">
                                                    <div class="text-center p-8">
                                                        <div class="text-6xl mb-4">📝</div>
                                                        <p class="text-xl font-bold text-gray-800 mb-2">Prévisualisation non disponible</p>
                                                        <p class="text-gray-600 mb-6">
                                                            Utilisez le bouton "Éditer" pour modifier ce document avec OnlyOffice
                                                        </p>
                                                        <button onclick="downloadDoc(state.selectedDoc)" class="px-6 py-3 bg-blue-500 text-white rounded-lg hover:bg-blue-600">
                                                            📥 Télécharger
                                                        </button>
                                                    </div>
                                                </div>
                                            </div>
                                        `}
                                    </div>
                                ` : state.selectedDoc.type.includes('excel') || state.selectedDoc.type.includes('sheet') || state.selectedDoc.nomFichier.endsWith('.xls') || state.selectedDoc.nomFichier.endsWith('.xlsx') ? `
                                    <div>
                                        <div class="bg-gradient-to-br from-green-50 to-emerald-50 p-4 rounded-lg mb-4 border-2 border-green-200">
                                            <div class="flex items-center justify-between mb-3">
                                                <div class="flex items-center gap-3">
                                                    <span class="text-4xl">📊</span>
                                                    <div>
                                                        <p class="font-bold text-lg text-gray-800">Tableur Microsoft Excel</p>
                                                        <p class="text-sm text-gray-600">${state.selectedDoc.nomFichier} • ${formatSize(state.selectedDoc.taille)}</p>
                                                    </div>
                                                </div>
                                                <button onclick="downloadDoc(state.selectedDoc)"
                                                        class="px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 transition font-medium text-sm">
                                                    📥 Télécharger
                                                </button>
                                            </div>
                                        </div>
                                        ${window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' ? `
                                            <div class="text-center py-12 bg-gradient-to-br from-green-50 to-emerald-100 rounded-xl border-2 border-green-300">
                                                <div class="text-6xl mb-4 animate-bounce">📊</div>
                                                <p class="text-xl font-bold text-gray-800 mb-3">Aperçu en mode local</p>
                                                <p class="text-gray-600 mb-6 max-w-md mx-auto">
                                                    Le visualiseur Office Online nécessite une URL publique.
                                                    Téléchargez le tableur pour l'ouvrir dans Microsoft Excel.
                                                </p>
                                                <div class="bg-white rounded-lg p-6 max-w-lg mx-auto mb-6 shadow-lg">
                                                    <div class="grid grid-cols-2 gap-4 text-sm">
                                                        <div class="text-left">
                                                            <p class="text-gray-500">Fichier:</p>
                                                            <p class="font-semibold text-gray-800">${state.selectedDoc.nomFichier}</p>
                                                        </div>
                                                        <div class="text-left">
                                                            <p class="text-gray-500">Taille:</p>
                                                            <p class="font-semibold text-gray-800">${formatSize(state.selectedDoc.taille)}</p>
                                                        </div>
                                                        <div class="text-left">
                                                            <p class="text-gray-500">Type:</p>
                                                            <p class="font-semibold text-gray-800">Microsoft Excel</p>
                                                        </div>
                                                        <div class="text-left">
                                                            <p class="text-gray-500">Format:</p>
                                                            <p class="font-semibold text-gray-800">${state.selectedDoc.nomFichier.split('.').pop().toUpperCase()}</p>
                                                        </div>
                                                    </div>
                                                </div>
                                                <button onclick="downloadDoc(state.selectedDoc)"
                                                        class="px-8 py-4 bg-gradient-to-br from-green-500 to-green-600 text-white rounded-xl hover:shadow-lg transition font-semibold text-lg transform hover:scale-105">
                                                    📥 Télécharger et ouvrir dans Excel
                                                </button>
                                                <p class="text-xs text-gray-500 mt-4">
                                                    💡 Le visualiseur fonctionnera automatiquement une fois déployé en production
                                                </p>
                                            </div>
                                        ` : `
                                            <div class="relative bg-white rounded-lg" style="height: 700px;">
                                                <!-- Office Online désactivé: causait des erreurs XML -->
                                                <div class="flex items-center justify-center h-full bg-gradient-to-br from-gray-50 to-gray-100">
                                                    <div class="text-center p-8">
                                                        <div class="text-6xl mb-4">📊</div>
                                                        <p class="text-xl font-bold text-gray-800 mb-2">Prévisualisation non disponible</p>
                                                        <p class="text-gray-600 mb-6">
                                                            Utilisez le bouton "Éditer" pour modifier ce document avec l'éditeur Excel
                                                        </p>
                                                        <button onclick="downloadDoc(state.selectedDoc)" class="px-6 py-3 bg-blue-500 text-white rounded-lg hover:bg-blue-600">
                                                            📥 Télécharger
                                                        </button>
                                                    </div>
                                                </div>
                                            </div>
                                        `}
                                    </div>
                                ` : state.selectedDoc.type.includes('powerpoint') || state.selectedDoc.type.includes('presentation') || state.selectedDoc.nomFichier.endsWith('.ppt') || state.selectedDoc.nomFichier.endsWith('.pptx') ? `
                                    <div>
                                        <div class="bg-gradient-to-br from-orange-50 to-red-50 p-4 rounded-lg mb-4 border-2 border-orange-200">
                                            <div class="flex items-center justify-between mb-3">
                                                <div class="flex items-center gap-3">
                                                    <span class="text-4xl">🎞️</span>
                                                    <div>
                                                        <p class="font-bold text-lg text-gray-800">Présentation PowerPoint</p>
                                                        <p class="text-sm text-gray-600">${state.selectedDoc.nomFichier} • ${formatSize(state.selectedDoc.taille)}</p>
                                                    </div>
                                                </div>
                                                <button onclick="downloadDoc(state.selectedDoc)"
                                                        class="px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600 transition font-medium text-sm">
                                                    📥 Télécharger
                                                </button>
                                            </div>
                                        </div>
                                        ${window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' ? `
                                            <div class="text-center py-12 bg-gradient-to-br from-orange-50 to-red-100 rounded-xl border-2 border-orange-300">
                                                <div class="text-6xl mb-4 animate-bounce">🎞️</div>
                                                <p class="text-xl font-bold text-gray-800 mb-3">Aperçu en mode local</p>
                                                <p class="text-gray-600 mb-6 max-w-md mx-auto">
                                                    Le visualiseur Office Online nécessite une URL publique.
                                                    Téléchargez la présentation pour l'ouvrir dans PowerPoint.
                                                </p>
                                                <div class="bg-white rounded-lg p-6 max-w-lg mx-auto mb-6 shadow-lg">
                                                    <div class="grid grid-cols-2 gap-4 text-sm">
                                                        <div class="text-left">
                                                            <p class="text-gray-500">Fichier:</p>
                                                            <p class="font-semibold text-gray-800">${state.selectedDoc.nomFichier}</p>
                                                        </div>
                                                        <div class="text-left">
                                                            <p class="text-gray-500">Taille:</p>
                                                            <p class="font-semibold text-gray-800">${formatSize(state.selectedDoc.taille)}</p>
                                                        </div>
                                                        <div class="text-left">
                                                            <p class="text-gray-500">Type:</p>
                                                            <p class="font-semibold text-gray-800">Microsoft PowerPoint</p>
                                                        </div>
                                                        <div class="text-left">
                                                            <p class="text-gray-500">Format:</p>
                                                            <p class="font-semibold text-gray-800">${state.selectedDoc.nomFichier.split('.').pop().toUpperCase()}</p>
                                                        </div>
                                                    </div>
                                                </div>
                                                <button onclick="downloadDoc(state.selectedDoc)"
                                                        class="px-8 py-4 bg-gradient-to-br from-orange-500 to-red-500 text-white rounded-xl hover:shadow-lg transition font-semibold text-lg transform hover:scale-105">
                                                    📥 Télécharger et ouvrir dans PowerPoint
                                                </button>
                                                <p class="text-xs text-gray-500 mt-4">
                                                    💡 Le visualiseur fonctionnera automatiquement une fois déployé en production
                                                </p>
                                            </div>
                                        ` : `
                                            <div class="relative bg-white rounded-lg" style="height: 700px;">
                                                <!-- Office Online désactivé: causait des erreurs XML -->
                                                <div class="flex items-center justify-center h-full bg-gradient-to-br from-gray-50 to-gray-100">
                                                    <div class="text-center p-8">
                                                        <div class="text-6xl mb-4">📽️</div>
                                                        <p class="text-xl font-bold text-gray-800 mb-2">Prévisualisation non disponible</p>
                                                        <p class="text-gray-600 mb-6">
                                                            Utilisez le bouton "Éditer" pour modifier ce document avec OnlyOffice
                                                        </p>
                                                        <button onclick="downloadDoc(state.selectedDoc)" class="px-6 py-3 bg-blue-500 text-white rounded-lg hover:bg-blue-600">
                                                            📥 Télécharger
                                                        </button>
                                                    </div>
                                                </div>
                                            </div>
                                        `}
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
                            <!-- Prévisualiser : Tous les niveaux -->
                            <button onclick="openPreview(state.selectedDoc)"
                                    class="flex-1 min-w-[200px] px-6 py-4 bg-gradient-to-br from-purple-500 to-purple-600 text-white rounded-xl hover:shadow-lg transition font-semibold flex items-center justify-center gap-2">
                                <span class="text-xl">👁️</span> Prévisualiser
                            </button>

                            <!-- Télécharger : Tous les niveaux -->
                            <button onclick="downloadDoc(state.selectedDoc)"
                                    class="flex-1 min-w-[200px] px-6 py-4 btn-primary text-white rounded-xl hover:shadow-lg transition font-semibold flex items-center justify-center gap-2">
                                <span class="text-xl">📥</span> Télécharger
                            </button>

                            <!-- Éditer : Fichiers Office (Word, Excel, PowerPoint) -->
                            ${state.selectedDoc && isOfficeDocument(state.selectedDoc.nomFichier) ? `
                                <button onclick="openEditor(state.selectedDoc)"
                                        class="flex-1 min-w-[200px] px-6 py-4 bg-gradient-to-br from-green-500 to-green-600 text-white rounded-xl hover:shadow-lg transition font-semibold flex items-center justify-center gap-2">
                                    <span class="text-xl">✏️</span> Éditer
                                </button>
                            ` : ''}

                            ${state.currentUserInfo && state.currentUserInfo.niveau === 1 ? `
                                <!-- NIVEAU 1 : Télécharger, Verrouiller, Partager et Supprimer N'IMPORTE QUEL document -->
                                <button onclick="toggleDocumentLock('${state.selectedDoc._id}')"
                                        class="flex-1 min-w-[200px] px-6 py-4 bg-gradient-to-br from-yellow-500 to-orange-600 text-white rounded-xl hover:shadow-lg transition font-semibold flex items-center justify-center gap-2">
                                    <span class="text-xl">${state.selectedDoc.locked ? '🔒' : '🔓'}</span>
                                    ${state.selectedDoc.locked ? 'Déverrouiller' : 'Verrouiller'}
                                </button>
                                <button onclick="openShareModal('${state.selectedDoc._id}')"
                                        class="flex-1 min-w-[200px] px-6 py-4 bg-gradient-to-br from-blue-500 to-blue-600 text-white rounded-xl hover:shadow-lg transition font-semibold flex items-center justify-center gap-2">
                                    <span class="text-xl">📤</span> Partager
                                </button>
                                <button onclick="deleteDoc('${state.selectedDoc._id}')"
                                        class="flex-1 min-w-[200px] px-6 py-4 bg-gradient-to-br from-red-500 to-red-600 text-white rounded-xl hover:shadow-lg transition font-semibold flex items-center justify-center gap-2">
                                    <span class="text-xl">🗑️</span> Supprimer
                                </button>
                            ` : ''}

                            ${state.currentUserInfo && state.currentUserInfo.niveau === 2 ? `
                                <!-- NIVEAU 2 : Télécharger et Partager des documents de son département -->
                                <button onclick="openShareModal('${state.selectedDoc._id}')"
                                        class="flex-1 min-w-[200px] px-6 py-4 bg-gradient-to-br from-blue-500 to-blue-600 text-white rounded-xl hover:shadow-lg transition font-semibold flex items-center justify-center gap-2">
                                    <span class="text-xl">📤</span> Partager
                                </button>
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
                    <div class="bg-white rounded-2xl p-8 max-w-3xl w-full max-h-[85vh] overflow-y-auto shadow-2xl animate-fade-in border-4 border-blue-400" onclick="event.stopPropagation()">
                        <!-- Header -->
                        <div class="flex justify-between items-start mb-6 pb-4 border-b-4 border-blue-200">
                            <div class="flex items-center gap-4">
                                <div class="bg-gradient-to-br from-blue-500 to-blue-600 p-4 rounded-2xl shadow-lg">
                                    <span class="text-4xl">📤</span>
                                </div>
                                <div>
                                    <h2 class="text-2xl font-bold text-gray-900 mb-1">Partager un document</h2>
                                    <p class="text-gray-600 text-sm">Document : <span class="text-blue-600 font-semibold">${state.selectedDoc ? state.selectedDoc.titre : ''}</span></p>
                                </div>
                            </div>
                            <button onclick="closeShareModal()"
                                    class="text-2xl text-gray-400 hover:text-red-600 transition hover:bg-red-50 px-3 py-1 rounded-lg">✖</button>
                        </div>

                        <!-- Instructions -->
                        <div class="bg-gradient-to-r from-blue-50 to-indigo-50 border-l-4 border-blue-500 p-4 rounded-lg mb-6">
                            <p class="text-gray-800 text-sm font-medium flex items-center gap-2">
                                <span class="text-xl">💡</span>
                                <span>Sélectionnez un ou plusieurs utilisateurs avec qui partager ce document</span>
                            </p>
                        </div>

                        ${state.shareAvailableUsers.length === 0 ? `
                            <div class="text-center py-12">
                                <div class="text-6xl mb-4 opacity-50">👥</div>
                                <p class="text-gray-500 text-lg font-semibold">Chargement des utilisateurs...</p>
                            </div>
                        ` : `
                            <!-- Barre de recherche -->
                            <div class="mb-5">
                                <label class="block text-gray-700 font-semibold mb-2 text-sm">🔍 Rechercher</label>
                                <input type="text"
                                       placeholder="Rechercher par nom, email ou département..."
                                       value="${state.shareSearchTerm}"
                                       oninput="updateShareSearch(this.value)"
                                       class="w-full px-4 py-3 border-2 border-gray-300 rounded-xl text-base focus:border-blue-500 focus:ring-2 focus:ring-blue-200 outline-none transition">
                            </div>

                            <!-- Compteur et bouton Tout sélectionner -->
                            <div class="mb-5 flex items-center justify-between bg-gradient-to-r from-blue-100 to-indigo-100 p-4 rounded-xl border-2 border-blue-300">
                                <div class="flex items-center gap-3">
                                    <div class="bg-blue-500 w-12 h-12 rounded-full flex items-center justify-center shadow-lg">
                                        <span class="text-2xl">✓</span>
                                    </div>
                                    <div>
                                        <p class="text-gray-900 font-bold text-lg share-counter-selected">${state.shareSelectedUsers.length} sélectionné(s)</p>
                                        <p class="text-gray-600 text-sm share-counter-total">sur ${getFilteredShareUsers().length} utilisateur(s) disponible(s)</p>
                                    </div>
                                </div>
                                <button onclick="toggleSelectAll()"
                                        class="share-select-all-btn px-5 py-2 bg-white text-blue-600 rounded-lg hover:bg-blue-50 transition font-semibold text-sm border-2 border-blue-400 shadow-sm">
                                    ${state.shareSelectedUsers.length === getFilteredShareUsers().length ? '✖ Tout désélectionner' : '✓ Tout sélectionner'}
                                </button>
                            </div>

                            <!-- Liste des utilisateurs -->
                            <div class="mb-6">
                                <label class="block text-gray-700 font-semibold mb-3 text-sm flex items-center gap-2">
                                    <span>👥</span>
                                    <span>Utilisateurs disponibles</span>
                                </label>
                                <div class="share-users-list-container space-y-2 max-h-80 overflow-y-auto border-2 border-gray-300 rounded-xl p-3 bg-gray-50">
                                    ${getFilteredShareUsers().length === 0 ? `
                                        <div class="text-center py-12 text-gray-500">
                                            <div class="text-6xl mb-3 opacity-50">🔍</div>
                                            <p class="text-lg font-semibold">Aucun utilisateur trouvé</p>
                                            <p class="text-sm mt-2">Essayez un autre terme de recherche</p>
                                        </div>
                                    ` : getFilteredShareUsers().map(user => `
                                        <label class="flex items-center gap-3 p-4 rounded-lg hover:shadow-md transition cursor-pointer border-2 ${state.shareSelectedUsers.includes(user.username) ? 'border-green-400 bg-green-50 shadow-sm' : 'border-gray-200 bg-white hover:border-blue-300'}">
                                            <input type="checkbox"
                                                   ${state.shareSelectedUsers.includes(user.username) ? 'checked' : ''}
                                                   onchange="toggleUserSelection('${user.username}')"
                                                   class="w-5 h-5 accent-blue-500 rounded cursor-pointer">
                                            <div class="flex-1">
                                                <div class="font-bold text-gray-900 text-base mb-1">${user.nom}</div>
                                                <div class="text-sm text-gray-600">
                                                    📧 ${user.email}
                                                </div>
                                                <div class="text-sm text-blue-600 font-medium mt-1">
                                                    🏢 ${user.departement}
                                                </div>
                                            </div>
                                            ${state.shareSelectedUsers.includes(user.username) ? '<span class="text-2xl text-green-600">✓</span>' : '<span class="text-2xl text-gray-300">○</span>'}
                                        </label>
                                    `).join('')}
                                </div>
                            </div>

                            <!-- Boutons d'action -->
                            <div class="flex gap-3 pt-4 border-t-2 border-gray-200">
                                <button onclick="confirmShare()"
                                        class="share-confirm-btn flex-1 px-6 py-4 bg-gradient-to-r from-blue-500 to-blue-600 text-white rounded-xl hover:shadow-lg transition font-semibold text-base flex items-center justify-center gap-2 ${state.shareSelectedUsers.length === 0 ? 'opacity-50 cursor-not-allowed' : 'hover:from-blue-600 hover:to-blue-700'}"
                                        ${state.shareSelectedUsers.length === 0 ? 'disabled' : ''}>
                                    <span class="text-xl">✓</span>
                                    <span>Partager avec ${state.shareSelectedUsers.length} utilisateur(s)</span>
                                </button>
                                <button onclick="closeShareModal()"
                                        class="px-6 py-4 bg-gray-200 text-gray-700 rounded-xl hover:bg-gray-300 hover:shadow-md transition font-semibold text-base">
                                    Annuler
                                </button>
                            </div>
                        `}
                    </div>
                </div>
            ` : ''}

            ${state.showComposeMessage ? `
                <div style="position: fixed; inset: 0; background: rgba(0,0,0,0.7); z-index: 9999; display: flex; align-items: center; justify-content: center; padding: 20px;"
                     onclick="if(event.target === this) closeComposeMessage()">
                    <div style="background: #ffffff; border-radius: 12px; padding: 30px; max-width: 700px; width: 100%; box-shadow: 0 20px 60px rgba(0,0,0,0.3);" onclick="event.stopPropagation()">
                        <!-- En-tête -->
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 25px; border-bottom: 3px solid #2563eb; padding-bottom: 15px;">
                            <h2 style="font-size: 24px; font-weight: bold; color: #111827; margin: 0;">✉️ Nouveau message</h2>
                            <button onclick="closeComposeMessage()" style="background: none; border: none; font-size: 28px; color: #6b7280; cursor: pointer; padding: 0; line-height: 1;">✖</button>
                        </div>

                        <!-- Formulaire -->
                        <div style="display: flex; flex-direction: column; gap: 20px;">
                            <!-- Destinataire -->
                            <div style="position: relative;">
                                <label style="display: block; font-weight: 600; color: #111827; margin-bottom: 8px; font-size: 14px;">📧 Destinataire *</label>
                                <input type="text"
                                       value="${state.selectedUser ? `${state.selectedUser.nom} (@${state.selectedUser.username})` : state.userSearchTerm}"
                                       oninput="handleUserSearch(this.value)"
                                       onfocus="state.showUserDropdown = true; render();"
                                       placeholder="Cliquez pour voir tous les utilisateurs..."
                                       style="width: 100%; padding: 12px 16px; border: 2px solid #d1d5db; border-radius: 8px; font-size: 15px; color: #111827; background: #ffffff;"
                                       autocomplete="off">

                                ${state.showUserDropdown && getFilteredUsers().length > 0 ? `
                                    <div style="position: absolute; z-index: 10000; width: 100%; margin-top: 8px; background: #ffffff; border: 2px solid #2563eb; border-radius: 8px; box-shadow: 0 10px 30px rgba(0,0,0,0.2); max-height: 320px; overflow-y: auto;">
                                        <!-- En-tête liste -->
                                        <div style="position: sticky; top: 0; background: #2563eb; color: #ffffff; padding: 12px 16px; font-weight: 700; font-size: 13px; border-bottom: 1px solid #1e40af;">
                                            📋 ${state.userSearchTerm ? `Résultats (${getFilteredUsers().length})` : `Tous les utilisateurs (${getFilteredUsers().length})`}
                                        </div>
                                        <!-- Liste utilisateurs -->
                                        ${getFilteredUsers().map(user => `
                                            <div onclick="selectUser('${user.username}')"
                                                 style="padding: 12px 16px; cursor: pointer; border-bottom: 1px solid #e5e7eb; background: #ffffff; color: #111827;"
                                                 onmouseover="this.style.background='#eff6ff'"
                                                 onmouseout="this.style.background='#ffffff'">
                                                <div style="font-weight: 700; color: #111827; font-size: 15px; margin-bottom: 4px;">${user.nom}</div>
                                                <div style="font-size: 13px; color: #374151;">
                                                    <span style="background: #dbeafe; color: #1e40af; padding: 2px 8px; border-radius: 4px; font-weight: 600;">@${user.username}</span>
                                                    ${user.niveau !== 1 ? `<span style="margin-left: 8px; color: #111827; font-weight: 600;">• ${user.departement}</span>` : '<span style="margin-left: 8px; color: #2563eb; font-weight: 700;">• Admin Principal</span>'}
                                                </div>
                                                <div style="font-size: 12px; color: #6b7280; margin-top: 4px;">Niveau ${user.niveau} - ${user.role}</div>
                                            </div>
                                        `).join('')}
                                    </div>
                                ` : ''}
                            </div>

                            <!-- Sujet -->
                            <div>
                                <label style="display: block; font-weight: 600; color: #111827; margin-bottom: 8px; font-size: 14px;">📝 Sujet *</label>
                                <input type="text"
                                       value="${state.composeMessageSubject}"
                                       oninput="state.composeMessageSubject = this.value"
                                       placeholder="Entrez le sujet du message"
                                       style="width: 100%; padding: 12px 16px; border: 2px solid #d1d5db; border-radius: 8px; font-size: 15px; color: #111827; background: #ffffff;">
                            </div>

                            <!-- Message -->
                            <div>
                                <label style="display: block; font-weight: 600; color: #111827; margin-bottom: 8px; font-size: 14px;">💬 Message *</label>
                                <textarea
                                       oninput="state.composeMessageBody = this.value"
                                       placeholder="Écrivez votre message ici..."
                                       rows="8"
                                       style="width: 100%; padding: 12px 16px; border: 2px solid #d1d5db; border-radius: 8px; font-size: 15px; color: #111827; background: #ffffff; resize: vertical; font-family: inherit;">${state.composeMessageBody}</textarea>
                            </div>

                            <!-- Boutons -->
                            <div style="display: flex; gap: 12px; margin-top: 10px;">
                                <button onclick="sendNewMessage()"
                                        style="flex: 1; padding: 14px 24px; background: linear-gradient(135deg, #2563eb, #1e40af); color: #ffffff; border: none; border-radius: 8px; font-weight: 700; font-size: 15px; cursor: pointer; box-shadow: 0 4px 12px rgba(37,99,235,0.3);"
                                        onmouseover="this.style.transform='translateY(-2px)'; this.style.boxShadow='0 6px 16px rgba(37,99,235,0.4)'"
                                        onmouseout="this.style.transform='translateY(0)'; this.style.boxShadow='0 4px 12px rgba(37,99,235,0.3)'">
                                    ✅ Envoyer
                                </button>
                                <button onclick="closeComposeMessage()"
                                        style="padding: 14px 24px; background: #f3f4f6; color: #374151; border: 2px solid #d1d5db; border-radius: 8px; font-weight: 600; font-size: 15px; cursor: pointer;"
                                        onmouseover="this.style.background='#e5e7eb'"
                                        onmouseout="this.style.background='#f3f4f6'">
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

// Fonction pour afficher/masquer le mot de passe
function togglePasswordVisibility(inputId) {
    const input = document.getElementById(inputId);
    const icon = document.getElementById(inputId + '_icon');

    if (!input || !icon) return;

    if (input.type === 'password') {
        input.type = 'text';
        icon.textContent = '🙈'; // Œil barré
    } else {
        input.type = 'password';
        icon.textContent = '👁️'; // Œil ouvert
    }
}

// Initialisation
async function initApp() {
    // Nettoyer l'ancien localStorage (migration vers sessionStorage)
    try {
        if (localStorage.getItem('cerer_session')) {
            localStorage.removeItem('cerer_session');
            console.log('✅ Migration localStorage → sessionStorage effectuée');
        }
    } catch (error) {
        console.error('Erreur migration storage:', error);
    }

    // Afficher le loader de vérification de session
    render();

    // Restaurer la session si elle existe
    const sessionRestored = await restoreSession();

    // Afficher l'interface appropriée (connecté ou page de connexion)
    render();

    // Charger les rôles et départements
    await loadRolesAndDepartements();
}

// Démarrer l'application
initApp();