// ============================================
// MESSAGERIE INTERNE - ARCHIVAGE C.E.R.E.R
// ============================================

// État de la messagerie
const messagingState = {
    unreadCount: 0,
    receivedMessages: [],
    sentMessages: [],
    deletionRequests: [],
    sharedDocuments: [],
    currentView: 'inbox' // 'inbox', 'sent', 'compose', 'deletion-requests', 'shared-docs'
};

// ============================================
// FONCTIONS API
// ============================================

// Envoyer un message
async function sendMessage(to, subject, message) {
    const response = await fetch('/api/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            from: state.currentUser,
            to,
            subject,
            body: message
        })
    });

    const data = await response.json();
    if (!data.success) throw new Error(data.message);
    return data;
}

// Créer une demande de suppression de message
async function requestMessageDeletion(messageId, motif) {
    const response = await fetch(`/api/messages/${messageId}/request-deletion`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            userId: state.currentUser,
            motif
        })
    });

    const data = await response.json();
    if (!data.success) throw new Error(data.message);
    return data;
}

// Récupérer les demandes de suppression (pour niveau 1)
async function getMessageDeletionRequests() {
    const response = await fetch(`/api/messages/deletion-requests/${state.currentUser}`);
    const data = await response.json();
    if (!data.success) throw new Error(data.message);
    return data.requests;
}

// Approuver une demande de suppression
async function approveMessageDeletionRequest(requestId) {
    const response = await fetch(`/api/messages/deletion-requests/${requestId}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            userId: state.currentUser
        })
    });

    const data = await response.json();
    if (!data.success) throw new Error(data.message);
    return data;
}

// Rejeter une demande de suppression
async function rejectMessageDeletionRequest(requestId, motifRejet) {
    const response = await fetch(`/api/messages/deletion-requests/${requestId}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            userId: state.currentUser,
            motifRejet
        })
    });

    const data = await response.json();
    if (!data.success) throw new Error(data.message);
    return data;
}

// Récupérer les messages reçus (20 derniers)
async function getReceivedMessages() {
    const response = await fetch(`/api/messages/received/${state.currentUser}`);
    const data = await response.json();
    if (!data.success) throw new Error(data.message);
    messagingState.receivedMessages = data.messages.map(msg => ({
        ...msg,
        dateEnvoi: msg.createdAt,
        lu: msg.read
    }));
    return messagingState.receivedMessages;
}

// Récupérer les messages envoyés (20 derniers)
async function getSentMessages() {
    const response = await fetch(`/api/messages/sent/${state.currentUser}`);
    const data = await response.json();
    if (!data.success) throw new Error(data.message);
    messagingState.sentMessages = data.messages.map(msg => ({
        ...msg,
        dateEnvoi: msg.createdAt,
        lu: msg.read
    }));
    return messagingState.sentMessages;
}

// Marquer un message comme lu
async function markMessageAsRead(messageId) {
    const response = await fetch(`/api/messages/${messageId}/read`, {
        method: 'PUT'
    });

    const data = await response.json();
    if (!data.success) throw new Error(data.message);
    return data;
}

// Supprimer un message
async function deleteMessage(messageId) {
    const response = await fetch(`/api/messages/${messageId}`, {
        method: 'DELETE'
    });

    const data = await response.json();
    if (!data.success) throw new Error(data.message);
    return data;
}

// Récupérer le nombre de messages non lus
async function getUnreadCount() {
    const response = await fetch(`/api/messages/${state.currentUser}/unread-count`);
    const data = await response.json();
    messagingState.unreadCount = data.count;
    return data.count;
}

// Récupérer la liste des utilisateurs
async function getUsersList() {
    const response = await fetch('/api/users');
    const data = await response.json();
    if (!data.success && !Array.isArray(data)) throw new Error('Erreur de récupération des utilisateurs');
    const users = Array.isArray(data) ? data : data.users;
    // Vérifier si state existe et a un currentUser
    const currentUser = (typeof state !== 'undefined' && state.currentUser) ? state.currentUser : null;
    return users.filter(u => u.username !== currentUser);
}

// Récupérer les documents partagés par l'utilisateur
async function getSharedDocuments() {
    const response = await fetch(`/api/shared-documents/${state.currentUser}`);
    const data = await response.json();
    if (!data.success) throw new Error(data.message);
    messagingState.sharedDocuments = data.sharedDocuments || [];
    return messagingState.sharedDocuments;
}

// ============================================
// RENDU INTERFACE
// ============================================

// Afficher la messagerie
function renderMessaging() {
    const userNiveau = state.currentUserInfo?.roleNiveau;
    const isJbk = state.currentUser === 'jbk';
    const showDeletionRequests = isJbk || userNiveau === 1;

    return `
        <div class="messaging-container max-w-7xl mx-auto">
            <!-- Header moderne avec gradient -->
            <div class="messaging-header bg-gradient-to-r from-blue-500 via-purple-500 to-pink-500 text-white p-6 rounded-2xl shadow-lg mb-6">
                <div class="flex items-center justify-between mb-4">
                    <div class="flex items-center gap-3">
                        <div class="bg-white/20 backdrop-blur-sm p-3 rounded-xl">
                            <span class="text-3xl">📧</span>
                        </div>
                        <div>
                            <h2 class="text-2xl font-bold">Messagerie Interne</h2>
                            <p class="text-sm text-white/80">Communication C.E.R.E.R</p>
                        </div>
                    </div>
                    <button onclick="window.location.reload()"
                            class="bg-white/20 backdrop-blur-sm hover:bg-white/30 px-4 py-2 rounded-xl transition flex items-center gap-2">
                        <span>🔄</span>
                        <span class="text-sm font-medium">Actualiser</span>
                    </button>
                </div>

                <!-- Tabs modernes -->
                <div class="flex gap-2 flex-wrap">
                    <button onclick="switchMessagingView('inbox')"
                            class="px-6 py-3 rounded-xl font-semibold transition flex items-center gap-2 ${messagingState.currentView === 'inbox' ? 'bg-white text-blue-600 shadow-lg' : 'bg-white/10 hover:bg-white/20 text-white'}">
                        <span class="text-xl">📥</span>
                        <span>Réception</span>
                        ${messagingState.unreadCount > 0 ? `<span class="bg-red-500 text-white text-xs font-bold px-2 py-1 rounded-full ml-1">${messagingState.unreadCount}</span>` : ''}
                    </button>
                    <button onclick="switchMessagingView('sent')"
                            class="px-6 py-3 rounded-xl font-semibold transition flex items-center gap-2 ${messagingState.currentView === 'sent' ? 'bg-white text-purple-600 shadow-lg' : 'bg-white/10 hover:bg-white/20 text-white'}">
                        <span class="text-xl">📤</span>
                        <span>Envoyés</span>
                    </button>
                    <button onclick="switchMessagingView('shared-docs')"
                            class="px-6 py-3 rounded-xl font-semibold transition flex items-center gap-2 ${messagingState.currentView === 'shared-docs' ? 'bg-white text-teal-600 shadow-lg' : 'bg-white/10 hover:bg-white/20 text-white'}">
                        <span class="text-xl">📑</span>
                        <span>Docs partagés</span>
                        ${messagingState.sharedDocuments.length > 0 ? `<span class="bg-teal-500 text-white text-xs font-bold px-2 py-1 rounded-full ml-1">${messagingState.sharedDocuments.length}</span>` : ''}
                    </button>
                    <button onclick="switchMessagingView('compose')"
                            class="px-6 py-3 rounded-xl font-semibold transition flex items-center gap-2 ${messagingState.currentView === 'compose' ? 'bg-white text-green-600 shadow-lg' : 'bg-white/10 hover:bg-white/20 text-white'}">
                        <span class="text-xl">✏️</span>
                        <span>Nouveau</span>
                    </button>
                    ${showDeletionRequests ? `
                        <button onclick="switchMessagingView('deletion-requests')"
                                class="px-6 py-3 rounded-xl font-semibold transition flex items-center gap-2 ${messagingState.currentView === 'deletion-requests' ? 'bg-white text-orange-600 shadow-lg' : 'bg-white/10 hover:bg-white/20 text-white'}">
                            <span class="text-xl">📝</span>
                            <span>Demandes</span>
                            ${messagingState.deletionRequests.length > 0 ? `<span class="bg-red-500 text-white text-xs font-bold px-2 py-1 rounded-full ml-1">${messagingState.deletionRequests.length}</span>` : ''}
                        </button>
                    ` : ''}
                </div>
            </div>

            <!-- Contenu -->
            <div class="messaging-content bg-white rounded-2xl shadow-lg p-6">
                ${renderMessagingContent()}
            </div>
        </div>
    `;
}

// Rendu du contenu selon la vue
function renderMessagingContent() {
    switch (messagingState.currentView) {
        case 'inbox':
            return renderInbox();
        case 'sent':
            return renderSentMessages();
        case 'shared-docs':
            return renderSharedDocuments();
        case 'compose':
            return renderComposeForm();
        case 'deletion-requests':
            return renderDeletionRequests();
        default:
            return '';
    }
}

// Rendu de la boîte de réception
function renderInbox() {
    if (messagingState.receivedMessages.length === 0) {
        return `
            <div class="flex flex-col items-center justify-center py-16">
                <div class="text-8xl mb-4 opacity-30">📭</div>
                <h3 class="text-2xl font-bold text-gray-400 mb-2">Boîte de réception vide</h3>
                <p class="text-gray-500">Vous n'avez reçu aucun message</p>
            </div>
        `;
    }

    return `
        <div class="space-y-3">
            <!-- En-tête avec compteur et info -->
            <div class="bg-gradient-to-r from-blue-50 to-purple-50 p-4 rounded-xl border-2 border-blue-200 mb-4">
                <div class="flex items-center justify-between">
                    <div class="flex items-center gap-3">
                        <div class="bg-blue-500 w-12 h-12 rounded-full flex items-center justify-center text-white font-bold text-xl">
                            📥
                        </div>
                        <div>
                            <h3 class="text-lg font-bold text-gray-800">Messages reçus</h3>
                            <p class="text-sm text-gray-600">
                                ${messagingState.receivedMessages.length} message${messagingState.receivedMessages.length > 1 ? 's' : ''}
                                <span class="text-blue-600 font-semibold">(20 derniers)</span>
                            </p>
                        </div>
                    </div>
                    ${messagingState.unreadCount > 0 ? `
                        <div class="bg-gradient-to-r from-red-500 to-pink-500 text-white px-4 py-2 rounded-full font-bold shadow-lg">
                            ${messagingState.unreadCount} non lu${messagingState.unreadCount > 1 ? 's' : ''}
                        </div>
                    ` : `
                        <div class="bg-green-100 text-green-700 px-4 py-2 rounded-full font-semibold">
                            ✓ Tous lus
                        </div>
                    `}
                </div>
            </div>

            <!-- Liste des messages -->
            ${messagingState.receivedMessages.map((msg, index) => `
                <div class="message-item ${!msg.lu ? 'border-l-4 border-blue-500 bg-blue-50' : 'border-l-4 border-gray-200 bg-white'} hover:shadow-lg rounded-xl p-4 cursor-pointer transition-all duration-200 hover:scale-[1.02]" onclick="openMessage('${msg._id}', 'received')">
                    <div class="flex items-start justify-between mb-2">
                        <div class="flex items-center gap-3 flex-1">
                            <div class="${!msg.lu ? 'bg-gradient-to-br from-blue-500 to-purple-500' : 'bg-gradient-to-br from-gray-400 to-gray-500'} w-12 h-12 rounded-full flex items-center justify-center text-white font-bold text-lg shadow-md">
                                ${msg.from.charAt(0).toUpperCase()}
                            </div>
                            <div class="flex-1">
                                <div class="flex items-center gap-2 mb-1">
                                    <span class="font-bold text-gray-900 text-base">${msg.fromName || msg.from}</span>
                                    ${!msg.lu ? '<span class="px-2 py-1 bg-gradient-to-r from-blue-500 to-blue-600 text-white text-xs rounded-full font-bold shadow animate-pulse">NOUVEAU</span>' : ''}
                                    <span class="text-xs text-gray-400 ml-auto">#${index + 1}</span>
                                </div>
                                <p class="text-xs text-gray-500 flex items-center gap-1">
                                    <span>📅</span>
                                    <span>${formatDate(msg.dateEnvoi)}</span>
                                </p>
                            </div>
                        </div>
                    </div>
                    <div class="ml-15 pl-1">
                        <h4 class="font-bold text-gray-900 mb-1 text-base">${msg.subject || '(Sans sujet)'}</h4>
                        <p class="text-sm text-gray-600 line-clamp-2">${(msg.body || msg.message || '').substring(0, 150)}${(msg.body || msg.message || '').length > 150 ? '...' : ''}</p>
                    </div>
                </div>
            `).join('')}

            <!-- Footer informatif -->
            ${messagingState.receivedMessages.length >= 20 ? `
                <div class="bg-yellow-50 border-2 border-yellow-200 rounded-xl p-4 text-center">
                    <p class="text-yellow-800 font-medium">
                        ℹ️ Seuls les 20 derniers messages reçus sont affichés
                    </p>
                    <p class="text-yellow-600 text-sm mt-1">
                        Les messages plus anciens sont archivés mais restent accessibles
                    </p>
                </div>
            ` : ''}
        </div>
    `;
}

// Rendu des messages envoyés
function renderSentMessages() {
    if (messagingState.sentMessages.length === 0) {
        return `
            <div class="flex flex-col items-center justify-center py-16">
                <div class="text-8xl mb-4 opacity-30">📤</div>
                <h3 class="text-2xl font-bold text-gray-400 mb-2">Aucun message envoyé</h3>
                <p class="text-gray-500">Vous n'avez envoyé aucun message</p>
                <button onclick="switchMessagingView('compose')"
                        class="mt-6 px-6 py-3 bg-gradient-to-r from-green-500 to-green-600 text-white rounded-xl font-semibold hover:shadow-lg transition">
                    ✏️ Écrire un message
                </button>
            </div>
        `;
    }

    return `
        <div class="space-y-3">
            <!-- En-tête avec compteur et actions -->
            <div class="bg-gradient-to-r from-purple-50 to-pink-50 p-4 rounded-xl border-2 border-purple-200 mb-4">
                <div class="flex items-center justify-between">
                    <div class="flex items-center gap-3">
                        <div class="bg-gradient-to-br from-purple-500 to-pink-500 w-12 h-12 rounded-full flex items-center justify-center text-white font-bold text-xl shadow-lg">
                            📤
                        </div>
                        <div>
                            <h3 class="text-lg font-bold text-gray-800">Messages envoyés</h3>
                            <p class="text-sm text-gray-600">
                                <span class="font-semibold text-purple-600">Historique:</span> ${messagingState.sentMessages.length} message${messagingState.sentMessages.length > 1 ? 's' : ''}
                                <span class="text-purple-600 font-semibold">(20 derniers)</span>
                            </p>
                        </div>
                    </div>
                    <button onclick="switchMessagingView('compose')"
                            class="px-5 py-3 bg-gradient-to-r from-green-500 to-green-600 text-white rounded-xl hover:shadow-lg transition font-bold flex items-center gap-2">
                        <span class="text-xl">✏️</span>
                        <span>Nouveau</span>
                    </button>
                </div>
            </div>

            <!-- Historique des 20 derniers messages envoyés -->
            <div class="bg-gradient-to-r from-blue-50 to-purple-50 p-3 rounded-lg border-l-4 border-purple-500 mb-3">
                <p class="text-sm text-gray-700 font-semibold">
                    📊 Traçabilité : Historique complet des 20 derniers messages envoyés
                </p>
            </div>

            <!-- Liste des messages -->
            ${messagingState.sentMessages.map((msg, index) => `
                <div class="message-item border-l-4 border-purple-400 bg-gradient-to-r from-purple-50 to-white hover:shadow-lg rounded-xl p-4 cursor-pointer transition-all duration-200 hover:scale-[1.02]" onclick="openMessage('${msg._id}', 'sent')">
                    <div class="flex items-start justify-between mb-2">
                        <div class="flex items-center gap-3 flex-1">
                            <div class="bg-gradient-to-br from-purple-500 to-pink-500 w-12 h-12 rounded-full flex items-center justify-center text-white font-bold text-lg shadow-md relative">
                                ${msg.to.charAt(0).toUpperCase()}
                                <div class="absolute -bottom-1 -right-1 bg-green-500 w-4 h-4 rounded-full border-2 border-white"></div>
                            </div>
                            <div class="flex-1">
                                <div class="flex items-center gap-2 mb-1">
                                    <span class="text-gray-600 text-xs font-medium">Destinataire:</span>
                                    <span class="font-bold text-gray-900 text-base">${msg.toName || msg.to}</span>
                                    <span class="text-xs text-gray-400 ml-auto">#${index + 1}</span>
                                </div>
                                <p class="text-xs text-gray-500 flex items-center gap-1">
                                    <span>📅</span>
                                    <span>Envoyé ${formatDate(msg.dateEnvoi)}</span>
                                </p>
                            </div>
                        </div>
                    </div>
                    <div class="ml-15 pl-1">
                        <h4 class="font-bold text-gray-900 mb-1 text-base">📝 ${msg.subject || '(Sans sujet)'}</h4>
                        <p class="text-sm text-gray-600 line-clamp-2">${(msg.body || msg.message || '').substring(0, 150)}${(msg.body || msg.message || '').length > 150 ? '...' : ''}</p>
                    </div>
                    <div class="mt-2 flex items-center gap-2">
                        <span class="px-2 py-1 bg-green-100 text-green-700 text-xs rounded-full font-semibold">✓ Envoyé</span>
                    </div>
                </div>
            `).join('')}

            <!-- Footer informatif -->
            ${messagingState.sentMessages.length >= 20 ? `
                <div class="bg-purple-50 border-2 border-purple-200 rounded-xl p-4 text-center">
                    <p class="text-purple-800 font-medium">
                        📋 Traçabilité complète : Les 20 derniers messages envoyés
                    </p>
                    <p class="text-purple-600 text-sm mt-1">
                        Vos messages plus anciens sont archivés en sécurité dans la base de données
                    </p>
                </div>
            ` : ''}
        </div>
    `;
}

// Rendu des documents partagés
function renderSharedDocuments() {
    if (messagingState.sharedDocuments.length === 0) {
        return `
            <div class="flex flex-col items-center justify-center py-16">
                <div class="text-8xl mb-4 opacity-30">📑</div>
                <h3 class="text-2xl font-bold text-gray-400 mb-2">Aucun document partagé</h3>
                <p class="text-gray-500">Vous n'avez partagé aucun document</p>
            </div>
        `;
    }

    return `
        <div class="space-y-3">
            <!-- En-tête avec compteur -->
            <div class="bg-gradient-to-r from-teal-50 to-cyan-50 p-4 rounded-xl border-2 border-teal-200 mb-4">
                <div class="flex items-center justify-between">
                    <div class="flex items-center gap-3">
                        <div class="bg-gradient-to-br from-teal-500 to-cyan-500 w-12 h-12 rounded-full flex items-center justify-center text-white font-bold text-xl shadow-lg">
                            📑
                        </div>
                        <div>
                            <h3 class="text-lg font-bold text-gray-800">Documents que vous avez partagés</h3>
                            <p class="text-sm text-gray-600">
                                <span class="font-semibold text-teal-600">Historique:</span> ${messagingState.sharedDocuments.length} partage${messagingState.sharedDocuments.length > 1 ? 's' : ''}
                                <span class="text-teal-600 font-semibold">(50 derniers)</span>
                            </p>
                        </div>
                    </div>
                </div>
            </div>

            <!-- Info traçabilité -->
            <div class="bg-gradient-to-r from-blue-50 to-teal-50 p-3 rounded-lg border-l-4 border-teal-500 mb-3">
                <p class="text-sm text-gray-700 font-semibold">
                    📊 Traçabilité complète : Historique de tous les documents que vous avez partagés avec d'autres utilisateurs
                </p>
            </div>

            <!-- Liste des documents partagés -->
            ${messagingState.sharedDocuments.map((doc, index) => `
                <div class="border-l-4 border-teal-400 bg-gradient-to-r from-teal-50 to-white hover:shadow-lg rounded-xl p-4 transition-all duration-200 hover:scale-[1.02]">
                    <div class="flex items-start justify-between mb-3">
                        <div class="flex items-center gap-3 flex-1">
                            <div class="bg-gradient-to-br from-teal-500 to-cyan-500 w-12 h-12 rounded-full flex items-center justify-center text-white font-bold text-lg shadow-md">
                                📄
                            </div>
                            <div class="flex-1">
                                <div class="flex items-center gap-2 mb-1">
                                    <h4 class="font-bold text-gray-900 text-base">${doc.documentTitle || 'Sans titre'}</h4>
                                    <span class="text-xs text-gray-400 ml-auto">#${index + 1}</span>
                                </div>
                                <p class="text-xs text-gray-500 flex items-center gap-1">
                                    <span>📋</span>
                                    <span>ID: ${doc.documentIdDocument || 'N/A'}</span>
                                </p>
                            </div>
                        </div>
                    </div>

                    <!-- Informations de partage -->
                    <div class="ml-15 pl-1 space-y-2">
                        <div class="bg-white rounded-lg p-3 border border-gray-200">
                            <p class="text-sm text-gray-700 mb-2">
                                <span class="font-semibold text-teal-600">Partagé avec:</span>
                                <span class="font-bold text-gray-900 ml-1">${doc.sharedWithName || doc.sharedWith}</span>
                            </p>
                            <div class="grid grid-cols-2 gap-2 text-xs text-gray-600">
                                <div>
                                    <span class="text-gray-500">Rôle:</span>
                                    <span class="font-semibold ml-1">${doc.sharedWithRole}</span>
                                </div>
                                <div>
                                    <span class="text-gray-500">Département:</span>
                                    <span class="font-semibold ml-1">${doc.sharedWithDept}</span>
                                </div>
                            </div>
                        </div>

                        <div class="flex items-center gap-2 text-xs text-gray-500">
                            <span class="px-2 py-1 bg-teal-100 text-teal-700 rounded-full font-semibold">
                                📅 ${formatDate(doc.sharedAt)}
                            </span>
                            <span class="px-2 py-1 bg-green-100 text-green-700 rounded-full font-semibold">
                                ✓ Partagé
                            </span>
                        </div>
                    </div>
                </div>
            `).join('')}

            <!-- Footer informatif -->
            ${messagingState.sharedDocuments.length >= 50 ? `
                <div class="bg-teal-50 border-2 border-teal-200 rounded-xl p-4 text-center">
                    <p class="text-teal-800 font-medium">
                        📋 Traçabilité : Les 50 derniers partages effectués
                    </p>
                    <p class="text-teal-600 text-sm mt-1">
                        Vos partages plus anciens sont archivés en sécurité dans la base de données
                    </p>
                </div>
            ` : ''}
        </div>
    `;
}

// Rendu du formulaire de composition
function renderComposeForm() {
    return `
        <div class="max-w-4xl mx-auto">
            <div class="mb-6">
                <h3 class="text-2xl font-bold text-gray-800 mb-2 flex items-center gap-2">
                    <span class="text-3xl">✏️</span>
                    <span>Nouveau Message</span>
                </h3>
                <p class="text-gray-500">Envoyez un message à un autre utilisateur de votre département</p>
            </div>

            <form id="compose-message-form" onsubmit="handleSendMessage(event)" class="space-y-5">
                <!-- Destinataire avec recherche -->
                <div class="bg-gradient-to-r from-blue-50 to-purple-50 p-4 rounded-xl border-2 border-blue-200">
                    <label for="message-to-search" class="block text-sm font-bold text-gray-700 mb-2 flex items-center gap-2">
                        <span class="text-lg">👤</span>
                        <span>Destinataire</span>
                        <span class="text-red-500">*</span>
                    </label>

                    <!-- Champ de recherche -->
                    <div class="relative mb-2">
                        <input type="text" id="message-to-search" placeholder="🔍 Rechercher un utilisateur..."
                               oninput="filterMessageRecipients(this.value)"
                               class="w-full px-4 py-3 pr-10 border-2 border-gray-300 rounded-xl focus:border-blue-500 focus:ring-2 focus:ring-blue-200 outline-none transition bg-white text-base">
                        <span class="absolute right-3 top-1/2 -translate-y-1/2 text-xl">🔍</span>
                    </div>

                    <!-- Liste déroulante -->
                    <select id="message-to" required
                            class="w-full px-4 py-3 border-2 border-gray-300 rounded-xl focus:border-blue-500 focus:ring-2 focus:ring-blue-200 outline-none transition bg-white text-base font-medium"
                            size="5">
                        <option value="">-- Choisir un destinataire --</option>
                    </select>
                    <p class="text-xs text-gray-500 mt-2">💡 Tapez pour filtrer la liste</p>
                </div>

                <!-- Sujet -->
                <div class="bg-gradient-to-r from-purple-50 to-pink-50 p-4 rounded-xl border-2 border-purple-200">
                    <label for="message-subject" class="block text-sm font-bold text-gray-700 mb-2 flex items-center gap-2">
                        <span class="text-lg">📋</span>
                        <span>Sujet</span>
                    </label>
                    <input type="text" id="message-subject"
                           placeholder="Entrez le sujet de votre message (optionnel)"
                           class="w-full px-4 py-3 border-2 border-gray-300 rounded-xl focus:border-purple-500 focus:ring-2 focus:ring-purple-200 outline-none transition bg-white text-base">
                </div>

                <!-- Message -->
                <div class="bg-gradient-to-r from-green-50 to-blue-50 p-4 rounded-xl border-2 border-green-200">
                    <label for="message-content" class="block text-sm font-bold text-gray-700 mb-2 flex items-center gap-2">
                        <span class="text-lg">💬</span>
                        <span>Message</span>
                        <span class="text-red-500">*</span>
                    </label>
                    <textarea id="message-content" rows="10" required
                              placeholder="Écrivez votre message ici..."
                              class="w-full px-4 py-3 border-2 border-gray-300 rounded-xl focus:border-green-500 focus:ring-2 focus:ring-green-200 outline-none transition bg-white text-base resize-none"></textarea>
                    <p class="text-xs text-gray-500 mt-2">💡 Conseil: Soyez clair et précis dans votre message</p>
                </div>

                <!-- Actions -->
                <div class="flex gap-3 pt-4">
                    <button type="submit"
                            class="flex-1 px-8 py-4 bg-gradient-to-r from-blue-500 to-blue-600 text-white rounded-xl hover:shadow-lg transition font-bold text-lg flex items-center justify-center gap-2">
                        <span class="text-2xl">📤</span>
                        <span>Envoyer le message</span>
                    </button>
                    <button type="button" onclick="switchMessagingView('inbox')"
                            class="px-8 py-4 bg-gradient-to-r from-gray-200 to-gray-300 text-gray-700 rounded-xl hover:shadow-lg transition font-bold text-lg flex items-center justify-center gap-2">
                        <span class="text-2xl">❌</span>
                        <span>Annuler</span>
                    </button>
                </div>
            </form>
        </div>
    `;
}

// Rendu des demandes de suppression (pour niveau 1)
function renderDeletionRequests() {
    if (messagingState.deletionRequests.length === 0) {
        return '<div class="empty-state">✅ Aucune demande de suppression en attente</div>';
    }

    return `
        <div class="deletion-requests-list">
            <h3>📝 Demandes de suppression en attente</h3>
            ${messagingState.deletionRequests.map(req => `
                <div class="deletion-request-card">
                    <div class="request-header">
                        <h4>Message: ${escapeHtml(req.messageSubject || 'Sans sujet')}</h4>
                        <span class="request-date">${formatDate(req.dateCreation)}</span>
                    </div>
                    <div class="request-details">
                        <p><strong>De:</strong> ${escapeHtml(req.messageFrom)}</p>
                        <p><strong>À:</strong> ${escapeHtml(req.messageTo)}</p>
                        <p><strong>Demandeur:</strong> ${escapeHtml(req.nomDemandeur)} (${escapeHtml(req.idDemandeur)})</p>
                        <p><strong>Niveau:</strong> ${req.niveauDemandeur}</p>
                        <p><strong>Motif:</strong> ${escapeHtml(req.motif)}</p>
                    </div>
                    <div class="request-actions">
                        <button onclick="handleApproveMessageDeletion('${req._id}')" class="btn-approve">✅ Approuver</button>
                        <button onclick="handleRejectMessageDeletion('${req._id}')" class="btn-reject">❌ Rejeter</button>
                    </div>
                </div>
            `).join('')}
        </div>
    `;
}

// ============================================
// ACTIONS
// ============================================

// Changer de vue
async function switchMessagingView(view) {
    messagingState.currentView = view;

    if (view === 'inbox') {
        await loadReceivedMessages();
    } else if (view === 'sent') {
        await loadSentMessages();
    } else if (view === 'shared-docs') {
        await loadSharedDocuments();
    } else if (view === 'compose') {
        await loadUsersList();
    } else if (view === 'deletion-requests') {
        await loadMessageDeletionRequests();
    }

    render();
}

// Charger les messages reçus
async function loadReceivedMessages() {
    try {
        await getReceivedMessages();
        await getUnreadCount();
    } catch (error) {
        console.error('Erreur chargement messages reçus:', error);
        showNotification('Erreur chargement messages', 'error');
    }
}

// Charger les messages envoyés
async function loadSentMessages() {
    try {
        await getSentMessages();
    } catch (error) {
        console.error('Erreur chargement messages envoyés:', error);
        showNotification('Erreur chargement messages', 'error');
    }
}

// Charger les documents partagés
async function loadSharedDocuments() {
    try {
        await getSharedDocuments();
    } catch (error) {
        console.error('Erreur chargement documents partagés:', error);
        showNotification('Erreur chargement documents partagés', 'error');
    }
}

// Charger la liste des utilisateurs
async function loadUsersList() {
    try {
        const users = await getUsersList();
        // Attendre que le DOM soit prêt
        setTimeout(() => {
            const select = document.getElementById('message-to');
            if (select) {
                select.innerHTML = '<option value="">-- Choisir un destinataire --</option>' +
                    users.map(user => `<option value="${user.username}">${user.nom || user.username} (${user.username})</option>`).join('');
            }
        }, 100);
    } catch (error) {
        console.error('Erreur chargement utilisateurs:', error);
        showNotification('Erreur chargement utilisateurs', 'error');
    }
}

// Charger les demandes de suppression
async function loadMessageDeletionRequests() {
    try {
        messagingState.deletionRequests = await getMessageDeletionRequests();
    } catch (error) {
        console.error('Erreur chargement demandes suppression:', error);
        showNotification('Erreur chargement demandes suppression', 'error');
    }
}

// Gérer l'approbation d'une demande
async function handleApproveMessageDeletion(requestId) {
    const confirmed = await customConfirm({
        title: 'Approuver la suppression',
        message: 'Voulez-vous vraiment approuver cette demande de suppression ? Le message sera définitivement supprimé.',
        confirmText: 'Oui, approuver',
        cancelText: 'Non, annuler',
        type: 'success',
        icon: '✅'
    });

    if (!confirmed) return;

    try {
        await approveMessageDeletionRequest(requestId);
        await customAlert({
            title: 'Succès',
            message: 'Demande approuvée et message supprimé avec succès.',
            type: 'success',
            icon: '✅'
        });
        await loadMessageDeletionRequests();
        render();
    } catch (error) {
        console.error('Erreur approbation demande:', error);
        await customAlert({
            title: 'Erreur',
            message: error.message || 'Erreur lors de l\'approbation',
            type: 'error',
            icon: '❌'
        });
    }
}

// Gérer le rejet d'une demande
async function handleRejectMessageDeletion(requestId) {
    const motifRejet = await customPrompt({
        title: 'Rejeter la demande',
        message: 'Veuillez indiquer le motif du rejet (optionnel) :',
        placeholder: 'Ex: Document encore nécessaire, demande non justifiée...',
        confirmText: 'Rejeter',
        cancelText: 'Annuler',
        type: 'textarea',
        icon: '❌',
        rows: 4
    });

    // Si l'utilisateur annule
    if (motifRejet === null) return;

    try {
        await rejectMessageDeletionRequest(requestId, motifRejet || 'Non spécifié');
        await customAlert({
            title: 'Demande rejetée',
            message: 'La demande de suppression a été rejetée.',
            type: 'info',
            icon: '❌'
        });
        await loadMessageDeletionRequests();
        render();
    } catch (error) {
        console.error('Erreur rejet demande:', error);
        await customAlert({
            title: 'Erreur',
            message: error.message || 'Erreur lors du rejet',
            type: 'error',
            icon: '❌'
        });
    }
}

// Gérer l'envoi d'un message
async function handleSendMessage(event) {
    event.preventDefault();

    const to = document.getElementById('message-to').value;
    const subject = document.getElementById('message-subject').value;
    const message = document.getElementById('message-content').value;

    if (!to || !message) {
        showNotification('Veuillez remplir tous les champs obligatoires', 'error');
        return;
    }

    try {
        await sendMessage(to, subject, message);
        showNotification('✅ Message envoyé avec succès!');
        switchMessagingView('sent');
    } catch (error) {
        console.error('Erreur envoi message:', error);
        showNotification('Erreur envoi du message', 'error');
    }
}

// Ouvrir un message
async function openMessage(messageId, type) {
    const messages = type === 'received' ? messagingState.receivedMessages : messagingState.sentMessages;
    const message = messages.find(m => m._id === messageId);

    if (!message) return;

    // Marquer comme lu si c'est un message reçu non lu
    if (type === 'received' && !message.lu) {
        try {
            await markMessageAsRead(messageId);
            message.lu = true;
            await getUnreadCount();
            render();
        } catch (error) {
            console.error('Erreur marquage message:', error);
        }
    }

    // Utiliser la nouvelle modal moderne
    showMessageModal(message, type);
}

// Répondre à un message avec contexte
async function replyToMessage(to, originalSubject, originalMessage, fromName) {
    messagingState.currentView = 'compose';
    render();

    // Charger la liste des utilisateurs d'abord
    await loadUsersList();

    setTimeout(() => {
        const toSelect = document.getElementById('message-to');
        const subjectInput = document.getElementById('message-subject');
        const messageContent = document.getElementById('message-content');

        if (toSelect) toSelect.value = to;
        if (subjectInput) {
            const subject = originalSubject || '(Sans sujet)';
            subjectInput.value = subject.startsWith('RE:') ? subject : `RE: ${subject}`;
        }

        // Ajouter le contexte du message original si disponible
        if (messageContent && originalMessage) {
            const contextText = `\n\n━━━━━━━━━━━━━━━━━━━━━━\n📩 Message original de ${fromName || to}:\n${originalMessage.substring(0, 300)}${originalMessage.length > 300 ? '...' : ''}\n━━━━━━━━━━━━━━━━━━━━━━\n`;
            messageContent.value = contextText;
            // Placer le curseur au début pour que l'utilisateur écrive sa réponse en premier
            messageContent.setSelectionRange(0, 0);
            messageContent.focus();
        }
    }, 150);
}

// Supprimer un message et rafraîchir
async function deleteMessageAndRefresh(messageId, type) {
    try {
        await deleteMessage(messageId);

        await customAlert({
            title: 'Message supprimé',
            message: 'Le message a été supprimé avec succès.',
            type: 'success',
            icon: '✅'
        });

        if (type === 'received') {
            await loadReceivedMessages();
        } else {
            await loadSentMessages();
        }

        render();
    } catch (error) {
        console.error('Erreur suppression message:', error);
        await customAlert({
            title: 'Erreur',
            message: 'Erreur lors de la suppression du message.',
            type: 'error',
            icon: '❌'
        });
    }
}

// Afficher la modal de demande de suppression
function showDeletionRequestModal(messageId, type) {
    const modalContent = `
        <div class="deletion-request-modal">
            <h3>📝 Demande de suppression</h3>
            <p>Veuillez indiquer le motif de votre demande de suppression :</p>
            <form id="deletion-request-form" onsubmit="handleDeletionRequest(event, '${messageId}', '${type}')">
                <div class="form-group">
                    <label for="deletion-motif">Motif de la demande :</label>
                    <textarea id="deletion-motif" rows="5" required placeholder="Expliquez pourquoi vous souhaitez supprimer ce message..."></textarea>
                </div>
                <div class="form-actions">
                    <button type="submit" class="btn-primary">📤 Envoyer la demande</button>
                    <button type="button" onclick="closeModal()" class="btn-secondary">Annuler</button>
                </div>
            </form>
        </div>
    `;

    showModal('Demande de suppression', modalContent);
}

// Gérer la soumission de la demande de suppression
async function handleDeletionRequest(event, messageId, type) {
    event.preventDefault();

    const motif = document.getElementById('deletion-motif').value;

    if (!motif.trim()) {
        showNotification('Veuillez saisir un motif', 'error');
        return;
    }

    try {
        await requestMessageDeletion(messageId, motif);
        closeModal();
        showNotification('✅ Demande de suppression envoyée au niveau 1 de votre département');

        if (type === 'received') {
            await loadReceivedMessages();
        } else {
            await loadSentMessages();
        }

        render();
    } catch (error) {
        console.error('Erreur envoi demande suppression:', error);
        showNotification(error.message || 'Erreur lors de l\'envoi de la demande', 'error');
    }
}

// Formater une date
function formatDate(dateString) {
    const date = new Date(dateString);
    const now = new Date();
    const diff = now - date;
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));

    if (days === 0) {
        return date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    } else if (days === 1) {
        return 'Hier ' + date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    } else if (days < 7) {
        return `${days} jours`;
    } else {
        return date.toLocaleDateString('fr-FR');
    }
}

// Échapper les guillemets pour les attributs HTML
function escapeQuotes(str) {
    if (!str) return '';
    return str.replace(/'/g, "\\'").replace(/"/g, '&quot;');
}

// Échapper le HTML pour éviter les injections XSS
function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

// ============================================
// INITIALISATION
// ============================================

// Charger les messages au démarrage
async function initMessaging() {
    await loadReceivedMessages();
}

// Fonction de filtrage des destinataires
function filterMessageRecipients(searchTerm) {
    const select = document.getElementById('message-to');
    if (!select) return;

    const term = searchTerm.toLowerCase().trim();

    // Parcourir toutes les options et afficher/masquer selon le filtre
    Array.from(select.options).forEach(option => {
        if (option.value === '') {
            // Toujours afficher l'option par défaut
            option.style.display = '';
            return;
        }

        const text = option.textContent.toLowerCase();
        if (text.includes(term)) {
            option.style.display = '';
        } else {
            option.style.display = 'none';
        }
    });

    // Si un seul résultat (en plus de l'option par défaut), le sélectionner automatiquement
    const visibleOptions = Array.from(select.options).filter(opt => opt.value !== '' && opt.style.display !== 'none');
    if (visibleOptions.length === 1 && term.length > 0) {
        visibleOptions[0].selected = true;
    }
}

// Exposer les fonctions nécessaires dans le scope global
window.replyToMessage = replyToMessage;
window.sendMessage = sendMessage;
window.deleteMessage = deleteMessage;
window.markAsRead = markAsRead;
window.filterMessageRecipients = filterMessageRecipients;
