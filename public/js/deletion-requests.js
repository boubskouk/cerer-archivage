// ============================================
// GESTION DES DEMANDES DE SUPPRESSION
// Module pour les utilisateurs niveau 1
// ============================================

// État des demandes de suppression
const deletionRequestsState = {
    requests: [],
    loading: false,
    showModal: false,
    selectedRequest: null
};

// Charger les demandes de suppression
async function loadDeletionRequests() {
    if (!state.currentUser || !state.currentUserInfo) {
        return;
    }

    // Vérifier que l'utilisateur est niveau 1
    if (state.currentUserInfo.roleNiveau !== 1) {
        return;
    }

    try {
        deletionRequestsState.loading = true;
        renderDeletionRequests();

        const result = await getDeletionRequests(state.currentUser);

        if (result.success) {
            deletionRequestsState.requests = result.requests || [];
            console.log(`📋 ${deletionRequestsState.requests.length} demande(s) de suppression chargée(s)`);
        }
    } catch (error) {
        console.error('Erreur chargement demandes:', error);
        showNotification('Erreur lors du chargement des demandes', 'error');
    } finally {
        deletionRequestsState.loading = false;
        renderDeletionRequests();
    }
}

// Approuver une demande
async function handleApproveDeletion(requestId) {
    if (!confirm('Êtes-vous sûr de vouloir approuver cette suppression ?')) {
        return;
    }

    try {
        const result = await approveDeletionRequest(requestId, state.currentUser);

        if (result.success) {
            showNotification('✅ Document supprimé avec succès', 'success');

            // Recharger les demandes
            await loadDeletionRequests();

            // Recharger les documents pour mettre à jour la liste
            await loadData();
        }
    } catch (error) {
        console.error('Erreur approbation:', error);
        showNotification('Erreur lors de l\'approbation', 'error');
    }
}

// Rejeter une demande
async function handleRejectDeletion(requestId) {
    const motif = prompt('Raison du rejet (optionnel):');

    // Si l'utilisateur annule le prompt
    if (motif === null) {
        return;
    }

    try {
        const result = await rejectDeletionRequest(requestId, state.currentUser, motif || 'Non spécifié');

        if (result.success) {
            showNotification('❌ Demande de suppression rejetée', 'info');

            // Recharger les demandes
            await loadDeletionRequests();
        }
    } catch (error) {
        console.error('Erreur rejet:', error);
        showNotification('Erreur lors du rejet', 'error');
    }
}

// Afficher le badge de notification
function renderDeletionRequestsBadge() {
    if (!state.currentUserInfo || state.currentUserInfo.roleNiveau !== 1) {
        return '';
    }

    const count = deletionRequestsState.requests.length;

    if (count === 0) {
        return '';
    }

    return `
        <span class="absolute -top-1 -right-1 bg-red-500 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center font-bold">
            ${count}
        </span>
    `;
}

// Rendre l'interface des demandes
function renderDeletionRequests() {
    const container = document.getElementById('deletion-requests-container');

    if (!container) {
        return;
    }

    // Si pas niveau 1, ne rien afficher
    if (!state.currentUserInfo || state.currentUserInfo.roleNiveau !== 1) {
        container.innerHTML = '';
        return;
    }

    if (deletionRequestsState.loading) {
        container.innerHTML = `
            <div class="bg-white rounded-lg shadow-lg p-6">
                <h3 class="text-xl font-bold mb-4">📝 Demandes de suppression</h3>
                <div class="flex justify-center items-center py-8">
                    <div class="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
                </div>
            </div>
        `;
        return;
    }

    const requests = deletionRequestsState.requests;

    if (requests.length === 0) {
        container.innerHTML = `
            <div class="bg-white rounded-lg shadow-lg p-6">
                <h3 class="text-xl font-bold mb-4">📝 Demandes de suppression</h3>
                <div class="text-center py-8 text-gray-500">
                    <p>✅ Aucune demande en attente</p>
                </div>
            </div>
        `;
        return;
    }

    container.innerHTML = `
        <div class="bg-white rounded-lg shadow-lg p-6">
            <div class="flex items-center justify-between mb-4">
                <h3 class="text-xl font-bold">📝 Demandes de suppression</h3>
                <span class="bg-red-500 text-white px-3 py-1 rounded-full text-sm font-bold">
                    ${requests.length}
                </span>
            </div>

            <div class="space-y-4">
                ${requests.map(req => renderDeletionRequestCard(req)).join('')}
            </div>
        </div>
    `;
}

// Rendre une carte de demande
function renderDeletionRequestCard(request) {
    const dateCreation = new Date(request.dateCreation);
    const dateStr = dateCreation.toLocaleDateString('fr-FR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });

    return `
        <div class="border border-gray-200 rounded-lg p-4 hover:shadow-md transition-shadow">
            <div class="flex items-start justify-between">
                <div class="flex-1">
                    <h4 class="font-bold text-gray-800 mb-2">
                        📄 ${escapeHtml(request.documentTitre)}
                    </h4>

                    <div class="space-y-1 text-sm text-gray-600">
                        <p>
                            <span class="font-semibold">Demandé par:</span>
                            ${escapeHtml(request.nomDemandeur)} (${escapeHtml(request.idDemandeur)})
                        </p>
                        <p>
                            <span class="font-semibold">Date:</span>
                            ${dateStr}
                        </p>
                        ${request.motif ? `
                            <p>
                                <span class="font-semibold">Motif:</span>
                                ${escapeHtml(request.motif)}
                            </p>
                        ` : ''}
                    </div>
                </div>
            </div>

            <div class="flex gap-2 mt-4">
                <button
                    onclick="handleApproveDeletion('${request._id}')"
                    class="flex-1 bg-green-600 hover:bg-green-700 text-white font-bold py-2 px-4 rounded transition-colors"
                >
                    ✅ Approuver
                </button>
                <button
                    onclick="handleRejectDeletion('${request._id}')"
                    class="flex-1 bg-red-600 hover:bg-red-700 text-white font-bold py-2 px-4 rounded transition-colors"
                >
                    ❌ Rejeter
                </button>
            </div>
        </div>
    `;
}

// Fonction utilitaire pour échapper le HTML
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Charger les demandes au démarrage de l'application
if (typeof window !== 'undefined') {
    // Charger les demandes après l'authentification
    const originalLogin = window.login;
    if (originalLogin) {
        window.login = async function(...args) {
            const result = await originalLogin.apply(this, args);
            if (result) {
                // Attendre un peu que state.currentUserInfo soit défini
                setTimeout(() => {
                    loadDeletionRequests();
                }, 500);
            }
            return result;
        };
    }

    // Recharger périodiquement les demandes (toutes les 30 secondes)
    setInterval(() => {
        if (state.isAuthenticated && state.currentUserInfo && state.currentUserInfo.roleNiveau === 1) {
            loadDeletionRequests();
        }
    }, 30000);
}
