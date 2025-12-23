/**
 * ============================================
 * SUPER ADMIN DASHBOARD - FRONTEND
 * ============================================
 *
 * Gère l'affichage du dashboard Super Admin
 * Récupère et affiche les statistiques système
 */

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

    // Modales
    showUserDetails: false,
    showCreateUser: false,
    showBlockConfirm: false,
    showDeleteConfirm: false,
    showFullHistory: false,

    // Rôles et départements (pour les selects)
    roles: [],
    departements: [],

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
    }
}

/**
 * Rafraîchir la section actuelle
 */
function refreshCurrentSection() {
    loadCurrentSection();
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
        const action = isCurrentlyEnabled ? 'désactiver' : 'activer';

        // Confirmation
        if (!confirm(`Voulez-vous vraiment ${action} le mode maintenance ?`)) {
            return;
        }

        // Appeler l'API
        const response = await fetch(endpoint, {
            method: 'POST',
            credentials: 'include'
        });

        const data = await response.json();

        if (data.success) {
            updateMaintenanceButton(!isCurrentlyEnabled);
            alert(`✅ ${data.message}`);
        } else {
            alert(`❌ ${data.message}`);
        }
    } catch (error) {
        console.error('Erreur toggle maintenance:', error);
        alert('❌ Erreur lors de la modification du mode maintenance');
    }
}

/**
 * Mettre à jour l'apparence du bouton maintenance
 */
function updateMaintenanceButton(isEnabled) {
    const btn = document.getElementById('maintenanceBtn');
    const icon = document.getElementById('maintenanceIcon');
    const text = document.getElementById('maintenanceText');

    // Mettre à jour le state
    state.maintenanceMode = isEnabled;

    if (isEnabled) {
        btn.style.background = 'linear-gradient(135deg, #10b981 0%, #059669 100%)';
        icon.textContent = '🔓';
        text.textContent = 'Désactiver maintenance';
    } else {
        btn.style.background = 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)';
        icon.textContent = '🔒';
        text.textContent = 'Activer maintenance';
    }

    // Rafraîchir la liste des utilisateurs si on est dans la section users
    if (state.currentSection === 'users') {
        renderUsersModule();
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
            // Non authentifié ou pas niveau 0
            window.location.href = '/super-admin-login.html';
            return false;
        }

        const data = await response.json();

        if (!data.success) {
            window.location.href = '/super-admin-login.html';
            return false;
        }

        return true;

    } catch (error) {
        console.error('Erreur vérification auth:', error);
        window.location.href = '/super-admin-login.html';
        return false;
    }
}

/**
 * Charger le dashboard complet
 */
async function loadDashboard() {
    try {
        showLoading();
        hideError();

        // Vérifier l'authentification
        const isAuth = await checkAuth();
        if (!isAuth) return;

        // Charger les statistiques
        await loadStats();

        // Charger les graphiques
        await loadCharts();

        showDashboard();

    } catch (error) {
        console.error('Erreur chargement dashboard:', error);
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
    if (confirm('Voulez-vous vraiment vous déconnecter ?')) {
        try {
            // Détruire la session
            await fetch('/api/logout', {
                method: 'POST',
                credentials: 'include'
            });
        } catch (error) {
            console.error('Erreur déconnexion:', error);
        }

        // Rediriger vers la page de connexion
        window.location.href = '/super-admin-login.html';
    }
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

    const params = new URLSearchParams({
        search,
        role,
        status,
        page,
        period
    });

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

    return `
        <tr class="${isBlocked ? 'blocked' : ''}">
            <td>
                <strong>${user.nom}</strong><br>
                <small style="color: #718096;">@${user.username}</small>
            </td>
            <td>${user.email}</td>
            <td>
                <span class="user-badge badge-niveau-${user.role.niveau}">
                    ${user.role.nom}
                </span>
            </td>
            <td>${user.departement ? user.departement.nom : '-'}</td>
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
    const { page, totalPages } = state.usersPagination;

    if (totalPages <= 1) return '';

    return `
        <div class="pagination">
            <button ${page === 1 ? 'disabled' : ''} onclick="goToUsersPage(${page - 1})">
                ◀ Précédent
            </button>
            <span class="page-number">Page ${page} sur ${totalPages}</span>
            <button ${page === totalPages ? 'disabled' : ''} onclick="goToUsersPage(${page + 1})">
                Suivant ▶
            </button>
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
                                ${state.roles.map(role => `
                                    <option value="${role._id}">${role.nom} (Niveau ${role.niveau})</option>
                                `).join('')}
                            </select>
                        </div>
                        <div class="form-group">
                            <label for="newDepartement">Département (optionnel)</label>
                            <select id="newDepartement" name="idDepartement">
                                <option value="">-- Aucun département --</option>
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
