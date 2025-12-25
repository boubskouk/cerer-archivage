/**
 * ============================================
 * SUPER ADMIN DASHBOARD - FRONTEND
 * ============================================
 *
 * Gère l'affichage du dashboard Super Admin
 * Récupère et affiche les statistiques système
 *
 * 🛡️ VERSION: 20241224999 - FILTRAGE NIVEAU 0 ACTIVÉ
 */

// 🔍 LOG VERSION POUR DÉBOGAGE
console.log('═══════════════════════════════════════════════════════════');
console.log('🛡️ SUPER ADMIN DASHBOARD - VERSION 20241224999');
console.log('🔒 SÉCURITÉ: Filtrage niveau 0 ACTIF dans création utilisateur');
console.log('═══════════════════════════════════════════════════════════');

// Variables globales pour les graphiques
let usersChart = null;
let documentsChart = null;

// État global
const state = {
    currentSection: 'dashboard',

    // Module Utilisateurs
    users: [],
    usersStats: null,
    usersPagination: { page: 1, totalPages: 1, totalUsers: 0 },
    usersFilters: {
        search: '',
        role: 'all',
        status: 'all',
        period: 'all',
        startDate: '',
        endDate: ''
    },
    selectedUser: null,
    userHistory: [],
    historyPagination: { page: 1, totalPages: 1 },

    // Module Documents
    documentsStats: null,
    documentsActivity: null,
    documentsPeriod: 'all',
    documentsCustomStartDate: null,
    documentsCustomEndDate: null,
    documentsSubTab: 'overview', // Sous-onglet actif
    mostShared: [],
    mostDownloaded: [],
    level1Deletions: [],
    deletedDocuments: [],
    deletedPagination: { page: 1, totalPages: 1, total: 0 },
    expandedAdmin: null, // Admin dont on affiche les documents supprimés
    adminDeletedDocs: [], // Documents supprimés par l'admin sélectionné
    lockedDocuments: [],
    lockedPagination: { page: 1, totalPages: 1, total: 0 },
    allDocuments: [],
    allDocsPagination: { page: 1, totalPages: 1, total: 0 },
    allDocsSearch: '',
    // Filtres de recherche pour chaque section
    searchFilters: {
        shared: '',
        downloaded: '',
        deleted: '',
        locked: ''
    },

    // Modales
    showUserDetails: false,
    showCreateUser: false,
    showBlockConfirm: false,
    showDeleteConfirm: false,
    showFullHistory: false,
    showRestoreConfirm: false,  // ✅ NOUVEAU: Modal restauration document
    documentToRestore: null,     // ✅ NOUVEAU: Document à restaurer
    restoringDocument: false,    // ✅ NOUVEAU: État restauration en cours

    // Rôles et départements (pour les selects)
    roles: [],
    departements: [],

    // Module Départements
    departmentsData: [],
    departmentsStats: null,
    departmentsPagination: { page: 1, totalPages: 1, total: 0 },
    departmentsFilters: {
        search: '',
        type: 'all' // 'all', 'main', 'services'
    },
    selectedDepartment: null,
    showCreateDepartment: false,
    showEditDepartment: false,
    showDeleteDepartmentConfirm: false,

    // Mode maintenance
    maintenanceMode: false
};

/**
 * Formater une date avec le fuseau horaire du serveur (Dakar)
 * Utilise toujours l'heure du serveur, pas celle du client
 */
function formatServerDate(date) {
    if (!date) return '-';
    return new Date(date).toLocaleString('fr-FR', {
        timeZone: 'Africa/Dakar',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    });
}

/**
 * Navigation entre sections
 */
function navigateToSection(section) {
    state.currentSection = section;

    // Mettre à jour les tabs
    document.querySelectorAll('.nav-tab').forEach(tab => {
        tab.classList.remove('active');
        if (tab.dataset.section === section) {
            tab.classList.add('active');
        }
    });

    // Masquer toutes les sections
    document.querySelectorAll('[id^="section-"]').forEach(sec => {
        sec.style.display = 'none';
    });

    // Afficher la section active
    const sectionElement = document.getElementById(`section-${section}`);
    if (sectionElement) {
        sectionElement.style.display = 'block';
    }

    // Charger les données de la section
    loadCurrentSection();
}

/**
 * Charger la section actuelle
 */
async function loadCurrentSection() {
    if (state.currentSection === 'dashboard') {
        await loadDashboard();
    } else if (state.currentSection === 'users') {
        await loadUsersModule();
    } else if (state.currentSection === 'documents') {
        await loadDocumentsModule();
    } else if (state.currentSection === 'departments') {
        await loadDepartmentsModule();
    }
}

/**
 * Rafraîchir la section actuelle
 */
async function refreshCurrentSection() {
    await loadCurrentSection();
}

/**
 * Vérifier l'état de la maintenance au chargement
 */
async function checkMaintenanceStatus() {
    try {
        const response = await fetch('/api/superadmin/maintenance/status', {
            credentials: 'include'
        });
        const data = await response.json();

        if (data.success) {
            state.maintenanceMode = data.maintenanceMode;
            updateMaintenanceButton(data.maintenanceMode);
        }
    } catch (error) {
        console.error('Erreur vérification maintenance:', error);
    }
}

/**
 * Basculer le mode maintenance
 */
async function toggleMaintenance() {
    try {
        // Vérifier l'état actuel
        const statusResponse = await fetch('/api/superadmin/maintenance/status', {
            credentials: 'include'
        });
        const statusData = await statusResponse.json();

        const isCurrentlyEnabled = statusData.maintenanceMode;
        const endpoint = isCurrentlyEnabled ? '/api/superadmin/maintenance/disable' : '/api/superadmin/maintenance/enable';

        // ✅ ACTIVATION/DÉSACTIVATION DIRECTE sans confirmation
        const response = await fetch(endpoint, {
            method: 'POST',
            credentials: 'include'
        });

        const data = await response.json();

        if (data.success) {
            // Mettre à jour le bouton immédiatement
            updateMaintenanceButton(!isCurrentlyEnabled);
            console.log(`✅ Maintenance ${!isCurrentlyEnabled ? 'activée' : 'désactivée'}`);
        } else {
            // Afficher uniquement les erreurs
            await customAlert({
                title: 'Erreur',
                message: data.message,
                type: 'error',
                icon: '❌'
            });
        }
    } catch (error) {
        console.error('Erreur toggle maintenance:', error);
        await customAlert({
            title: 'Erreur',
            message: 'Erreur lors de la modification du mode maintenance',
            type: 'error',
            icon: '❌'
        });
    }
}

/**
 * Mettre à jour l'apparence du bouton maintenance
 */
function updateMaintenanceButton(isEnabled) {
    const btn = document.getElementById('maintenanceBtn');
    const icon = document.getElementById('maintenanceIcon');
    const text = document.getElementById('maintenanceText');
    const banner = document.getElementById('maintenanceBanner');

    // Mettre à jour le state
    state.maintenanceMode = isEnabled;

    if (isEnabled) {
        // Maintenance ACTIVÉE : Vert ÉCLATANT avec effet GLOW
        btn.style.background = 'linear-gradient(135deg, #10b981 0%, #059669 100%)';
        btn.style.borderColor = '#10b981';
        btn.style.boxShadow = '0 2px 12px rgba(16, 185, 129, 0.5)';
        btn.style.animation = 'pulse-success 2s infinite';
        icon.textContent = '✅';
        if (text) text.textContent = 'ON';
        btn.title = 'Mode maintenance ACTIVÉ - Site bloqué sauf whitelist - Cliquez pour désactiver';

        // Ajouter l'animation pulse-success si elle n'existe pas déjà
        if (!document.getElementById('pulse-success-style')) {
            const style = document.createElement('style');
            style.id = 'pulse-success-style';
            style.textContent = `
                @keyframes pulse-success {
                    0%, 100% {
                        box-shadow: 0 2px 12px rgba(16, 185, 129, 0.5);
                    }
                    50% {
                        box-shadow: 0 2px 18px rgba(16, 185, 129, 0.8);
                    }
                }
            `;
            document.head.appendChild(style);
        }

        // ✅ AFFICHER LA BANNIÈRE D'AVERTISSEMENT
        if (banner) {
            banner.style.display = 'block';
            banner.style.animation = 'slideDown 0.3s ease-out';
        }
    } else {
        // Maintenance DÉSACTIVÉE : Gris neutre
        btn.style.background = 'linear-gradient(135deg, #6b7280 0%, #4b5563 100%)';
        btn.style.borderColor = '#6b7280';
        btn.style.boxShadow = '0 2px 8px rgba(107, 114, 128, 0.3)';
        btn.style.animation = 'none';
        icon.textContent = '🔒';
        if (text) text.textContent = 'OFF';
        btn.title = 'Mode maintenance DÉSACTIVÉ - Site accessible - Cliquez pour activer';

        // ✅ MASQUER LA BANNIÈRE
        if (banner) {
            banner.style.display = 'none';
        }
    }

    // Rafraîchir la liste des utilisateurs si on est dans la section users
    if (state.currentSection === 'users') {
        renderUsersModule();
    }
}

/**
 * Afficher une notification en haut de l'écran qui disparaît après 5 secondes
 */
function showTopNotification(message, type = 'info') {
    // Supprimer les anciennes notifications
    const oldNotif = document.getElementById('topNotification');
    if (oldNotif) oldNotif.remove();

    // Créer la notification
    const notif = document.createElement('div');
    notif.id = 'topNotification';
    notif.style.cssText = `
        position: fixed;
        top: 20px;
        left: 50%;
        transform: translateX(-50%);
        background: ${type === 'success' ? 'linear-gradient(135deg, #10b981 0%, #059669 100%)' :
                     type === 'error' ? 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)' :
                     'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)'};
        color: white;
        padding: 20px 40px;
        border-radius: 12px;
        font-size: 18px;
        font-weight: 700;
        box-shadow: 0 10px 40px rgba(0,0,0,0.3);
        z-index: 100000;
        animation: slideDown 0.5s ease-out;
        max-width: 90%;
        text-align: center;
    `;
    notif.textContent = message;

    // Ajouter l'animation CSS
    const style = document.createElement('style');
    style.textContent = `
        @keyframes slideDown {
            from {
                opacity: 0;
                transform: translateX(-50%) translateY(-100px);
            }
            to {
                opacity: 1;
                transform: translateX(-50%) translateY(0);
            }
        }
        @keyframes slideUp {
            from {
                opacity: 1;
                transform: translateX(-50%) translateY(0);
            }
            to {
                opacity: 0;
                transform: translateX(-50%) translateY(-100px);
            }
        }
    `;
    document.head.appendChild(style);

    document.body.appendChild(notif);

    // Supprimer après 5 secondes
    setTimeout(() => {
        notif.style.animation = 'slideUp 0.5s ease-out';
        setTimeout(() => notif.remove(), 500);
    }, 5000);
}

/**
 * Déconnecter tous les utilisateurs
 */
async function forceLogoutAllUsers() {
    try {
        console.log('🔴 Déconnexion de tous les utilisateurs...');

        const response = await fetch('/api/superadmin/force-logout-all', {
            method: 'POST',
            credentials: 'include'
        });

        const data = await response.json();

        if (data.success) {
            console.log(`✅ ${data.count} utilisateur(s) déconnecté(s)`);
            console.log(`💥 ${data.sessionsDestroyed} session(s) détruite(s)`);

            // Afficher un message EN HAUT DE L'ÉCRAN qui disparaît après 5 secondes
            showTopNotification(
                `🔴 TOUS LES UTILISATEURS ONT ÉTÉ DÉCONNECTÉS - ${data.count} utilisateur(s) - ${data.sessionsDestroyed} session(s) détruite(s)`,
                'success'
            );

            // Rafraîchir la liste si on est dans la section users
            if (state.currentSection === 'users') {
                renderUsersModule();
            }
        } else {
            await customAlert({
                title: 'Erreur',
                message: data.message || 'Erreur lors de la déconnexion',
                type: 'error',
                icon: '❌'
            });
        }
    } catch (error) {
        console.error('❌ Erreur force-logout-all:', error);
        await customAlert({
            title: 'Erreur',
            message: 'Erreur lors de la déconnexion des utilisateurs',
            type: 'error',
            icon: '❌'
        });
    }
}

/**
 * Vérifier l'authentification Super Admin
 */
async function checkAuth() {
    try {
        const response = await fetch('/api/superadmin/test', {
            method: 'GET',
            credentials: 'include'
        });

        if (!response.ok) {
            console.warn('⚠️ Authentification échouée, statut:', response.status);
            // Seulement rediriger si c'est vraiment une erreur d'auth (401)
            if (response.status === 401 || response.status === 403) {
                window.location.href = '/super-admin-login.html';
            }
            return false;
        }

        const data = await response.json();

        if (!data.success) {
            console.warn('⚠️ Réponse auth invalide');
            window.location.href = '/super-admin-login.html';
            return false;
        }

        console.log('✅ Authentification Super Admin valide');
        return true;

    } catch (error) {
        console.error('❌ Erreur vérification auth:', error);
        // Ne pas rediriger en cas d'erreur réseau, juste logger
        // La session peut encore être valide
        return false;
    }
}

/**
 * Charger le dashboard complet avec timeout
 */
async function loadDashboard() {
    try {
        showLoading();
        hideError();

        // Vérifier l'authentification avec timeout de 5 secondes
        console.log('🔐 Vérification authentification...');
        const authPromise = checkAuth();
        const timeoutPromise = new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Timeout authentification')), 5000)
        );

        const isAuth = await Promise.race([authPromise, timeoutPromise]);

        if (!isAuth) {
            hideLoading();
            console.warn('⚠️ Authentification échouée - Arrêt du chargement');
            return;
        }

        console.log('✅ Authentification OK');

        // Afficher le dashboard vide d'abord pour meilleure UX
        showDashboard();

        // Charger les statistiques en arrière-plan
        console.log('📊 Chargement statistiques...');
        loadStats().catch(err => {
            console.error('❌ Erreur stats:', err);
            showError('Impossible de charger les statistiques');
        });

        // Charger les graphiques en arrière-plan
        console.log('📈 Chargement graphiques...');
        loadCharts().catch(err => {
            console.error('❌ Erreur graphiques:', err);
        });

    } catch (error) {
        console.error('❌ Erreur chargement dashboard:', error);
        hideLoading();
        showError(error.message || 'Erreur lors du chargement du dashboard');
    }
}

/**
 * Charger les statistiques globales
 */
async function loadStats() {
    const response = await fetch('/api/superadmin/dashboard/stats', {
        method: 'GET',
        credentials: 'include'
    });

    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Erreur lors de la récupération des statistiques');
    }

    const data = await response.json();

    if (!data.success) {
        throw new Error(data.message || 'Erreur inconnue');
    }

    displayStats(data.data);
}

/**
 * Afficher les statistiques
 */
function displayStats(stats) {
    // Statistiques utilisateurs
    document.getElementById('totalUsers').textContent = stats.users.total.toLocaleString();
    document.getElementById('activeToday').textContent = stats.users.activeToday.toLocaleString();

    // Statistiques documents
    document.getElementById('totalDocuments').textContent = stats.documents.total.toLocaleString();
    document.getElementById('docsToday').textContent = stats.documents.createdToday.toLocaleString();

    // Ressources système
    if (stats.system.resources) {
        const cpu = stats.system.resources.cpu;
        const memory = stats.system.resources.memory;
        const uptime = stats.system.resources.uptime;

        // CPU
        document.getElementById('cpuUsage').textContent = cpu.usage + '%';
        document.getElementById('cpuCores').textContent = cpu.cores;
        document.getElementById('cpuPercent').textContent = cpu.usage + '%';

        const cpuProgress = document.getElementById('cpuProgress');
        cpuProgress.style.width = cpu.usage + '%';
        cpuProgress.className = 'progress-fill ' + getProgressClass(cpu.usage);

        // Mémoire
        document.getElementById('memoryPercent').textContent =
            `${memory.percentage}% (${memory.used} / ${memory.total})`;

        const memProgress = document.getElementById('memoryProgress');
        memProgress.style.width = memory.percentage + '%';
        memProgress.className = 'progress-fill ' + getProgressClass(memory.percentage);

        // Uptime
        document.getElementById('systemUptime').textContent = formatUptime(uptime.system);
        document.getElementById('processUptime').textContent = formatUptime(uptime.process);
    }

    // Sécurité
    document.getElementById('securityAlerts').textContent = stats.security.activeAlerts || 0;

    // Événements de sécurité
    displaySecurityEvents(stats.security.events || []);
}

/**
 * Afficher les événements de sécurité
 */
function displaySecurityEvents(events) {
    const container = document.getElementById('securityEvents');

    if (events.length === 0) {
        container.innerHTML = '<p style="color: #718096;">Aucun événement de sécurité</p>';
        return;
    }

    container.innerHTML = events.map(event => `
        <div class="event-item">
            <div class="type">${getEventLabel(event.type)}</div>
            <div class="details">
                ${event.count} occurrence(s) -
                Dernier: ${formatServerDate(event.lastOccurrence)}
            </div>
        </div>
    `).join('');
}

/**
 * Obtenir le label d'un événement de sécurité
 */
function getEventLabel(type) {
    const labels = {
        'UNAUTHORIZED_SUPERADMIN_ACCESS': '🚫 Tentative d\'accès non autorisé',
        'LOGIN_FAILED': '❌ Échec de connexion',
        'RATE_LIMIT_EXCEEDED': '⚠️ Limite de requêtes dépassée'
    };
    return labels[type] || type;
}

/**
 * Obtenir la classe CSS pour la barre de progression
 */
function getProgressClass(percentage) {
    if (percentage >= 90) return 'danger';
    if (percentage >= 70) return 'warning';
    return '';
}

/**
 * Formater le temps d'uptime
 */
function formatUptime(seconds) {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);

    if (days > 0) {
        return `${days}j ${hours}h ${minutes}m`;
    } else if (hours > 0) {
        return `${hours}h ${minutes}m`;
    } else {
        return `${minutes}m`;
    }
}

/**
 * Charger les graphiques
 */
async function loadCharts() {
    // Charger les données des utilisateurs
    const usersData = await loadTrends('users', '24h');
    displayUsersChart(usersData);

    // Charger les données des documents
    const docsData = await loadTrends('documents', '24h');
    displayDocumentsChart(docsData);
}

/**
 * Charger les tendances
 */
async function loadTrends(type, period) {
    const response = await fetch(`/api/superadmin/dashboard/trends?type=${type}&period=${period}`, {
        method: 'GET',
        credentials: 'include'
    });

    if (!response.ok) {
        throw new Error('Erreur lors de la récupération des tendances');
    }

    const data = await response.json();

    if (!data.success) {
        throw new Error(data.message || 'Erreur inconnue');
    }

    return data.data;
}

/**
 * Afficher le graphique des utilisateurs
 */
function displayUsersChart(data) {
    const ctx = document.getElementById('usersChart').getContext('2d');

    // Détruire l'ancien graphique s'il existe
    if (usersChart) {
        usersChart.destroy();
    }

    // Préparer les données
    const labels = data.map((item, index) => `H-${24 - index}`);
    const values = data.map(item => item.count);

    usersChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: 'Utilisateurs actifs',
                data: values,
                borderColor: '#667eea',
                backgroundColor: 'rgba(102, 126, 234, 0.1)',
                borderWidth: 2,
                fill: true,
                tension: 0.4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: false
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: {
                        precision: 0
                    }
                }
            }
        }
    });
}

/**
 * Afficher le graphique des documents
 */
function displayDocumentsChart(data) {
    const ctx = document.getElementById('documentsChart').getContext('2d');

    // Détruire l'ancien graphique s'il existe
    if (documentsChart) {
        documentsChart.destroy();
    }

    // Préparer les données
    const labels = data.map((item, index) => `H-${24 - index}`);
    const values = data.map(item => item.count);

    documentsChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: 'Documents créés',
                data: values,
                backgroundColor: 'rgba(118, 75, 162, 0.7)',
                borderColor: '#764ba2',
                borderWidth: 2
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: false
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: {
                        precision: 0
                    }
                }
            }
        }
    });
}

/**
 * Afficher l'état de chargement
 */
function showLoading() {
    document.getElementById('loading').style.display = 'block';
    document.getElementById('dashboard-content').style.display = 'none';
}

/**
 * Masquer l'état de chargement
 */
function hideLoading() {
    document.getElementById('loading').style.display = 'none';
}

/**
 * Afficher le dashboard
 */
function showDashboard() {
    document.getElementById('loading').style.display = 'none';
    document.getElementById('dashboard-content').style.display = 'block';
}

/**
 * Afficher une erreur
 */
function showError(message) {
    const errorDiv = document.getElementById('error');
    errorDiv.textContent = '❌ ' + message;
    errorDiv.style.display = 'block';
    document.getElementById('loading').style.display = 'none';
}

/**
 * Masquer l'erreur
 */
function hideError() {
    document.getElementById('error').style.display = 'none';
}

/**
 * Déconnexion
 */
async function logout() {
    try {
        // Détruire la session
        await fetch('/api/logout', {
            method: 'POST',
            credentials: 'include'
        });
    } catch (error) {
        console.error('Erreur déconnexion:', error);
    }

    // Rediriger immédiatement vers la page de connexion
    window.location.href = '/super-admin-login.html';
}

// ============================================
// MODULE UTILISATEURS
// ============================================

/**
 * Charger le module utilisateurs
 */
async function loadUsersModule() {
    try {
        // Charger les rôles et départements (pour les selects)
        if (state.roles.length === 0) {
            try {
                const rolesRes = await fetch('/api/roles', { credentials: 'include' });
                if (rolesRes.ok) {
                    const rolesData = await rolesRes.json();
                    state.roles = rolesData.roles || [];
                }
            } catch (e) {
                console.warn('Impossible de charger les rôles, utilisation par défaut');
                state.roles = [];
            }
        }

        if (state.departements.length === 0) {
            try {
                const deptsRes = await fetch('/api/departements', { credentials: 'include' });
                if (deptsRes.ok) {
                    const deptsData = await deptsRes.json();
                    state.departements = deptsData.departements || [];
                }
            } catch (e) {
                console.warn('Impossible de charger les départements, utilisation par défaut');
                state.departements = [];
            }
        }

        // Charger les utilisateurs
        await loadUsers();

        // Render
        renderUsersModule();

    } catch (error) {
        console.error('Erreur chargement module utilisateurs:', error);
        showError('Erreur lors du chargement du module utilisateurs: ' + error.message);
    }
}

/**
 * Charger les utilisateurs
 */
async function loadUsers() {
    const { search, role, status, period, startDate, endDate } = state.usersFilters;
    const { page } = state.usersPagination;

    console.log('🔍 DEBUG loadUsers - Filtre status:', status);

    const params = new URLSearchParams({
        search,
        role,
        status,
        page,
        period
    });

    console.log('🔍 DEBUG loadUsers - URL:', `/api/superadmin/users?${params}`);

    // Ajouter les dates personnalisées si période = custom
    if (period === 'custom' && startDate && endDate) {
        params.append('startDate', startDate);
        params.append('endDate', endDate);
    }

    const response = await fetch(`/api/superadmin/users?${params}`, {
        credentials: 'include'
    });

    if (!response.ok) {
        const errorText = await response.text();
        console.error('Erreur API response:', response.status, errorText);
        throw new Error(`Erreur API: ${response.status} - ${errorText.substring(0, 100)}`);
    }

    const contentType = response.headers.get('content-type');
    if (!contentType || !contentType.includes('application/json')) {
        const text = await response.text();
        console.error('La réponse n\'est pas du JSON:', text.substring(0, 200));
        throw new Error('La réponse du serveur n\'est pas du JSON');
    }

    const data = await response.json();

    if (data.success) {
        console.log(`✅ DEBUG loadUsers - Reçu ${data.data.users.length} utilisateur(s)`);
        state.users = data.data.users;
        state.usersStats = data.data.stats;
        state.usersPagination = data.data.pagination;
    } else {
        throw new Error(data.message || 'Erreur inconnue');
    }
}

/**
 * Render du module utilisateurs
 */
function renderUsersModule() {
    const sectionUsers = document.getElementById('section-users');

    // Sauvegarder le focus et la position du curseur
    const activeElement = document.activeElement;
    const isSearchInput = activeElement && activeElement.placeholder && activeElement.placeholder.includes('Rechercher');
    const cursorPosition = isSearchInput ? activeElement.selectionStart : null;

    sectionUsers.innerHTML = `
        <div class="users-module">
            ${renderUsersStats()}
            ${renderUsersFilters()}
            ${renderUsersTable()}
            ${renderUsersPagination()}
        </div>

        ${state.showUserDetails ? renderUserDetailsModal() : ''}
        ${state.showCreateUser ? renderCreateUserModal() : ''}
        ${state.showBlockConfirm ? renderBlockConfirmModal() : ''}
        ${state.showDeleteConfirm ? renderDeleteConfirmModal() : ''}
    `;

    // Restaurer le focus si c'était le champ de recherche
    if (isSearchInput) {
        setTimeout(() => {
            const searchInput = sectionUsers.querySelector('input[placeholder*="Rechercher"]');
            if (searchInput) {
                searchInput.focus();
                if (cursorPosition !== null) {
                    searchInput.setSelectionRange(cursorPosition, cursorPosition);
                }
            }
        }, 0);
    }
}

function renderUsersStats() {
    const { total, active, blocked } = state.usersStats || { total: 0, active: 0, blocked: 0 };

    return `
        <div class="stats-bar">
            <div class="stat-item">
                👥 ${total} Total
            </div>
            <div class="stat-item success">
                ✅ ${active} Actifs
            </div>
            <div class="stat-item danger">
                🚫 ${blocked} Bloqués
            </div>
        </div>
    `;
}

function renderUsersFilters() {
    const showCustomDates = state.usersFilters.period === 'custom';
    const periodActive = state.usersFilters.period !== 'all';

    return `
        <div class="filters-bar">
            <input type="text"
                   placeholder="🔍 Rechercher par nom, email ou username..."
                   value="${state.usersFilters.search}"
                   oninput="handleSearchChange(this.value)" />

            <select onchange="handleRoleFilter(this.value)">
                <option value="all">Tous les rôles</option>
                ${state.roles.map(role => `
                    <option value="${role._id}" ${state.usersFilters.role === role._id ? 'selected' : ''}>
                        ${role.nom}
                    </option>
                `).join('')}
            </select>

            <select onchange="handleStatusFilter(this.value)">
                <option value="all">Tous les statuts</option>
                <option value="active" ${state.usersFilters.status === 'active' ? 'selected' : ''}>Actifs</option>
                <option value="blocked" ${state.usersFilters.status === 'blocked' ? 'selected' : ''}>Bloqués</option>
                <option value="online" ${state.usersFilters.status === 'online' ? 'selected' : ''}>🟢 Connectés</option>
            </select>

            <select onchange="handlePeriodFilter(this.value)" style="border: ${periodActive ? '2px solid #667eea' : '2px solid #e2e8f0'};">
                <option value="all">📅 Toute la période</option>
                <option value="today" ${state.usersFilters.period === 'today' ? 'selected' : ''}>Aujourd'hui</option>
                <option value="7days" ${state.usersFilters.period === '7days' ? 'selected' : ''}>7 derniers jours</option>
                <option value="30days" ${state.usersFilters.period === '30days' ? 'selected' : ''}>30 derniers jours</option>
                <option value="custom" ${state.usersFilters.period === 'custom' ? 'selected' : ''}>Période personnalisée</option>
            </select>

            ${showCustomDates ? `
                <input type="date"
                       value="${state.usersFilters.startDate}"
                       onchange="handleCustomDateChange('startDate', this.value)"
                       style="padding: 10px 16px; border: 2px solid #667eea; border-radius: 8px; font-size: 14px;" />
                <input type="date"
                       value="${state.usersFilters.endDate}"
                       onchange="handleCustomDateChange('endDate', this.value)"
                       style="padding: 10px 16px; border: 2px solid #667eea; border-radius: 8px; font-size: 14px;" />
            ` : ''}

            <button class="refresh-btn" onclick="showCreateUserModal()">
                ➕ Créer utilisateur
            </button>
        </div>
        ${periodActive ? `
            <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 10px 16px; border-radius: 8px; font-size: 13px; font-weight: 600; margin-bottom: 12px; display: inline-block;">
                🔍 Filtre actif : ${getPeriodLabel(state.usersFilters.period)}
                ${state.usersFilters.period === 'custom' ? `(${formatDate(state.usersFilters.startDate)} - ${formatDate(state.usersFilters.endDate)})` : ''}
                <button onclick="clearPeriodFilter()" style="background: rgba(255,255,255,0.3); border: none; color: white; padding: 4px 8px; border-radius: 4px; margin-left: 8px; cursor: pointer; font-size: 12px;">
                    ✕ Effacer
                </button>
            </div>
        ` : ''}
    `;
}

function getPeriodLabel(period) {
    const labels = {
        'today': "Aujourd'hui",
        '7days': '7 derniers jours',
        '30days': '30 derniers jours',
        'custom': 'Période personnalisée'
    };
    return labels[period] || 'Toute la période';
}

function formatDate(dateStr) {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    return date.toLocaleDateString('fr-FR');
}

function renderUsersTable() {
    if (state.users.length === 0) {
        return '<p style="text-align: center; color: #718096; padding: 40px;">Aucun utilisateur trouvé</p>';
    }

    return `
        <table class="users-table">
            <thead>
                <tr>
                    <th>Utilisateur</th>
                    <th>Email</th>
                    <th>Rôle</th>
                    <th>Département</th>
                    <th>Créé par</th>
                    <th>Date de création</th>
                    <th>Dernière connexion</th>
                    <th>Statut</th>
                    <th>Actions</th>
                </tr>
            </thead>
            <tbody>
                ${state.users.map(user => renderUserRow(user)).join('')}
            </tbody>
        </table>
    `;
}

function renderUserRow(user) {
    const isBlocked = user.status === 'blocked';
    const isLevel0 = user.role.niveau === 0;
    const lastLoginText = user.lastLogin
        ? formatServerDate(user.lastLogin)
        : 'Jamais';
    const createdAtText = user.createdAt
        ? formatServerDate(user.createdAt)
        : '-';

    // En mode maintenance, vérifier si l'utilisateur est dans la whitelist
    const inWhitelist = user.inMaintenanceWhitelist || false;

    // Déterminer le statut de connexion
    const isOnline = user.isOnline || false;

    // DEBUG: Log pour TOUS les utilisateurs
    console.log(`👤 User ${user.username}:`, {
        isOnline: user.isOnline,
        isOnlineCalculated: isOnline,
        lastActivity: user.lastActivity
    });

    // Badge simple avec emoji (plus visible)
    const statusBadge = isOnline ? '🟢' : '⚪';

    // Texte "EN LIGNE" simplifié
    const onlineText = isOnline ? ' <strong style="color: #10b981; font-size: 11px;">EN LIGNE</strong>' : '';

    console.log(`🔍 ${user.username} - isOnline=${isOnline}, badge="${statusBadge}", texte="${onlineText}"`);

    return `
        <tr class="${isBlocked ? 'blocked' : ''}">
            <td>
                <div style="display: flex; align-items: center; gap: 8px;">
                    ${statusBadge}
                    <div>
                        <strong>${user.nom}</strong>
                        ${onlineText}
                        <br>
                        <small style="color: #718096;">@${user.username}</small>
                    </div>
                </div>
            </td>
            <td>${user.email}</td>
            <td>
                <span class="user-badge badge-niveau-${user.role.niveau}">
                    ${user.role.nom}
                </span>
            </td>
            <td>${user.departement ? user.departement.nom : '-'}</td>
            <td>
                <span style="color: #4a5568; font-weight: 600;">
                    ${user.createdBy ? `👤 ${user.createdBy}` : '⚙️ Système'}
                </span>
            </td>
            <td>${createdAtText}</td>
            <td>${lastLoginText}</td>
            <td>
                <span class="user-badge ${isBlocked ? 'badge-blocked' : 'badge-active'}">
                    ${isBlocked ? '🚫 Bloqué' : '✅ Actif'}
                </span>
            </td>
            <td>
                <button class="action-btn btn-view" onclick="viewUserDetails('${user.username}')">
                    👁️ Voir
                </button>
                ${!isLevel0 ? `
                    ${state.maintenanceMode
                        ? (inWhitelist
                            ? `<button class="action-btn btn-block" onclick="confirmBlockUser('${user.username}')">
                                🚫 Bloquer
                               </button>`
                            : `<button class="action-btn btn-unblock" onclick="confirmUnblockUser('${user.username}')">
                                🔓 Débloquer
                               </button>`)
                        : isBlocked
                            ? `<button class="action-btn btn-unblock" onclick="confirmUnblockUser('${user.username}')">
                                🔓 Débloquer
                               </button>`
                            : `<button class="action-btn btn-block" onclick="confirmBlockUser('${user.username}')">
                                🚫 Bloquer
                               </button>`
                    }
                    <button class="action-btn btn-delete" onclick="confirmDeleteUser('${user.username}')">
                        🗑️ Supprimer
                    </button>
                ` : ''}
            </td>
        </tr>
    `;
}

function renderUsersPagination() {
    const { page, totalPages, totalUsers } = state.usersPagination;

    if (totalPages <= 1) return '';

    // Générer les numéros de pages à afficher
    const pageNumbers = [];
    const maxPagesToShow = 5;

    let startPage = Math.max(1, page - Math.floor(maxPagesToShow / 2));
    let endPage = Math.min(totalPages, startPage + maxPagesToShow - 1);

    // Ajuster si on est proche de la fin
    if (endPage - startPage < maxPagesToShow - 1) {
        startPage = Math.max(1, endPage - maxPagesToShow + 1);
    }

    for (let i = startPage; i <= endPage; i++) {
        pageNumbers.push(i);
    }

    return `
        <div class="pagination-container">
            <div class="pagination-info">
                ${totalUsers} utilisateur${totalUsers > 1 ? 's' : ''} au total - 15 par page
            </div>
            <div class="pagination">
                <button class="pagination-btn" ${page === 1 ? 'disabled' : ''} onclick="goToUsersPage(${page - 1})">
                    ◀ Précédent
                </button>

                ${startPage > 1 ? `
                    <button class="pagination-btn page-btn" onclick="goToUsersPage(1)">1</button>
                    ${startPage > 2 ? '<span class="pagination-dots">...</span>' : ''}
                ` : ''}

                ${pageNumbers.map(p => `
                    <button class="pagination-btn page-btn ${p === page ? 'active' : ''}"
                            onclick="goToUsersPage(${p})">
                        ${p}
                    </button>
                `).join('')}

                ${endPage < totalPages ? `
                    ${endPage < totalPages - 1 ? '<span class="pagination-dots">...</span>' : ''}
                    <button class="pagination-btn page-btn" onclick="goToUsersPage(${totalPages})">${totalPages}</button>
                ` : ''}

                <button class="pagination-btn" ${page === totalPages ? 'disabled' : ''} onclick="goToUsersPage(${page + 1})">
                    Suivant ▶
                </button>
            </div>
        </div>
    `;
}

// Filtres
let searchDebounce;
function handleSearchChange(value) {
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(async () => {
        state.usersFilters.search = value;
        state.usersPagination.page = 1;
        await loadUsers();
        renderUsersModule();
    }, 300);
}

function handleRoleFilter(value) {
    state.usersFilters.role = value;
    state.usersPagination.page = 1;
    loadUsers().then(renderUsersModule);
}

function handleStatusFilter(value) {
    state.usersFilters.status = value;
    state.usersPagination.page = 1;
    loadUsers().then(renderUsersModule);
}

function handlePeriodFilter(value) {
    state.usersFilters.period = value;
    state.usersPagination.page = 1;

    // Si on change vers "custom", ne pas charger encore (attendre les dates)
    // Sinon, charger immédiatement
    if (value !== 'custom') {
        loadUsers().then(renderUsersModule);
    } else {
        // Juste re-render pour afficher les inputs de date
        renderUsersModule();
    }
}

function handleCustomDateChange(field, value) {
    state.usersFilters[field] = value;

    // Si les deux dates sont remplies, charger les utilisateurs
    if (state.usersFilters.startDate && state.usersFilters.endDate) {
        state.usersPagination.page = 1;
        loadUsers().then(renderUsersModule);
    }
}

function clearPeriodFilter() {
    state.usersFilters.period = 'all';
    state.usersFilters.startDate = '';
    state.usersFilters.endDate = '';
    state.usersPagination.page = 1;
    loadUsers().then(renderUsersModule);
}

// Pagination
function goToUsersPage(page) {
    state.usersPagination.page = page;
    loadUsers().then(renderUsersModule);
}

// Modales
function renderUserDetailsModal() {
    const user = state.selectedUser;
    if (!user) return '';

    const lastLoginText = user.lastLogin
        ? formatServerDate(user.lastLogin)
        : 'Jamais connecté';

    const lastLogoutText = user.lastLogout
        ? formatServerDate(user.lastLogout)
        : 'Jamais déconnecté';

    return `
        <div class="modal-overlay" onclick="closeModal(event)">
            <div class="modal-content" onclick="event.stopPropagation()">
                <div class="modal-header">
                    <h2>👤 Détails de l'utilisateur</h2>
                    <button class="modal-close" onclick="closeUserDetailsModal()">✕</button>
                </div>
                <div class="modal-body">
                    <div class="detail-row">
                        <span class="detail-label">Nom complet</span>
                        <span class="detail-value">${user.nom}</span>
                    </div>
                    <div class="detail-row">
                        <span class="detail-label">Username</span>
                        <span class="detail-value">@${user.username}</span>
                    </div>
                    <div class="detail-row">
                        <span class="detail-label">Email</span>
                        <span class="detail-value">${user.email}</span>
                    </div>
                    <div class="detail-row">
                        <span class="detail-label">Rôle</span>
                        <span class="detail-value">
                            <span class="user-badge badge-niveau-${user.role.niveau}">
                                ${user.role.nom}
                            </span>
                        </span>
                    </div>
                    <div class="detail-row">
                        <span class="detail-label">Département</span>
                        <span class="detail-value">${user.departement ? user.departement.nom : 'Aucun'}</span>
                    </div>
                    <div class="detail-row">
                        <span class="detail-label">Date de création</span>
                        <span class="detail-value">${formatServerDate(user.createdAt)}</span>
                    </div>
                    <div class="detail-row">
                        <span class="detail-label">Créé par</span>
                        <span class="detail-value">${user.createdBy || 'Non renseigné'}</span>
                    </div>
                    <div class="detail-row">
                        <span class="detail-label">Dernière connexion</span>
                        <span class="detail-value">${lastLoginText}</span>
                    </div>
                    <div class="detail-row">
                        <span class="detail-label">Dernière déconnexion</span>
                        <span class="detail-value">${lastLogoutText}</span>
                    </div>
                    <div class="detail-row">
                        <span class="detail-label">Nombre de connexions</span>
                        <span class="detail-value">${user.loginCount}</span>
                    </div>
                    <div class="detail-row">
                        <span class="detail-label">Total d'actions</span>
                        <span class="detail-value">${user.actionsCount}</span>
                    </div>
                    <div class="detail-row">
                        <span class="detail-label">Statut</span>
                        <span class="detail-value">
                            <span class="user-badge ${user.status === 'blocked' ? 'badge-blocked' : 'badge-active'}">
                                ${user.status === 'blocked' ? '🚫 Bloqué' : '✅ Actif'}
                            </span>
                        </span>
                    </div>

                    ${user.lastActions && user.lastActions.length > 0 ? `
                        <div style="margin-top: 24px; padding-top: 20px; border-top: 2px solid #e2e8f0;">
                            <h3 style="color: #1a202c; font-size: 16px; font-weight: 600; margin-bottom: 12px;">
                                📋 20 Dernières Actions (Documents)
                            </h3>
                            <div class="actions-list">
                                ${user.lastActions.map(action => `
                                    <div class="action-item">
                                        <div class="action-type">${formatActionType(action.action)}</div>
                                        <div class="action-details">
                                            📅 ${formatServerDate(action.timestamp)}
                                            ${action.ip ? ` • 🌐 ${action.ip}` : ''}
                                        </div>
                                        ${action.documentId ? `
                                            <div class="action-doc">
                                                📄 Document: ${action.documentTitle || 'Sans titre'}
                                                <br>🆔 ${action.documentId}
                                                ${action.action === 'DOCUMENT_SHARED' && action.sharedWith && action.sharedWith.length > 0 ? `
                                                    <br>👥 Partagé avec: ${action.sharedWith.join(', ')}
                                                ` : ''}
                                            </div>
                                        ` : ''}
                                    </div>
                                `).join('')}
                            </div>
                        </div>
                    ` : '<p style="color: #a0aec0; margin-top: 20px; text-align: center;">Aucune action sur les documents</p>'}
                </div>
                <div class="modal-actions">
                    <button class="btn-modal btn-secondary" onclick="closeUserDetailsModal()">
                        Fermer
                    </button>
                </div>
            </div>
        </div>
    `;
}

function renderCreateUserModal() {
    return `
        <div class="modal-overlay" onclick="closeModal(event)">
            <div class="modal-content" onclick="event.stopPropagation()">
                <div class="modal-header">
                    <h2>➕ Créer un utilisateur</h2>
                    <button class="modal-close" onclick="closeCreateUserModal()">✕</button>
                </div>
                <form id="createUserForm" onsubmit="handleCreateUser(event)">
                    <div class="modal-body">
                        <div class="form-group">
                            <label for="newUsername">Nom d'utilisateur *</label>
                            <input type="text" id="newUsername" name="username" required
                                   placeholder="Ex: jdupont">
                        </div>
                        <div class="form-group">
                            <label for="newNom">Nom complet *</label>
                            <input type="text" id="newNom" name="nom" required
                                   placeholder="Ex: Jean Dupont">
                        </div>
                        <div class="form-group">
                            <label for="newEmail">Email *</label>
                            <input type="email" id="newEmail" name="email" required
                                   placeholder="Ex: jean.dupont@cerer.sn">
                        </div>
                        <div class="form-group">
                            <label for="newRole">Rôle *</label>
                            <select id="newRole" name="idRole" required>
                                <option value="">-- Sélectionner un rôle --</option>
                                ${(() => {
                                    // 🛡️ SÉCURITÉ CRITIQUE: Filtrer niveau 0
                                    console.log('🔍 [SUPER ADMIN] Filtrage des rôles pour création utilisateur');
                                    console.log('📋 Rôles disponibles AVANT filtrage:', state.roles);

                                    const rolesFiltered = state.roles.filter(role => {
                                        // Exclure les rôles sans niveau défini (sauf 0)
                                        if (role.niveau === null || role.niveau === undefined) {
                                            console.log('❌ Rôle exclu (niveau undefined):', role);
                                            return false;
                                        }

                                        // INTERDICTION ABSOLUE: Exclure niveau 0
                                        if (role.niveau === 0) {
                                            console.log('🛡️ NIVEAU 0 BLOQUÉ:', role);
                                            return false;
                                        }

                                        // Autoriser uniquement niveaux 1, 2, 3
                                        const isAllowed = role.niveau >= 1 && role.niveau <= 3;
                                        console.log(isAllowed ? '✅' : '❌', 'Rôle:', role.nom, '- Niveau:', role.niveau);
                                        return isAllowed;
                                    });

                                    console.log('✅ Rôles disponibles APRÈS filtrage:', rolesFiltered);
                                    console.log(`📊 Total: ${rolesFiltered.length} rôles (niveaux 1, 2, 3 uniquement)`);

                                    return rolesFiltered.map(role => `
                                        <option value="${role._id}">${role.nom} (Niveau ${role.niveau})</option>
                                    `).join('');
                                })()}
                            </select>
                            <p style="margin-top: 8px; font-size: 12px; color: #059669; background: #d1fae5; padding: 8px; border-radius: 6px; border-left: 3px solid #059669;">
                                🛡️ <strong>Sécurité:</strong> Les Super Admins (niveau 0) ne peuvent être créés que via le script dédié: <code>npm run create-superadmin</code>
                            </p>
                        </div>
                        <div class="form-group">
                            <label for="newDepartement">Département *</label>
                            <select id="newDepartement" name="idDepartement" required>
                                <option value="">-- Sélectionnez un département --</option>
                                ${state.departements.map(dept => `
                                    <option value="${dept._id}">${dept.nom}</option>
                                `).join('')}
                            </select>
                        </div>
                        <div style="background: #fef3c7; padding: 12px; border-radius: 8px; border-left: 3px solid #f59e0b;">
                            <p style="margin: 0; font-size: 13px; color: #92400e;">
                                ℹ️ Le mot de passe par défaut sera <strong>1234</strong>.
                                L'utilisateur devra le changer à sa première connexion.
                            </p>
                        </div>
                    </div>
                    <div class="modal-actions">
                        <button type="button" class="btn-modal btn-secondary" onclick="closeCreateUserModal()">
                            Annuler
                        </button>
                        <button type="submit" class="btn-modal btn-primary">
                            ✓ Créer l'utilisateur
                        </button>
                    </div>
                </form>
            </div>
        </div>
    `;
}

function renderBlockConfirmModal() {
    const user = state.selectedUser;
    if (!user) return '';

    return `
        <div class="modal-overlay" onclick="closeModal(event)">
            <div class="modal-content" onclick="event.stopPropagation()">
                <div class="modal-header">
                    <h2>🚫 Bloquer l'utilisateur</h2>
                    <button class="modal-close" onclick="closeBlockModal()">✕</button>
                </div>
                <form id="blockUserForm" onsubmit="handleBlockUser(event)">
                    <div class="modal-body">
                        <p style="color: #4a5568; margin-bottom: 20px;">
                            Vous êtes sur le point de bloquer <strong>${user.nom}</strong> (@${user.username}).
                        </p>
                        <div class="form-group">
                            <label for="blockReason">Raison du blocage *</label>
                            <textarea id="blockReason" name="reason" required
                                      placeholder="Ex: Violation des règles d'utilisation, compte inactif, etc."></textarea>
                        </div>
                        <div style="background: #fef2f2; padding: 12px; border-radius: 8px; border-left: 3px solid #ef4444;">
                            <p style="margin: 0; font-size: 13px; color: #991b1b;">
                                ⚠️ L'utilisateur ne pourra plus se connecter tant que son compte est bloqué.
                            </p>
                        </div>
                    </div>
                    <div class="modal-actions">
                        <button type="button" class="btn-modal btn-secondary" onclick="closeBlockModal()">
                            Annuler
                        </button>
                        <button type="submit" class="btn-modal btn-danger">
                            🚫 Bloquer
                        </button>
                    </div>
                </form>
            </div>
        </div>
    `;
}

function renderDeleteConfirmModal() {
    const user = state.selectedUser;
    if (!user) return '';

    return `
        <div class="modal-overlay" onclick="closeModal(event)">
            <div class="modal-content" onclick="event.stopPropagation()">
                <div class="modal-header">
                    <h2>🗑️ Supprimer l'utilisateur</h2>
                    <button class="modal-close" onclick="closeDeleteModal()">✕</button>
                </div>
                <div class="modal-body">
                    <div style="background: #fef2f2; padding: 20px; border-radius: 8px; border: 2px solid #ef4444; margin-bottom: 20px;">
                        <p style="margin: 0 0 12px 0; font-size: 16px; font-weight: 700; color: #991b1b;">
                            ⚠️ ATTENTION - Action irréversible !
                        </p>
                        <p style="margin: 0; font-size: 14px; color: #7f1d1d;">
                            Vous êtes sur le point de supprimer définitivement l'utilisateur :
                        </p>
                    </div>
                    <div style="background: #f7fafc; padding: 16px; border-radius: 8px; margin-bottom: 20px;">
                        <p style="margin: 0 0 8px 0; font-size: 15px; font-weight: 600; color: #1a202c;">
                            ${user.nom}
                        </p>
                        <p style="margin: 0; font-size: 13px; color: #718096;">
                            @${user.username} • ${user.email}
                        </p>
                    </div>
                    <p style="color: #4a5568; font-size: 14px;">
                        Cette action supprimera toutes les données de l'utilisateur.
                        Êtes-vous absolument certain de vouloir continuer ?
                    </p>
                </div>
                <div class="modal-actions">
                    <button type="button" class="btn-modal btn-secondary" onclick="closeDeleteModal()">
                        Annuler
                    </button>
                    <button type="button" class="btn-modal btn-danger" onclick="deleteUserConfirmed()">
                        🗑️ Oui, supprimer définitivement
                    </button>
                </div>
            </div>
        </div>
    `;
}

// Utilitaires
function formatActionType(action) {
    const labels = {
        'DOCUMENT_ARCHIVED': '📦 Archivage',
        'DOCUMENT_DELETED': '🗑️ Suppression',
        'DOCUMENT_SHARED': '📤 Partage',
        'DOCUMENT_DOWNLOADED': '⬇️ Téléchargement',
        'DOCUMENT_VIEWED': '👁️ Prévisualisation',
        'DOCUMENT_VERROUILLE': '🔒 Verrouillage',
        'DOCUMENT_DEVERROUILLE': '🔓 Déverrouillage'
    };
    return labels[action] || action;
}

function closeModal(event) {
    if (event.target.classList.contains('modal-overlay')) {
        closeAllModals();
    }
}

function closeAllModals() {
    state.showUserDetails = false;
    state.showCreateUser = false;
    state.showBlockConfirm = false;
    state.showDeleteConfirm = false;
    renderUsersModule();
}

function closeUserDetailsModal() {
    state.showUserDetails = false;
    renderUsersModule();
}

function closeCreateUserModal() {
    state.showCreateUser = false;
    renderUsersModule();
}

function closeBlockModal() {
    state.showBlockConfirm = false;
    state.selectedUser = null;
    renderUsersModule();
}

function closeDeleteModal() {
    state.showDeleteConfirm = false;
    state.selectedUser = null;
    renderUsersModule();
}

// Voir détails
async function viewUserDetails(username) {
    state.selectedUser = state.users.find(u => u.username === username);
    if (!state.selectedUser) return;

    state.showUserDetails = true;
    renderUsersModule();
}

// Bloquer
function confirmBlockUser(username) {
    state.selectedUser = state.users.find(u => u.username === username);
    state.showBlockConfirm = true;
    renderUsersModule();
}

async function handleBlockUser(event) {
    event.preventDefault();
    const formData = new FormData(event.target);
    const reason = formData.get('reason');

    try {
        const response = await fetch(`/api/superadmin/users/${state.selectedUser.username}/block`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ reason })
        });

        const data = await response.json();

        if (data.success) {
            closeBlockModal();
            await loadUsers();
            renderUsersModule();
            showSuccess(data.message);
        } else {
            showError(data.message);
        }
    } catch (error) {
        console.error('Erreur blocage:', error);
        showError('Erreur lors du blocage');
    }
}

// Débloquer
async function confirmUnblockUser(username) {
    try {
        const response = await fetch(`/api/superadmin/users/${username}/unblock`, {
            method: 'POST',
            credentials: 'include'
        });

        const data = await response.json();

        if (data.success) {
            await loadUsers();
            renderUsersModule();
            showSuccess(data.message);
        } else {
            showError(data.message);
        }
    } catch (error) {
        console.error('Erreur déblocage:', error);
        showError('Erreur lors du déblocage');
    }
}

// Supprimer
function confirmDeleteUser(username) {
    state.selectedUser = state.users.find(u => u.username === username);
    state.showDeleteConfirm = true;
    renderUsersModule();
}

async function deleteUserConfirmed() {
    try {
        const response = await fetch(`/api/superadmin/users/${state.selectedUser.username}`, {
            method: 'DELETE',
            credentials: 'include'
        });

        const data = await response.json();

        if (data.success) {
            closeDeleteModal();
            await loadUsers();
            renderUsersModule();
            showSuccess(data.message);
        } else {
            showError(data.message);
        }
    } catch (error) {
        console.error('Erreur suppression:', error);
        showError('Erreur lors de la suppression');
    }
}

// Créer
function showCreateUserModal() {
    state.showCreateUser = true;
    renderUsersModule();
}

async function handleCreateUser(event) {
    event.preventDefault();
    const formData = new FormData(event.target);

    const userData = {
        username: formData.get('username'),
        nom: formData.get('nom'),
        email: formData.get('email'),
        idRole: formData.get('idRole'),
        idDepartement: formData.get('idDepartement') || null
    };

    try {
        const response = await fetch('/api/superadmin/users', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify(userData)
        });

        const data = await response.json();

        if (data.success) {
            closeCreateUserModal();
            await loadUsers();
            renderUsersModule();
            showSuccess(`Utilisateur créé avec succès ! Mot de passe par défaut : ${data.data.defaultPassword}`);
        } else {
            showError(data.message);
        }
    } catch (error) {
        console.error('Erreur création:', error);
        showError('Erreur lors de la création');
    }
}

// ============================================
// MODULE DOCUMENTS
// ============================================

/**
 * Charger le module documents
 */
async function loadDocumentsModule() {
    try {
        console.log('📄 Chargement module documents...');

        // Construire les paramètres de période
        const params = new URLSearchParams();
        params.set('period', state.documentsPeriod);

        if (state.documentsPeriod === 'custom') {
            if (state.documentsCustomStartDate) params.set('startDate', state.documentsCustomStartDate);
            if (state.documentsCustomEndDate) params.set('endDate', state.documentsCustomEndDate);
        }

        // Charger toutes les données en parallèle
        const [
            statsRes,
            activityRes,
            sharedRes,
            downloadedRes,
            level1Res,
            deletedRes,
            lockedRes
        ] = await Promise.all([
            fetch(`/api/superadmin/documents/stats?${params}`, { credentials: 'include' }),
            fetch(`/api/superadmin/documents/activity?${params}`, { credentials: 'include' }),
            fetch(`/api/superadmin/documents/most-shared?${params}`, { credentials: 'include' }),
            fetch(`/api/superadmin/documents/most-downloaded?${params}`, { credentials: 'include' }),
            fetch(`/api/superadmin/documents/level1-deletions?${params}`, { credentials: 'include' }),
            fetch(`/api/superadmin/documents/deleted?${params}&page=${state.deletedPagination.page}`, { credentials: 'include' }),
            fetch(`/api/superadmin/documents/locked?${params}&page=${state.lockedPagination.page}`, { credentials: 'include' })
        ]);

        // Parser les réponses
        const statsData = await statsRes.json();
        const activityData = await activityRes.json();
        const sharedData = await sharedRes.json();
        const downloadedData = await downloadedRes.json();
        const level1Data = await level1Res.json();
        const deletedData = await deletedRes.json();
        const lockedData = await lockedRes.json();

        // Mettre à jour le state
        if (statsData.success) state.documentsStats = statsData.data;
        if (activityData.success) state.documentsActivity = activityData.data;
        if (sharedData.success) state.mostShared = sharedData.data;
        if (downloadedData.success) state.mostDownloaded = downloadedData.data;
        if (level1Data.success) state.level1Deletions = level1Data.data;
        if (deletedData.success) {
            state.deletedDocuments = deletedData.data.deletions;
            state.deletedPagination = deletedData.data.pagination;
        }
        if (lockedData.success) {
            state.lockedDocuments = lockedData.data.locked;
            state.lockedPagination = lockedData.data.pagination;
        }

        console.log('✅ Module documents chargé');

        // Render
        renderDocumentsModule();

    } catch (error) {
        console.error('❌ Erreur chargement module documents:', error);
        showError('Erreur lors du chargement du module documents');
    }
}

/**
 * Render du module documents
 */
function renderDocumentsModule() {
    const sectionDocuments = document.getElementById('section-documents');
    if (!sectionDocuments) return;

    sectionDocuments.innerHTML = `
        <div class="documents-module">
            <h2 style="margin-bottom: 20px;">📄 Gestion des Documents</h2>

            ${renderDocumentsSubTabs()}
            ${renderPeriodFilter()}
            ${renderDocumentsSubTabContent()}
        </div>

        ${state.showRestoreConfirm ? renderRestoreConfirmModal() : ''}
    `;
}

/**
 * Render des sous-onglets du module documents
 */
function renderDocumentsSubTabs() {
    return `
        <div class="sub-tabs">
            <button class="sub-tab ${state.documentsSubTab === 'overview' ? 'active' : ''}"
                    onclick="changeDocumentsSubTab('overview')">
                📊 Aperçu
            </button>
            <button class="sub-tab ${state.documentsSubTab === 'all' ? 'active' : ''}"
                    onclick="changeDocumentsSubTab('all')">
                📋 Tous
            </button>
            <button class="sub-tab ${state.documentsSubTab === 'shared' ? 'active' : ''}"
                    onclick="changeDocumentsSubTab('shared')">
                📤 Partagés
            </button>
            <button class="sub-tab ${state.documentsSubTab === 'downloaded' ? 'active' : ''}"
                    onclick="changeDocumentsSubTab('downloaded')">
                📥 Téléchargés
            </button>
            <button class="sub-tab ${state.documentsSubTab === 'deletions' ? 'active' : ''}"
                    onclick="changeDocumentsSubTab('deletions')">
                🗑️ Suppressions
            </button>
            <button class="sub-tab ${state.documentsSubTab === 'locked' ? 'active' : ''}"
                    onclick="changeDocumentsSubTab('locked')">
                🔒 Verrouillés
            </button>
        </div>
    `;
}

/**
 * Changer de sous-onglet
 */
function changeDocumentsSubTab(subTab) {
    state.documentsSubTab = subTab;

    // Si on passe à l'onglet "Tous les documents", charger les données
    if (subTab === 'all') {
        loadAllDocuments();
    } else {
        renderDocumentsModule();
    }
}

/**
 * Render du contenu selon le sous-onglet actif
 */
function renderDocumentsSubTabContent() {
    switch (state.documentsSubTab) {
        case 'overview':
            return `
                ${renderDocumentsActivity()}
                ${renderDocumentsStats()}
                ${renderDocumentsByDepartment()}
            `;

        case 'all':
            return `
                ${renderAllDocuments()}
            `;

        case 'shared':
            return `
                ${renderMostSharedDocuments()}
            `;

        case 'downloaded':
            return `
                ${renderMostDownloadedDocuments()}
            `;

        case 'deletions':
            return `
                ${renderLevel1Deletions()}
                ${renderDeletedDocuments()}
            `;

        case 'locked':
            return `
                ${renderLockedDocuments()}
            `;

        default:
            return '';
    }
}

/**
 * Render du filtre de période
 */
function renderPeriodFilter() {
    return `
        <div class="period-filter">
            <button class="period-btn ${state.documentsPeriod === 'today' ? 'active' : ''}"
                    onclick="changeDocumentsPeriod('today')">
                Aujourd'hui
            </button>
            <button class="period-btn ${state.documentsPeriod === '7days' ? 'active' : ''}"
                    onclick="changeDocumentsPeriod('7days')">
                7 derniers jours
            </button>
            <button class="period-btn ${state.documentsPeriod === '30days' ? 'active' : ''}"
                    onclick="changeDocumentsPeriod('30days')">
                30 derniers jours
            </button>
            <button class="period-btn ${state.documentsPeriod === 'all' ? 'active' : ''}"
                    onclick="changeDocumentsPeriod('all')">
                Tout
            </button>

            <div class="custom-date-range">
                <label style="font-size: 13px; color: #4a5568; font-weight: 600;">Période personnalisée :</label>
                <input type="date"
                       id="custom-start-date"
                       value="${state.documentsCustomStartDate || ''}"
                       onchange="setCustomStartDate(this.value)" />
                <span style="color: #718096;">→</span>
                <input type="date"
                       id="custom-end-date"
                       value="${state.documentsCustomEndDate || ''}"
                       onchange="setCustomEndDate(this.value)" />
                <button class="period-btn apply-custom-period ${state.documentsPeriod === 'custom' ? 'active' : ''}"
                        onclick="applyCustomPeriod()"
                        ${!state.documentsCustomStartDate || !state.documentsCustomEndDate ? 'disabled' : ''}>
                    ✓ Appliquer
                </button>
            </div>
        </div>
    `;
}

function changeDocumentsPeriod(period) {
    state.documentsPeriod = period;

    // Si on est sur l'onglet "Tous les documents", recharger les documents
    if (state.documentsSubTab === 'all') {
        loadAllDocuments();
    }

    loadDocumentsModule();
}

function setCustomStartDate(value) {
    state.documentsCustomStartDate = value;
    // Ne pas recharger automatiquement, attendre le clic sur "Appliquer"
}

function setCustomEndDate(value) {
    state.documentsCustomEndDate = value;
    // Ne pas recharger automatiquement, attendre le clic sur "Appliquer"
}

function applyCustomPeriod() {
    if (state.documentsCustomStartDate && state.documentsCustomEndDate) {
        // Vérifier que la date de début est avant la date de fin
        const start = new Date(state.documentsCustomStartDate);
        const end = new Date(state.documentsCustomEndDate);

        if (start > end) {
            showError('La date de début doit être avant la date de fin');
            return;
        }

        state.documentsPeriod = 'custom';

        // Si on est sur l'onglet "Tous les documents", recharger les documents
        if (state.documentsSubTab === 'all') {
            loadAllDocuments();
        }

        loadDocumentsModule();
    } else {
        showError('Veuillez sélectionner une date de début et une date de fin');
    }
}

/**
 * Render de l'activité globale
 */
function renderDocumentsActivity() {
    if (!state.documentsActivity) return '';

    const { created, deleted, downloaded, shared } = state.documentsActivity;

    return `
        <div class="stats-grid">
            <div class="stat-card success">
                <div class="stat-label">📝 Documents Créés</div>
                <div class="stat-value">${created}</div>
            </div>
            <div class="stat-card danger">
                <div class="stat-label">🗑️ Documents Supprimés</div>
                <div class="stat-value">${deleted}</div>
            </div>
            <div class="stat-card">
                <div class="stat-label">📥 Téléchargements</div>
                <div class="stat-value">${downloaded}</div>
            </div>
            <div class="stat-card warning">
                <div class="stat-label">📤 Partages</div>
                <div class="stat-value">${shared}</div>
            </div>
        </div>
    `;
}

/**
 * Render des stats générales
 */
function renderDocumentsStats() {
    if (!state.documentsStats) return '';

    const { total, locked, shared } = state.documentsStats;

    return `
        <div class="stats-grid" style="margin-top: 16px;">
            <div class="stat-card">
                <div class="stat-label">📄 Total Documents</div>
                <div class="stat-value">${total}</div>
            </div>
            <div class="stat-card warning">
                <div class="stat-label">🔒 Documents Verrouillés</div>
                <div class="stat-value">${locked}</div>
            </div>
            <div class="stat-card success">
                <div class="stat-label">📤 Documents Partagés</div>
                <div class="stat-value">${shared}</div>
            </div>
        </div>
    `;
}

/**
 * Render de la répartition par département
 */
function renderDocumentsByDepartment() {
    if (!state.documentsStats || !state.documentsStats.byDepartment) return '';

    const departments = state.documentsStats.byDepartment;
    if (departments.length === 0) return '';

    const maxCount = Math.max(...departments.map(d => d.count));

    return `
        <div class="chart-container" style="margin-top: 24px;">
            <div class="chart-title">📊 Répartition par Département</div>
            <div class="bar-chart">
                ${departments.map(dept => {
                    const percentage = (dept.count / maxCount) * 100;
                    return `
                        <div class="bar-item">
                            <div class="bar-label">${dept.departement || 'Sans département'}</div>
                            <div class="bar-track">
                                <div class="bar-fill" style="width: ${percentage}%"></div>
                            </div>
                            <div class="bar-value">${dept.count}</div>
                        </div>
                    `;
                }).join('')}
            </div>
        </div>
    `;
}

/**
 * Mettre à jour un filtre de recherche
 */
function updateSearchFilter(section, value) {
    state.searchFilters[section] = value;
    renderDocumentsModule();
}

/**
 * Filtrer une liste de documents par recherche
 */
function filterDocuments(docs, searchTerm) {
    if (!searchTerm) return docs;
    const term = searchTerm.toLowerCase();
    return docs.filter(doc =>
        (doc.titre && doc.titre.toLowerCase().includes(term)) ||
        (doc.idDocument && doc.idDocument.toLowerCase().includes(term)) ||
        (doc.documentId && doc.documentId.toLowerCase().includes(term)) ||
        (doc.categorie && doc.categorie.toLowerCase().includes(term))
    );
}

/**
 * Render des documents les plus partagés
 */
function renderMostSharedDocuments() {
    const filteredDocs = filterDocuments(state.mostShared || [], state.searchFilters.shared);

    return `
        <!-- Barre de recherche -->
        <div style="margin-bottom: 16px;">
            <input type="text"
                   placeholder="🔍 Rechercher un document partagé (titre, ID, catégorie)..."
                   value="${state.searchFilters.shared}"
                   oninput="updateSearchFilter('shared', this.value)"
                   style="width: 100%; padding: 10px 16px; border: 2px solid #e2e8f0; border-radius: 8px; font-size: 14px;">
        </div>

        ${filteredDocs.length === 0 ? `
            <div class="empty-state">
                <div class="empty-state-icon">${state.searchFilters.shared ? '🔍' : '📭'}</div>
                <div class="empty-state-text">${state.searchFilters.shared ? 'Aucun résultat trouvé' : 'Aucun document partagé sur cette période'}</div>
            </div>
        ` : `
        <div style="margin-top: 16px;">
            <table class="documents-table shared-docs-table">
                <thead>
                    <tr>
                        <th style="width: 50px;">#</th>
                        <th>Document</th>
                        <th style="width: 150px;">Partages</th>
                        <th style="width: 100px;">Détails</th>
                    </tr>
                </thead>
                <tbody>
                    ${filteredDocs.map((doc, index) => `
                        <tr>
                            <td>
                                <div style="font-size: 18px; font-weight: 700; color: #667eea;">
                                    #${index + 1}
                                </div>
                            </td>
                            <td>
                                <div style="font-weight: 600; color: #1a202c; margin-bottom: 4px;">
                                    ${doc.titre}
                                </div>
                                <div style="font-size: 12px; color: #718096;">
                                    ${doc.idDocument}
                                </div>
                            </td>
                            <td>
                                <span class="top-doc-count">
                                    ${doc.nombrePartages} partage${doc.nombrePartages > 1 ? 's' : ''}
                                </span>
                            </td>
                            <td>
                                <button class="action-btn btn-view" onclick="toggleShareDetails('share-${index}')">
                                    👁️ Voir
                                </button>
                            </td>
                        </tr>
                        <tr id="share-${index}" class="share-details-row" style="display: none;">
                            <td colspan="4">
                                <div class="share-details-content">
                                    <h4 style="margin-bottom: 12px; color: #1a202c; font-size: 14px; font-weight: 600;">
                                        📋 Historique des partages (${doc.partages ? doc.partages.length : 0})
                                    </h4>
                                    ${doc.partages && doc.partages.length > 0 ? `
                                        <div class="shares-list">
                                            ${doc.partages.map(share => `
                                                <div class="share-item">
                                                    <div class="share-info">
                                                        <span style="color: #667eea; font-weight: 600;">
                                                            ${share.sharedByName || share.sharedBy || 'Inconnu'}
                                                        </span>
                                                        <span style="color: #718096; margin: 0 8px;">→</span>
                                                        <span style="color: #16a34a; font-weight: 600;">
                                                            ${share.sharedWithName || share.sharedWith || 'Inconnu'}
                                                        </span>
                                                    </div>
                                                    <div class="share-date">
                                                        ${share.sharedAt ? formatServerDate(share.sharedAt) : '-'}
                                                    </div>
                                                </div>
                                            `).join('')}
                                        </div>
                                    ` : '<p style="color: #718096; font-style: italic;">Aucun détail disponible</p>'}
                                </div>
                            </td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
        `}
    `;
}

function toggleShareDetails(rowId) {
    const row = document.getElementById(rowId);
    if (row) {
        row.style.display = row.style.display === 'none' ? 'table-row' : 'none';
    }
}

/**
 * Render des documents les plus téléchargés
 */
function renderMostDownloadedDocuments() {
    const filteredDocs = filterDocuments(state.mostDownloaded || [], state.searchFilters.downloaded);

    return `
        <!-- Barre de recherche -->
        <div style="margin-bottom: 16px;">
            <input type="text"
                   placeholder="🔍 Rechercher un document téléchargé (titre, ID, catégorie)..."
                   value="${state.searchFilters.downloaded}"
                   oninput="updateSearchFilter('downloaded', this.value)"
                   style="width: 100%; padding: 10px 16px; border: 2px solid #e2e8f0; border-radius: 8px; font-size: 14px;">
        </div>

        ${filteredDocs.length === 0 ? `
            <div class="empty-state">
                <div class="empty-state-icon">${state.searchFilters.downloaded ? '🔍' : '📭'}</div>
                <div class="empty-state-text">${state.searchFilters.downloaded ? 'Aucun résultat trouvé' : 'Aucun téléchargement sur cette période'}</div>
            </div>
        ` : `
        <table class="documents-table shared-docs-table">
            <thead>
                <tr>
                    <th>#</th>
                    <th>Document</th>
                    <th>Téléchargements</th>
                    <th>Détails</th>
                </tr>
            </thead>
            <tbody>
                ${filteredDocs.map((doc, index) => `
                    <tr>
                        <td style="font-weight: 700; color: #16a34a;">#${index + 1}</td>
                        <td>
                            <div style="font-weight: 600; color: #1a202c;">${doc.titre}</div>
                            <div style="font-size: 12px; color: #718096;">${doc.idDocument}</div>
                        </td>
                        <td>
                            <span style="display: inline-block; padding: 6px 12px; background: linear-gradient(135deg, #16a34a 0%, #059669 100%); color: white; border-radius: 12px; font-weight: 700; font-size: 14px;">
                                ${doc.nombreTelechargements} téléchargement${doc.nombreTelechargements > 1 ? 's' : ''}
                            </span>
                        </td>
                        <td>
                            <button class="action-btn btn-view" onclick="toggleDownloadDetails('download-${index}')" style="padding: 6px 12px; background: #667eea; color: white; border: none; border-radius: 6px; cursor: pointer; font-size: 13px;">
                                👁️ Voir
                            </button>
                        </td>
                    </tr>
                    <tr id="download-${index}" class="share-details-row" style="display: none;">
                        <td colspan="4">
                            <div class="share-details-content">
                                <h4 style="margin: 0 0 12px 0; color: #1a202c; font-size: 14px;">📥 Historique des téléchargements :</h4>
                                ${doc.telechargements && doc.telechargements.length > 0 ?
                                    doc.telechargements.map(dl => `
                                        <div class="share-item" style="border-left-color: #16a34a;">
                                            <span style="font-weight: 600; color: #1a202c;">${dl.nomComplet || dl.utilisateur}</span>
                                            <span style="color: #718096; font-size: 12px;">@${dl.utilisateur}</span>
                                            <div style="margin-left: auto; font-size: 12px; color: #718096;">
                                                ${formatServerDate(dl.date)}
                                            </div>
                                        </div>
                                    `).join('')
                                : '<p style="color: #718096; font-style: italic;">Aucun détail disponible</p>'}
                            </div>
                        </td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
        `}
    `;
}

/**
 * Afficher/Masquer les détails de téléchargement
 */
function toggleDownloadDetails(rowId) {
    const row = document.getElementById(rowId);
    if (row) {
        row.style.display = row.style.display === 'none' ? 'table-row' : 'none';
    }
}

/**
 * Render des admins ayant supprimé des documents (VERSION ACCORDÉON COMPACTE)
 */
function renderLevel1Deletions() {
    if (!state.level1Deletions || state.level1Deletions.length === 0) {
        return `
            <div style="margin-top: 16px; margin-bottom: 32px;">
                <h3 style="font-size: 14px; font-weight: 600; color: #1a202c; margin-bottom: 12px;">
                    👨‍💼 Admins (Niveau 1) ayant Supprimé
                </h3>
                <div class="empty-state">
                    <div class="empty-state-icon">✅</div>
                    <div class="empty-state-text">Aucune suppression par des admins sur cette période</div>
                </div>
            </div>
        `;
    }

    return `
        <div style="margin-top: 16px; margin-bottom: 32px;">
            <h3 style="font-size: 14px; font-weight: 600; color: #1a202c; margin-bottom: 12px;">
                👨‍💼 Admins (Niveau 1) ayant Supprimé
            </h3>
            <div style="display: flex; flex-direction: column; gap: 8px;">
                ${state.level1Deletions.map(admin => {
                    const isExpanded = state.expandedAdmin === admin.username;
                    return `
                        <div style="border: 2px solid ${isExpanded ? '#667eea' : '#e2e8f0'}; border-radius: 8px; overflow: hidden; transition: all 0.2s;">
                            <!-- En-tête cliquable de l'admin -->
                            <div onclick="toggleAdminDeletions('${admin.username}')"
                                 style="padding: 12px 16px; background: ${isExpanded ? 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)' : '#f7fafc'}; cursor: pointer; display: flex; align-items: center; justify-content: space-between; transition: all 0.2s;">
                                <div style="display: flex; align-items: center; gap: 12px; flex: 1;">
                                    <div style="font-size: 24px;">${isExpanded ? '📂' : '📁'}</div>
                                    <div style="flex: 1;">
                                        <div style="font-weight: 700; font-size: 14px; color: ${isExpanded ? 'white' : '#1a202c'};">
                                            ${admin.nom}
                                        </div>
                                        <div style="font-size: 11px; color: ${isExpanded ? 'rgba(255,255,255,0.9)' : '#718096'};">
                                            @${admin.username} • ${admin.email}
                                        </div>
                                    </div>
                                    <div style="display: flex; align-items: center; gap: 8px;">
                                        <span style="background: ${isExpanded ? 'rgba(255,255,255,0.2)' : '#fef2f2'}; color: ${isExpanded ? 'white' : '#991b1b'}; padding: 6px 12px; border-radius: 20px; font-weight: 700; font-size: 12px;">
                                            🗑️ ${admin.nombreSuppressions}
                                        </span>
                                        <span style="font-size: 16px; transition: transform 0.2s; ${isExpanded ? 'transform: rotate(90deg);' : ''}">
                                            ▶
                                        </span>
                                    </div>
                                </div>
                            </div>

                            <!-- Liste des documents supprimés (affichée si expanded) -->
                            ${isExpanded ? `
                                <div style="padding: 16px; background: white; border-top: 2px solid #667eea;">
                                    ${renderAdminDeletedDocuments(admin.username)}
                                </div>
                            ` : ''}
                        </div>
                    `;
                }).join('')}
            </div>
        </div>
    `;
}

/**
 * Render des documents supprimés par un admin spécifique
 */
function renderAdminDeletedDocuments(username) {
    if (!state.adminDeletedDocs || state.adminDeletedDocs.length === 0) {
        return `
            <div style="text-align: center; padding: 20px; color: #718096;">
                ⏳ Chargement des documents...
            </div>
        `;
    }

    return `
        <table class="documents-table" style="margin: 0;">
            <thead>
                <tr style="background: #f7fafc;">
                    <th style="font-size: 11px; padding: 8px;">ID Document</th>
                    <th style="font-size: 11px; padding: 8px;">Titre</th>
                    <th style="font-size: 11px; padding: 8px;">Date Suppression</th>
                    <th style="font-size: 11px; padding: 8px;">IP</th>
                </tr>
            </thead>
            <tbody>
                ${state.adminDeletedDocs.map(doc => `
                    <tr style="font-size: 12px;">
                        <td style="padding: 8px;"><code style="font-size: 10px; background: #f0f0f0; padding: 2px 6px; border-radius: 4px;">${doc.documentId}</code></td>
                        <td style="padding: 8px;"><strong>${doc.titre}</strong></td>
                        <td style="padding: 8px; white-space: nowrap;">${formatServerDate(doc.dateSuppression)}</td>
                        <td style="padding: 8px;"><small style="color: #718096;">${doc.ip}</small></td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
        ${state.adminDeletedDocs.length === 0 ? `
            <div style="text-align: center; padding: 20px; color: #718096;">
                Aucun document trouvé
            </div>
        ` : ''}
    `;
}

/**
 * Toggle l'affichage des documents supprimés d'un admin
 */
async function toggleAdminDeletions(username) {
    // Si on clique sur l'admin déjà ouvert, on le ferme
    if (state.expandedAdmin === username) {
        state.expandedAdmin = null;
        state.adminDeletedDocs = [];
        renderDocumentsModule();
        return;
    }

    // Sinon, on ouvre le nouvel admin
    state.expandedAdmin = username;
    state.adminDeletedDocs = []; // Reset pendant le chargement
    renderDocumentsModule();

    // Charger les documents supprimés par cet admin
    await loadAdminDeletedDocuments(username);
}

/**
 * Charger les documents supprimés par un admin spécifique
 */
async function loadAdminDeletedDocuments(username) {
    try {
        const { documentsPeriod, documentsCustomStartDate, documentsCustomEndDate } = state;

        const params = new URLSearchParams({
            period: documentsPeriod,
            username: username,
            limit: 100 // Limite pour ne pas surcharger
        });

        if (documentsPeriod === 'custom' && documentsCustomStartDate && documentsCustomEndDate) {
            params.append('startDate', documentsCustomStartDate);
            params.append('endDate', documentsCustomEndDate);
        }

        const response = await fetch(`/api/superadmin/documents/deleted?${params}`, {
            credentials: 'include'
        });

        const result = await response.json();

        if (result.success) {
            // Filtrer pour ne garder que les documents de cet admin
            state.adminDeletedDocs = result.data.deletions.filter(doc => doc.supprimePar === username);
            renderDocumentsModule();
        } else {
            console.error('Erreur chargement documents supprimés:', result.message);
            state.adminDeletedDocs = [];
            renderDocumentsModule();
        }
    } catch (error) {
        console.error('❌ Erreur loadAdminDeletedDocuments:', error);
        state.adminDeletedDocs = [];
        renderDocumentsModule();
    }
}

/**
 * Render des documents supprimés
 */
function renderDeletedDocuments() {
    const filteredDocs = filterDocuments(state.deletedDocuments || [], state.searchFilters.deleted);

    return `
        <div style="margin-top: 16px;">
            <h3 style="font-size: 14px; font-weight: 600; color: #1a202c; margin-bottom: 12px;">
                🗑️ Corbeille - Documents Supprimés
            </h3>

            <!-- Barre de recherche -->
            <div style="margin-bottom: 16px;">
                <input type="text"
                       placeholder="🔍 Rechercher un document supprimé (titre, ID, motif)..."
                       value="${state.searchFilters.deleted}"
                       oninput="updateSearchFilter('deleted', this.value)"
                       style="width: 100%; padding: 10px 16px; border: 2px solid #e2e8f0; border-radius: 8px; font-size: 14px;">
            </div>

            ${filteredDocs.length === 0 ? `
                <div class="empty-state">
                    <div class="empty-state-icon">${state.searchFilters.deleted ? '🔍' : '✅'}</div>
                    <div class="empty-state-text">${state.searchFilters.deleted ? 'Aucun résultat trouvé' : 'Aucun document supprimé sur cette période'}</div>
                </div>
            ` : `
            <table class="documents-table" style="font-size: 13px;">
                <thead>
                    <tr>
                        <th>Statut</th>
                        <th>ID</th>
                        <th>Titre</th>
                        <th>Motif</th>
                        <th>Département</th>
                        <th>Service</th>
                        <th>Supprimé Par</th>
                        <th>Date</th>
                        <th>Expire le</th>
                        <th>Actions</th>
                    </tr>
                </thead>
                <tbody>
                    ${filteredDocs.map(doc => {
                        const isRecoverable = doc.isRecoverable;
                        const daysLeft = Math.floor(doc.daysUntilExpiration || 0);

                        return `
                        <tr style="background-color: ${isRecoverable ? '#f0fdf4' : '#fef2f2'};">
                            <td>
                                ${isRecoverable ? `
                                    <span style="display: inline-block; padding: 4px 8px; background: #10b981; color: white; border-radius: 12px; font-size: 11px; font-weight: 600;">
                                        ♻️ ${daysLeft}j restant${daysLeft > 1 ? 's' : ''}
                                    </span>
                                ` : `
                                    <span style="display: inline-block; padding: 4px 8px; background: #ef4444; color: white; border-radius: 12px; font-size: 11px; font-weight: 600;">
                                        ⚠️ Expiré
                                    </span>
                                `}
                            </td>
                            <td><code style="font-size: 11px;">${doc.documentId}</code></td>
                            <td><strong>${doc.titre}</strong></td>
                            <td title="${doc.motif || 'Non spécifié'}" style="max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                                ${doc.motif || 'Non spécifié'}
                            </td>
                            <td>${doc.departement || '-'}</td>
                            <td>${doc.service || '-'}</td>
                            <td>
                                ${doc.nomComplet || doc.supprimePar}<br>
                                <small style="color: #718096;">${doc.email || ''}</small>
                            </td>
                            <td>${formatServerDate(doc.dateSuppression)}</td>
                            <td>${formatServerDate(doc.expiresAt)}</td>
                            <td>
                                ${isRecoverable ? `
                                    <button onclick="confirmRestoreDocument('${doc._id}', '${doc.titre.replace(/'/g, "\\'")}', '${doc.documentId}')"
                                            style="padding: 6px 12px; background: #10b981; color: white; border: none; border-radius: 6px; cursor: pointer; font-size: 12px; font-weight: 600;">
                                        ♻️ Récupérer
                                    </button>
                                ` : `
                                    <span style="color: #9ca3af; font-size: 12px;">Non récupérable</span>
                                `}
                            </td>
                        </tr>
                    `}).join('')}
                </tbody>
            </table>
            `}
        </div>
    `;
}

function renderDeletedPagination() {
    const { page, totalPages } = state.deletedPagination;
    if (totalPages <= 1) return '';

    return `
        <div class="pagination">
            <button ${page === 1 ? 'disabled' : ''} onclick="goToDeletedPage(${page - 1})">
                ◀ Précédent
            </button>
            <span class="page-number">Page ${page} sur ${totalPages}</span>
            <button ${page === totalPages ? 'disabled' : ''} onclick="goToDeletedPage(${page + 1})">
                Suivant ▶
            </button>
        </div>
    `;
}

function goToDeletedPage(page) {
    state.deletedPagination.page = page;
    loadDocumentsModule();
}

/**
 * Fonctions de restauration de documents
 */
function confirmRestoreDocument(docId, titre, documentId) {
    state.documentToRestore = { _id: docId, titre, documentId };
    state.showRestoreConfirm = true;
    renderDocumentsModule();
}

function cancelRestore() {
    state.showRestoreConfirm = false;
    state.documentToRestore = null;
    renderDocumentsModule();
}

async function restoreDocument() {
    if (!state.documentToRestore) return;

    state.restoringDocument = true;
    renderDocumentsModule();

    try {
        const response = await fetch(`/api/superadmin/documents/${state.documentToRestore._id}/restore`, {
            method: 'POST',
            credentials: 'include',
            headers: {
                'Content-Type': 'application/json'
            }
        });

        const result = await response.json();

        if (result.success) {
            // Retirer le document restauré de la liste immédiatement (mise à jour optimiste)
            const docId = state.documentToRestore._id;
            state.documentToRestore = null;

            // Supprimer le document de TOUTES les listes de documents supprimés
            state.deletedDocuments = state.deletedDocuments.filter(doc => doc._id !== docId);
            state.adminDeletedDocs = state.adminDeletedDocs.filter(doc => doc._id !== docId);

            // Afficher la notification APRÈS avoir mis à jour les listes
            showNotification('✅ Document restauré avec succès !', 'success');
            state.showRestoreConfirm = false;

            // Recharger en arrière-plan après 3 secondes (quand la notification aura disparu)
            setTimeout(() => {
                loadDocumentsModule().catch(err => {
                    console.error('Erreur rechargement silencieux:', err);
                });
            }, 3500);
        } else {
            showNotification('❌ ' + (result.message || 'Erreur lors de la restauration'), 'error');
        }
    } catch (error) {
        console.error('Erreur restauration:', error);
        showNotification('❌ Erreur de connexion au serveur', 'error');
    } finally {
        state.restoringDocument = false;
        renderDocumentsModule();
    }
}

function renderRestoreConfirmModal() {
    if (!state.showRestoreConfirm || !state.documentToRestore) return '';

    return `
        <div class="modal-overlay" onclick="cancelRestore()" style="display: flex; position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0, 0, 0, 0.5); align-items: center; justify-content: center; z-index: 9999;">
            <div class="modal-content" onclick="event.stopPropagation()" style="background: white; border-radius: 16px; padding: 32px; max-width: 500px; width: 90%; box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);">
                <div style="text-align: center; margin-bottom: 24px;">
                    <div style="font-size: 64px; margin-bottom: 16px;">♻️</div>
                    <h2 style="font-size: 24px; font-weight: 700; color: #1a202c; margin-bottom: 8px;">
                        Restaurer ce document ?
                    </h2>
                    <p style="color: #718096; font-size: 14px; margin-bottom: 16px;">
                        Le document sera récupéré et redeviendra accessible aux utilisateurs.
                    </p>
                    <div style="background: #f7fafc; padding: 16px; border-radius: 8px; text-align: left;">
                        <div style="margin-bottom: 8px;">
                            <strong style="color: #4a5568;">Titre:</strong><br>
                            <span style="color: #1a202c;">${state.documentToRestore.titre}</span>
                        </div>
                        <div>
                            <strong style="color: #4a5568;">ID:</strong><br>
                            <code style="background: #e2e8f0; padding: 2px 6px; border-radius: 4px; font-size: 12px;">${state.documentToRestore.documentId}</code>
                        </div>
                    </div>
                </div>

                <div style="display: flex; gap: 12px; justify-content: center;">
                    <button onclick="cancelRestore()"
                            style="padding: 12px 24px; background: #e2e8f0; color: #4a5568; border: none; border-radius: 8px; cursor: pointer; font-size: 14px; font-weight: 600;">
                        Annuler
                    </button>
                    <button onclick="restoreDocument()"
                            ${state.restoringDocument ? 'disabled' : ''}
                            style="padding: 12px 24px; background: #10b981; color: white; border: none; border-radius: 8px; cursor: pointer; font-size: 14px; font-weight: 600; ${state.restoringDocument ? 'opacity: 0.6;' : ''}">
                        ${state.restoringDocument ? '⏳ Restauration...' : '♻️ Restaurer'}
                    </button>
                </div>
            </div>
        </div>
    `;
}

/**
 * Render des documents verrouillés
 */
function renderLockedDocuments() {
    const filteredDocs = filterDocuments(state.lockedDocuments || [], state.searchFilters.locked);

    return `
        <!-- Barre de recherche -->
        <div style="margin-bottom: 16px;">
            <input type="text"
                   placeholder="🔍 Rechercher un document verrouillé (titre, ID, catégorie)..."
                   value="${state.searchFilters.locked}"
                   oninput="updateSearchFilter('locked', this.value)"
                   style="width: 100%; padding: 10px 16px; border: 2px solid #e2e8f0; border-radius: 8px; font-size: 14px;">
        </div>

        ${filteredDocs.length === 0 ? `
            <div style="margin-top: 16px;">
                <div class="empty-state">
                    <div class="empty-state-icon">${state.searchFilters.locked ? '🔍' : '🔓'}</div>
                    <div class="empty-state-text">${state.searchFilters.locked ? 'Aucun résultat trouvé' : 'Aucun document verrouillé'}</div>
                </div>
            </div>
        ` : `
        <div style="margin-top: 16px;">
            <table class="documents-table">
                <thead>
                    <tr>
                        <th>ID Document</th>
                        <th>Titre</th>
                        <th>Catégorie</th>
                        <th>Département</th>
                        <th>Verrouillé Par</th>
                        <th>Date Verrouillage</th>
                    </tr>
                </thead>
                <tbody>
                    ${filteredDocs.map(doc => `
                        <tr>
                            <td><code>${doc.idDocument}</code></td>
                            <td><strong>${doc.titre}</strong></td>
                            <td>${doc.categorie}</td>
                            <td>${doc.departement || '-'}</td>
                            <td>
                                ${doc.verrouilleurNom || doc.verrouilléPar}<br>
                                <small style="color: #718096;">@${doc.verrouilléPar}</small>
                            </td>
                            <td>${formatServerDate(doc.dateVerrouillage)}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
            `}
    `;
}

function renderLockedPagination() {
    const { page, totalPages } = state.lockedPagination;
    if (totalPages <= 1) return '';

    return `
        <div class="pagination">
            <button ${page === 1 ? 'disabled' : ''} onclick="goToLockedPage(${page - 1})">
                ◀ Précédent
            </button>
            <span class="page-number">Page ${page} sur ${totalPages}</span>
            <button ${page === totalPages ? 'disabled' : ''} onclick="goToLockedPage(${page + 1})">
                Suivant ▶
            </button>
        </div>
    `;
}

function goToLockedPage(page) {
    state.lockedPagination.page = page;
    loadDocumentsModule();
}

/**
 * Render de tous les documents avec pagination
 */
function renderAllDocuments() {
    if (!state.allDocuments || state.allDocuments.length === 0) {
        return `
            <div class="empty-state">
                <div class="empty-state-icon">📭</div>
                <div class="empty-state-text">Aucun document trouvé</div>
            </div>
        `;
    }

    return `
        <div style="margin-top: 16px;">
            <!-- Barre de recherche -->
            <div class="filters-bar" style="margin-bottom: 20px;">
                <input type="text"
                       placeholder="🔍 Rechercher un document (titre, ID, catégorie)..."
                       value="${state.allDocsSearch}"
                       onchange="setAllDocsSearch(this.value)"
                       onkeyup="if(event.key === 'Enter') loadAllDocuments()" />
                <button class="action-btn btn-view" onclick="loadAllDocuments()" style="padding: 10px 20px;">
                    🔍 Rechercher
                </button>
                ${state.allDocsSearch ? `
                    <button class="action-btn btn-delete" onclick="clearAllDocsSearch()" style="padding: 10px 20px;">
                        ✖️ Effacer
                    </button>
                ` : ''}
            </div>

            <!-- Statistiques -->
            <div class="stats-bar" style="margin-bottom: 20px;">
                <span class="stat-item">
                    📄 Total: <strong>${state.allDocsPagination.total}</strong>
                </span>
                <span class="stat-item">
                    📑 Page ${state.allDocsPagination.page} / ${state.allDocsPagination.totalPages}
                </span>
            </div>

            <!-- Table des documents -->
            <table class="documents-table">
                <thead>
                    <tr>
                        <th>ID Document</th>
                        <th>Titre</th>
                        <th>Catégorie</th>
                        <th>Département</th>
                        <th>Créé par</th>
                        <th>Date de création</th>
                        <th>Statut</th>
                        <th>Partages</th>
                        <th>Téléchargements</th>
                    </tr>
                </thead>
                <tbody>
                    ${state.allDocuments.map(doc => `
                        <tr>
                            <td><code style="font-size: 11px; background: #f0f0f0; padding: 2px 6px; border-radius: 4px;">${doc.idDocument}</code></td>
                            <td><strong>${doc.titre}</strong></td>
                            <td>${doc.categorie || '-'}</td>
                            <td>
                                ${doc.departement ? `
                                    <span style="background: #dbeafe; color: #1e40af; padding: 4px 8px; border-radius: 4px; font-size: 12px; font-weight: 600;">
                                        ${doc.departementCode || doc.departement}
                                    </span>
                                ` : '-'}
                            </td>
                            <td>
                                ${doc.creatorName ? `
                                    <div style="font-weight: 600;">${doc.creatorName}</div>
                                    <small style="color: #718096;">@${doc.createdBy}</small>
                                ` : `<span style="color: #718096;">@${doc.createdBy || 'Inconnu'}</span>`}
                            </td>
                            <td style="white-space: nowrap;">
                                <strong style="color: #667eea;">${formatServerDate(doc.createdAt)}</strong>
                            </td>
                            <td>
                                ${doc.locked ? `
                                    <span class="badge-locked">🔒 Verrouillé</span>
                                ` : `
                                    <span style="color: #10b981; font-weight: 600;">✓ Actif</span>
                                `}
                            </td>
                            <td style="text-align: center;">
                                ${doc.shareCount > 0 ? `
                                    <span style="background: #fef3c7; color: #92400e; padding: 4px 8px; border-radius: 12px; font-weight: 700; font-size: 12px;">
                                        ${doc.shareCount}
                                    </span>
                                ` : `<span style="color: #cbd5e0;">-</span>`}
                            </td>
                            <td style="text-align: center;">
                                ${doc.downloadCount > 0 ? `
                                    <span style="background: #d1fae5; color: #065f46; padding: 4px 8px; border-radius: 12px; font-weight: 700; font-size: 12px;">
                                        ${doc.downloadCount}
                                    </span>
                                ` : `<span style="color: #cbd5e0;">-</span>`}
                            </td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
            ${renderAllDocsPagination()}
        </div>
    `;
}

/**
 * Render de la pagination pour tous les documents
 */
function renderAllDocsPagination() {
    const { page, totalPages } = state.allDocsPagination;
    if (totalPages <= 1) return '';

    return `
        <div class="pagination-container">
            <div class="pagination-info">
                Affichage de ${state.allDocuments.length} documents sur ${state.allDocsPagination.total}
            </div>
            <div class="pagination">
                <button class="pagination-btn" ${page === 1 ? 'disabled' : ''} onclick="goToAllDocsPage(1)">
                    ⏮ Début
                </button>
                <button class="pagination-btn" ${page === 1 ? 'disabled' : ''} onclick="goToAllDocsPage(${page - 1})">
                    ◀ Précédent
                </button>
                ${renderAllDocsPageNumbers()}
                <button class="pagination-btn" ${page === totalPages ? 'disabled' : ''} onclick="goToAllDocsPage(${page + 1})">
                    Suivant ▶
                </button>
                <button class="pagination-btn" ${page === totalPages ? 'disabled' : ''} onclick="goToAllDocsPage(${totalPages})">
                    Fin ⏭
                </button>
            </div>
        </div>
    `;
}

/**
 * Render des numéros de pages pour la pagination
 */
function renderAllDocsPageNumbers() {
    const { page, totalPages } = state.allDocsPagination;
    const pages = [];
    const maxPagesToShow = 5;

    let startPage = Math.max(1, page - Math.floor(maxPagesToShow / 2));
    let endPage = Math.min(totalPages, startPage + maxPagesToShow - 1);

    if (endPage - startPage < maxPagesToShow - 1) {
        startPage = Math.max(1, endPage - maxPagesToShow + 1);
    }

    if (startPage > 1) {
        pages.push(`<span class="pagination-dots">...</span>`);
    }

    for (let i = startPage; i <= endPage; i++) {
        pages.push(`
            <button class="pagination-btn page-btn ${i === page ? 'active' : ''}"
                    onclick="goToAllDocsPage(${i})">
                ${i}
            </button>
        `);
    }

    if (endPage < totalPages) {
        pages.push(`<span class="pagination-dots">...</span>`);
    }

    return pages.join('');
}

/**
 * Naviguer vers une page spécifique
 */
function goToAllDocsPage(page) {
    state.allDocsPagination.page = page;
    loadAllDocuments();
}

/**
 * Définir la recherche
 */
function setAllDocsSearch(value) {
    state.allDocsSearch = value;
}

/**
 * Effacer la recherche
 */
function clearAllDocsSearch() {
    state.allDocsSearch = '';
    state.allDocsPagination.page = 1;
    loadAllDocuments();
}

/**
 * Charger tous les documents depuis l'API
 */
async function loadAllDocuments() {
    try {
        const { page } = state.allDocsPagination;
        const { documentsPeriod, documentsCustomStartDate, documentsCustomEndDate, allDocsSearch } = state;

        const params = new URLSearchParams({
            period: documentsPeriod,
            page,
            limit: 20,
            search: allDocsSearch
        });

        if (documentsPeriod === 'custom' && documentsCustomStartDate && documentsCustomEndDate) {
            params.append('startDate', documentsCustomStartDate);
            params.append('endDate', documentsCustomEndDate);
        }

        const response = await fetch(`/api/superadmin/documents/all?${params}`, {
            credentials: 'include'
        });

        const result = await response.json();

        if (result.success) {
            state.allDocuments = result.data.documents;
            state.allDocsPagination = result.data.pagination;
            renderDocumentsModule();
        } else {
            showError(result.message || 'Erreur lors du chargement des documents');
        }
    } catch (error) {
        console.error('❌ Erreur loadAllDocuments:', error);
        showError('Erreur lors du chargement des documents');
    }
}

// Notifications
function showSuccess(message) {
    const errorDiv = document.getElementById('error');
    errorDiv.textContent = '✅ ' + message;
    errorDiv.style.background = '#d1fae5';
    errorDiv.style.borderColor = '#10b981';
    errorDiv.style.color = '#065f46';
    errorDiv.style.display = 'block';

    setTimeout(() => {
        errorDiv.style.display = 'none';
        errorDiv.style.background = '#fee';
        errorDiv.style.borderColor = '#f88';
        errorDiv.style.color = '#c00';
    }, 5000);
}

// ============================================
// MODULE DÉPARTEMENTS
// ============================================

/**
 * Charger le module départements
 */
async function loadDepartmentsModule() {
    try {
        console.log('🏢 Chargement module départements...');

        const { search, type } = state.departmentsFilters;
        const { page } = state.departmentsPagination;

        const params = new URLSearchParams({ search, type, page });

        const [depsRes, statsRes] = await Promise.all([
            fetch(`/api/superadmin/departments?${params}`, { credentials: 'include' }),
            fetch('/api/superadmin/departments/stats', { credentials: 'include' })
        ]);

        const depsData = await depsRes.json();
        const statsData = await statsRes.json();

        if (depsData.success) {
            state.departmentsData = depsData.data.departments;
            state.departmentsPagination = depsData.data.pagination;
            state.departmentsStats = depsData.data.stats;
        }

        if (statsData.success) {
            state.departmentsStats = { ...state.departmentsStats, ...statsData.data };
        }

        console.log('✅ Module départements chargé');
        renderDepartmentsModule();

    } catch (error) {
        console.error('❌ Erreur chargement module départements:', error);
        showError('Erreur lors du chargement du module départements');
    }
}

/**
 * Render du module départements
 */
function renderDepartmentsModule() {
    const sectionDepartments = document.getElementById('section-departments');
    if (!sectionDepartments) return;

    sectionDepartments.innerHTML = `
        <div class="users-module">
            ${renderDepartmentsStats()}
            ${renderDepartmentsFilters()}
            ${renderDepartmentsTable()}
            ${renderDepartmentsPagination()}
        </div>

        ${state.showCreateDepartment ? renderCreateDepartmentModal() : ''}
        ${state.showEditDepartment ? renderEditDepartmentModal() : ''}
        ${state.showDeleteDepartmentConfirm ? renderDeleteDepartmentModal() : ''}
    `;
}

function renderDepartmentsStats() {
    const { total, main, services } = state.departmentsStats || { total: 0, main: 0, services: 0 };

    return `
        <div class="stats-bar">
            <div class="stat-item">
                🏢 ${total} Total
            </div>
            <div class="stat-item success">
                🏛️ ${main} Départements principaux
            </div>
            <div class="stat-item" style="background: #dbeafe; color: #1e40af;">
                📋 ${services} Services
            </div>
        </div>
    `;
}

function renderDepartmentsFilters() {
    return `
        <div class="filters-bar">
            <input type="text"
                   placeholder="🔍 Rechercher par nom ou code..."
                   value="${state.departmentsFilters.search}"
                   oninput="handleDepartmentSearchChange(this.value)" />

            <select onchange="handleDepartmentTypeFilter(this.value)">
                <option value="all" ${state.departmentsFilters.type === 'all' ? 'selected' : ''}>Tous</option>
                <option value="main" ${state.departmentsFilters.type === 'main' ? 'selected' : ''}>Départements principaux</option>
                <option value="services" ${state.departmentsFilters.type === 'services' ? 'selected' : ''}>Services</option>
            </select>

            <button class="refresh-btn" onclick="showCreateDepartmentModal()">
                ➕ Créer un département
            </button>
        </div>
    `;
}

function renderDepartmentsTable() {
    if (state.departmentsData.length === 0) {
        return '<p style="text-align: center; color: #718096; padding: 40px;">Aucun département trouvé</p>';
    }

    return `
        <table class="users-table">
            <thead>
                <tr>
                    <th>Type</th>
                    <th>Code</th>
                    <th>Nom</th>
                    <th>Département parent</th>
                    <th>Utilisateurs</th>
                    <th>Documents</th>
                    <th>Services</th>
                    <th>Date création</th>
                    <th>Actions</th>
                </tr>
            </thead>
            <tbody>
                ${state.departmentsData.map(dept => renderDepartmentRow(dept)).join('')}
            </tbody>
        </table>
    `;
}

function renderDepartmentRow(dept) {
    const createdAt = dept.dateCreation ? formatServerDate(dept.dateCreation) : '-';

    return `
        <tr>
            <td>
                <span class="user-badge ${dept.type === 'principal' ? 'badge-niveau-0' : 'badge-niveau-1'}">
                    ${dept.type === 'principal' ? '🏛️ Département' : '📋 Service'}
                </span>
            </td>
            <td><strong>${dept.code}</strong></td>
            <td>${dept.nom}</td>
            <td>${dept.parentDepartment ? dept.parentDepartment.nom : '-'}</td>
            <td>${dept.userCount || 0}</td>
            <td>${dept.documentCount || 0}</td>
            <td>${dept.subDepartmentCount || 0}</td>
            <td>${createdAt}</td>
            <td>
                <button class="action-btn btn-view" onclick='viewDepartmentDetails(${JSON.stringify(dept).replace(/'/g, "&#39;")})'>
                    ✏️ Modifier
                </button>
                <button class="action-btn btn-delete" onclick='confirmDeleteDepartment(${JSON.stringify(dept).replace(/'/g, "&#39;")})'>
                    🗑️ Supprimer
                </button>
            </td>
        </tr>
    `;
}

function renderDepartmentsPagination() {
    const { page, totalPages, total } = state.departmentsPagination;
    if (totalPages <= 1) return '';

    return `
        <div class="pagination-container">
            <div class="pagination-info">
                ${total} département${total > 1 ? 's' : ''} au total
            </div>
            <div class="pagination">
                <button class="pagination-btn" ${page === 1 ? 'disabled' : ''} onclick="goToDepartmentPage(${page - 1})">
                    ◀ Précédent
                </button>
                <span class="page-number">Page ${page} sur ${totalPages}</span>
                <button class="pagination-btn" ${page === totalPages ? 'disabled' : ''} onclick="goToDepartmentPage(${page + 1})">
                    Suivant ▶
                </button>
            </div>
        </div>
    `;
}

// Modales
function renderCreateDepartmentModal() {
    return `
        <div class="modal-overlay" onclick="closeCreateDepartmentModal()">
            <div class="modal-content" onclick="event.stopPropagation()">
                <div class="modal-header">
                    <h2>➕ Créer un département principal</h2>
                    <button class="modal-close" onclick="closeCreateDepartmentModal()">✕</button>
                </div>
                <form id="createDepartmentForm" onsubmit="handleCreateDepartment(event)">
                    <div class="modal-body">
                        <div class="form-group">
                            <label for="newDeptCode">Code du département *</label>
                            <input type="text" id="newDeptCode" name="code" required
                                   placeholder="Ex: DEPT001">
                        </div>
                        <div class="form-group">
                            <label for="newDeptNom">Nom du département *</label>
                            <input type="text" id="newDeptNom" name="nom" required
                                   placeholder="Ex: Direction Générale">
                        </div>
                        <div class="form-group">
                            <label for="newDeptDesc">Description (optionnel)</label>
                            <textarea id="newDeptDesc" name="description"
                                      placeholder="Description du département..."></textarea>
                        </div>
                    </div>
                    <div class="modal-actions">
                        <button type="button" class="btn-modal btn-secondary" onclick="closeCreateDepartmentModal()">
                            Annuler
                        </button>
                        <button type="submit" class="btn-modal btn-primary">
                            ✓ Créer le département
                        </button>
                    </div>
                </form>
            </div>
        </div>
    `;
}

function renderEditDepartmentModal() {
    const dept = state.selectedDepartment;
    if (!dept) return '';

    return `
        <div class="modal-overlay" onclick="closeEditDepartmentModal()">
            <div class="modal-content" onclick="event.stopPropagation()">
                <div class="modal-header">
                    <h2>✏️ Modifier le département</h2>
                    <button class="modal-close" onclick="closeEditDepartmentModal()">✕</button>
                </div>
                <form id="editDepartmentForm" onsubmit="handleEditDepartment(event)">
                    <div class="modal-body">
                        <div class="form-group">
                            <label for="editDeptCode">Code du département *</label>
                            <input type="text" id="editDeptCode" name="code" required
                                   value="${dept.code}">
                        </div>
                        <div class="form-group">
                            <label for="editDeptNom">Nom du département *</label>
                            <input type="text" id="editDeptNom" name="nom" required
                                   value="${dept.nom}">
                        </div>
                        <div class="form-group">
                            <label for="editDeptDesc">Description (optionnel)</label>
                            <textarea id="editDeptDesc" name="description">${dept.description || ''}</textarea>
                        </div>
                    </div>
                    <div class="modal-actions">
                        <button type="button" class="btn-modal btn-secondary" onclick="closeEditDepartmentModal()">
                            Annuler
                        </button>
                        <button type="submit" class="btn-modal btn-primary">
                            ✓ Enregistrer
                        </button>
                    </div>
                </form>
            </div>
        </div>
    `;
}

function renderDeleteDepartmentModal() {
    const dept = state.selectedDepartment;
    if (!dept) return '';

    return `
        <div class="modal-overlay" onclick="closeDeleteDepartmentModal()">
            <div class="modal-content" onclick="event.stopPropagation()">
                <div class="modal-header">
                    <h2>🗑️ Supprimer le département</h2>
                    <button class="modal-close" onclick="closeDeleteDepartmentModal()">✕</button>
                </div>
                <div class="modal-body">
                    <div style="background: #fef2f2; padding: 20px; border-radius: 8px; border: 2px solid #ef4444; margin-bottom: 20px;">
                        <p style="margin: 0; font-size: 14px; color: #7f1d1d;">
                            ⚠️ Vous êtes sur le point de supprimer le département :
                        </p>
                    </div>
                    <div style="background: #f7fafc; padding: 16px; border-radius: 8px; margin-bottom: 20px;">
                        <p style="margin: 0; font-weight: 600;">${dept.nom} (${dept.code})</p>
                        ${dept.userCount > 0 || dept.subDepartmentCount > 0 || dept.documentCount > 0 ? `
                            <div style="margin-top: 12px; padding: 12px; background: #fef2f2; border-radius: 6px;">
                                <p style="margin: 0; font-size: 13px; color: #991b1b; font-weight: 600;">
                                    ❌ Impossible de supprimer :
                                </p>
                                ${dept.userCount > 0 ? `<p style="margin: 4px 0 0 0; font-size: 12px; color: #7f1d1d;">• ${dept.userCount} utilisateur(s) affecté(s)</p>` : ''}
                                ${dept.subDepartmentCount > 0 ? `<p style="margin: 4px 0 0 0; font-size: 12px; color: #7f1d1d;">• ${dept.subDepartmentCount} service(s) dépendant(s)</p>` : ''}
                                ${dept.documentCount > 0 ? `<p style="margin: 4px 0 0 0; font-size: 12px; color: #7f1d1d;">• ${dept.documentCount} document(s) associé(s)</p>` : ''}
                            </div>
                        ` : ''}
                    </div>
                </div>
                <div class="modal-actions">
                    <button type="button" class="btn-modal btn-secondary" onclick="closeDeleteDepartmentModal()">
                        Annuler
                    </button>
                    ${dept.userCount === 0 && dept.subDepartmentCount === 0 && dept.documentCount === 0 ? `
                        <button type="button" class="btn-modal btn-danger" onclick="deleteDepartmentConfirmed()">
                            🗑️ Oui, supprimer définitivement
                        </button>
                    ` : ''}
                </div>
            </div>
        </div>
    `;
}

// Handlers
let departmentSearchDebounce;
function handleDepartmentSearchChange(value) {
    clearTimeout(departmentSearchDebounce);
    departmentSearchDebounce = setTimeout(async () => {
        state.departmentsFilters.search = value;
        state.departmentsPagination.page = 1;
        await loadDepartmentsModule();
    }, 300);
}

function handleDepartmentTypeFilter(value) {
    state.departmentsFilters.type = value;
    state.departmentsPagination.page = 1;
    loadDepartmentsModule();
}

function goToDepartmentPage(page) {
    state.departmentsPagination.page = page;
    loadDepartmentsModule();
}

function showCreateDepartmentModal() {
    state.showCreateDepartment = true;
    renderDepartmentsModule();
}

function closeCreateDepartmentModal() {
    state.showCreateDepartment = false;
    renderDepartmentsModule();
}

function viewDepartmentDetails(dept) {
    state.selectedDepartment = dept;
    state.showEditDepartment = true;
    renderDepartmentsModule();
}

function closeEditDepartmentModal() {
    state.showEditDepartment = false;
    state.selectedDepartment = null;
    renderDepartmentsModule();
}

function confirmDeleteDepartment(dept) {
    state.selectedDepartment = dept;
    state.showDeleteDepartmentConfirm = true;
    renderDepartmentsModule();
}

function closeDeleteDepartmentModal() {
    state.showDeleteDepartmentConfirm = false;
    state.selectedDepartment = null;
    renderDepartmentsModule();
}

async function handleCreateDepartment(event) {
    event.preventDefault();
    const formData = new FormData(event.target);

    const deptData = {
        code: formData.get('code'),
        nom: formData.get('nom'),
        description: formData.get('description')
    };

    try {
        const response = await fetch('/api/superadmin/departments', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify(deptData)
        });

        const data = await response.json();

        if (data.success) {
            closeCreateDepartmentModal();
            await loadDepartmentsModule();
            showSuccess(data.message);
        } else {
            showError(data.message);
        }
    } catch (error) {
        console.error('Erreur création département:', error);
        showError('Erreur lors de la création');
    }
}

async function handleEditDepartment(event) {
    event.preventDefault();
    const formData = new FormData(event.target);

    const deptData = {
        code: formData.get('code'),
        nom: formData.get('nom'),
        description: formData.get('description')
    };

    try {
        const response = await fetch(`/api/superadmin/departments/${state.selectedDepartment._id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify(deptData)
        });

        const data = await response.json();

        if (data.success) {
            closeEditDepartmentModal();
            await loadDepartmentsModule();
            showSuccess(data.message);
        } else {
            showError(data.message);
        }
    } catch (error) {
        console.error('Erreur modification département:', error);
        showError('Erreur lors de la modification');
    }
}

async function deleteDepartmentConfirmed() {
    try {
        const response = await fetch(`/api/superadmin/departments/${state.selectedDepartment._id}`, {
            method: 'DELETE',
            credentials: 'include'
        });

        const data = await response.json();

        if (data.success) {
            closeDeleteDepartmentModal();
            await loadDepartmentsModule();
            showSuccess(data.message);
        } else {
            showError(data.message);
        }
    } catch (error) {
        console.error('Erreur suppression département:', error);
        showError('Erreur lors de la suppression');
    }
}

/**
 * Initialisation au chargement de la page
 */
document.addEventListener('DOMContentLoaded', () => {
    loadDashboard();
    checkMaintenanceStatus();  // Vérifier l'état de la maintenance

    // Auto-refresh toutes les 30 secondes (seulement pour le dashboard)
    setInterval(() => {
        if (state.currentSection === 'dashboard') {
            loadDashboard();
        }
    }, 30000);
});
