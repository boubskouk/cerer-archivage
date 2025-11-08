// ============================================
// GESTION ADMIN AVANCÉE - ARCHIVAGE C.E.R.E.R
// ============================================

// ===== GESTION DES UTILISATEURS =====

async function deleteUser(username) {
    const confirmed = await customConfirm({
        title: 'Supprimer l\'utilisateur',
        message: `Voulez-vous vraiment supprimer l'utilisateur "${username}" ? Cette action est irréversible.`,
        confirmText: 'Oui, supprimer',
        cancelText: 'Annuler',
        type: 'danger',
        icon: '🗑️'
    });

    if (!confirmed) return;

    try {
        await apiCall(`/users/${username}`, 'DELETE');
        await toggleUsersManagement(); // Recharger la liste
        showNotification('✅ Utilisateur supprimé');
    } catch (error) {
        console.error('Erreur suppression utilisateur:', error);
    }
}

function startEditUser(username) {
    const user = state.allUsersForManagement.find(u => u.username === username);
    if (!user) return;
    state.editingUser = { ...user };
    render();
}

function cancelEditUser() {
    state.editingUser = null;
    render();
}

async function saveEditUser() {
    if (!state.editingUser) return;

    const nom = document.getElementById('edit_user_nom').value.trim();
    const email = document.getElementById('edit_user_email').value.trim();
    const idRole = document.getElementById('edit_user_role').value;
    const idDepartement = document.getElementById('edit_user_dept').value;

    if (!nom || !email || !idRole || !idDepartement) {
        showNotification('❌ Tous les champs sont requis', 'error');
        return;
    }

    try {
        await apiCall(`/users/${state.editingUser.username}`, 'PUT', {
            nom,
            email,
            idRole,
            idDepartement
        });
        await toggleUsersManagement(); // Recharger
        state.editingUser = null;
        showNotification('✅ Utilisateur modifié');
    } catch (error) {
        console.error('Erreur modification utilisateur:', error);
    }
}

async function resetUserPassword(username) {
    const newPassword = await customPrompt({
        title: 'Réinitialiser le mot de passe',
        message: `Entrez le nouveau mot de passe pour "${username}" :`,
        placeholder: 'Nouveau mot de passe...',
        confirmText: 'Réinitialiser',
        cancelText: 'Annuler',
        type: 'password',
        icon: '🔐'
    });

    if (!newPassword) return;

    if (newPassword.length < 4) {
        await customAlert({
            title: 'Erreur',
            message: 'Le mot de passe doit contenir au moins 4 caractères.',
            type: 'error',
            icon: '❌'
        });
        return;
    }

    try {
        await apiCall(`/users/${username}/reset-password`, 'POST', { newPassword });
        await customAlert({
            title: 'Succès',
            message: `Mot de passe de "${username}" réinitialisé avec succès.`,
            type: 'success',
            icon: '✅'
        });
    } catch (error) {
        console.error('Erreur réinitialisation mot de passe:', error);
    }
}

// ===== GESTION DES RÔLES =====

async function addRole() {
    const nom = document.getElementById('new_role_nom').value.trim();
    const niveau = parseInt(document.getElementById('new_role_niveau').value);
    const description = document.getElementById('new_role_desc').value.trim();

    if (!nom || !niveau || !description) {
        showNotification('❌ Tous les champs sont requis', 'error');
        return;
    }

    try {
        await apiCall('/roles', 'POST', { nom, niveau, description });
        await loadRolesAndDepartements();
        showNotification('✅ Rôle créé');
        document.getElementById('new_role_nom').value = '';
        document.getElementById('new_role_niveau').value = '';
        document.getElementById('new_role_desc').value = '';
    } catch (error) {
        console.error('Erreur création rôle:', error);
    }
}

async function deleteRole(roleId) {
    const confirmed = await customConfirm({
        title: 'Supprimer le rôle',
        message: 'Voulez-vous vraiment supprimer ce rôle ? Cette action est irréversible.',
        confirmText: 'Oui, supprimer',
        cancelText: 'Annuler',
        type: 'danger',
        icon: '🗑️'
    });

    if (!confirmed) return;

    try {
        await apiCall(`/roles/${roleId}`, 'DELETE');
        await loadRolesAndDepartements();
        showNotification('✅ Rôle supprimé');
    } catch (error) {
        console.error('Erreur suppression rôle:', error);
    }
}

function startEditRole(roleId) {
    const role = state.roles.find(r => r._id === roleId);
    if (!role) return;
    state.editingRole = { ...role };
    render();
}

function cancelEditRole() {
    state.editingRole = null;
    render();
}

async function saveEditRole() {
    if (!state.editingRole) return;

    const nom = document.getElementById('edit_role_nom').value.trim();
    const niveau = parseInt(document.getElementById('edit_role_niveau').value);
    const description = document.getElementById('edit_role_desc').value.trim();

    if (!nom || !niveau || !description) {
        showNotification('❌ Tous les champs sont requis', 'error');
        return;
    }

    try {
        await apiCall(`/roles/${state.editingRole._id}`, 'PUT', { nom, niveau, description });
        await loadRolesAndDepartements();
        state.editingRole = null;
        showNotification('✅ Rôle modifié');
    } catch (error) {
        console.error('Erreur modification rôle:', error);
    }
}

// ===== RENDU DES INTERFACES =====

function renderUsersManagement() {
    if (!state.showUsersManagement) return '';

    return `
        <div class="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4 backdrop-blur-sm"
             onclick="if(event.target === this) toggleUsersManagement()">
            <div class="modal-glass rounded-2xl p-8 max-w-5xl w-full max-h-[90vh] overflow-y-auto shadow-2xl animate-fade-in" onclick="event.stopPropagation()">
                <h2 class="text-2xl font-bold mb-6 bg-gradient-to-r from-purple-600 to-pink-600 bg-clip-text text-transparent">👥 Gestion des utilisateurs</h2>

                <!-- Liste des utilisateurs -->
                <div class="space-y-3 mb-6">
                    ${state.allUsersForManagement.map((user, index) => `
                        ${state.editingUser && state.editingUser.username === user.username ? `
                            <!-- Mode édition -->
                            <div class="p-4 bg-purple-50 rounded-xl space-y-3 border-2 border-purple-300">
                                <div class="flex items-center gap-2 mb-2">
                                    <span class="text-lg font-bold">✏️ Modifier ${user.username}</span>
                                </div>
                                <input id="edit_user_nom" type="text" value="${user.nom}" placeholder="Nom complet"
                                       class="w-full px-3 py-2 border-2 rounded-lg input-modern text-sm">
                                <input id="edit_user_email" type="email" value="${user.email}" placeholder="Email"
                                       class="w-full px-3 py-2 border-2 rounded-lg input-modern text-sm">
                                <select id="edit_user_role" class="w-full px-3 py-2 border-2 rounded-lg input-modern text-sm">
                                    ${state.roles.map(role => `
                                        <option value="${role._id}" ${user.idRole === role._id ? 'selected' : ''}>
                                            ${role.nom} (Niveau ${role.niveau})
                                        </option>
                                    `).join('')}
                                </select>
                                <select id="edit_user_dept" class="w-full px-3 py-2 border-2 rounded-lg input-modern text-sm">
                                    ${state.departements.map(dept => `
                                        <option value="${dept._id}" ${user.idDepartement === dept._id ? 'selected' : ''}>
                                            ${dept.nom}
                                        </option>
                                    `).join('')}
                                </select>
                                <div class="flex gap-2">
                                    <button onclick="saveEditUser()" class="flex-1 px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 transition text-sm font-medium">
                                        ✅ Enregistrer
                                    </button>
                                    <button onclick="cancelEditUser()" class="flex-1 px-4 py-2 bg-gray-300 text-gray-700 rounded-lg hover:bg-gray-400 transition text-sm font-medium">
                                        ❌ Annuler
                                    </button>
                                </div>
                            </div>
                        ` : `
                            <!-- Mode affichage -->
                            <div class="p-4 bg-gradient-to-r from-purple-50 to-pink-50 rounded-xl border-2 border-purple-200 hover:shadow-md transition">
                                <div class="flex items-center justify-between">
                                    <div class="flex-1">
                                        <div class="flex items-center gap-3 mb-2">
                                            <span class="text-2xl">👤</span>
                                            <div>
                                                <h3 class="font-bold text-gray-900">${user.nom}</h3>
                                                <p class="text-sm text-gray-600">@${user.username}</p>
                                            </div>
                                        </div>
                                        <div class="grid grid-cols-2 gap-2 text-xs">
                                            <div>
                                                <span class="text-gray-500">Email:</span>
                                                <span class="font-semibold ml-1">${user.email}</span>
                                            </div>
                                            <div>
                                                <span class="text-gray-500">Rôle:</span>
                                                <span class="font-semibold ml-1">${user.role} (Niveau ${user.niveau})</span>
                                            </div>
                                            <div>
                                                <span class="text-gray-500">Département:</span>
                                                <span class="font-semibold ml-1">${user.departement}</span>
                                            </div>
                                        </div>
                                    </div>
                                    <div class="flex flex-col gap-2">
                                        ${user.username !== state.currentUser ? `
                                            <button onclick='startEditUser("${user.username}")' class="px-3 py-1 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition text-xs font-medium">
                                                ✏️ Modifier
                                            </button>
                                            <button onclick='resetUserPassword("${user.username}")' class="px-3 py-1 bg-yellow-500 text-white rounded-lg hover:bg-yellow-600 transition text-xs font-medium">
                                                🔐 Reset MDP
                                            </button>
                                            <button onclick='deleteUser("${user.username}")' class="px-3 py-1 bg-red-500 text-white rounded-lg hover:bg-red-600 transition text-xs font-medium">
                                                🗑️ Supprimer
                                            </button>
                                        ` : `
                                            <span class="px-3 py-1 bg-green-100 text-green-700 rounded-lg text-xs font-bold">
                                                ✓ Vous
                                            </span>
                                        `}
                                    </div>
                                </div>
                            </div>
                        `}
                    `).join('')}
                </div>

                <button onclick="toggleUsersManagement()" class="w-full px-6 py-3 bg-gradient-to-br from-gray-200 to-gray-300 rounded-xl hover:shadow-md transition font-medium">
                    Fermer
                </button>
            </div>
        </div>
    `;
}

function renderRolesManagement() {
    if (!state.showRolesManagement) return '';

    return `
        <div class="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4 backdrop-blur-sm"
             onclick="if(event.target === this) toggleRolesManagement()">
            <div class="modal-glass rounded-2xl p-8 max-w-4xl w-full max-h-[90vh] overflow-y-auto shadow-2xl animate-fade-in" onclick="event.stopPropagation()">
                <h2 class="text-2xl font-bold mb-6 bg-gradient-to-r from-indigo-600 to-blue-600 bg-clip-text text-transparent">🎭 Gestion des rôles</h2>

                <!-- Liste des rôles -->
                <div class="space-y-3 mb-6">
                    ${state.roles.map((role, index) => `
                        ${state.editingRole && state.editingRole._id === role._id ? `
                            <!-- Mode édition -->
                            <div class="p-4 bg-indigo-50 rounded-xl space-y-3 border-2 border-indigo-300">
                                <div class="flex items-center gap-2 mb-2">
                                    <span class="text-lg font-bold">✏️ Modifier</span>
                                </div>
                                <input id="edit_role_nom" type="text" value="${role.nom}" placeholder="Nom du rôle"
                                       class="w-full px-3 py-2 border-2 rounded-lg input-modern text-sm">
                                <select id="edit_role_niveau" class="w-full px-3 py-2 border-2 rounded-lg input-modern text-sm">
                                    <option value="1" ${role.niveau === 1 ? 'selected' : ''}>Niveau 1 (Administrateur)</option>
                                    <option value="2" ${role.niveau === 2 ? 'selected' : ''}>Niveau 2 (Utilisateur)</option>
                                    <option value="3" ${role.niveau === 3 ? 'selected' : ''}>Niveau 3 (Invité)</option>
                                </select>
                                <textarea id="edit_role_desc" placeholder="Description" rows="3"
                                       class="w-full px-3 py-2 border-2 rounded-lg input-modern text-sm resize-none">${role.description || ''}</textarea>
                                <div class="flex gap-2">
                                    <button onclick="saveEditRole()" class="flex-1 px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 transition text-sm font-medium">
                                        ✅ Enregistrer
                                    </button>
                                    <button onclick="cancelEditRole()" class="flex-1 px-4 py-2 bg-gray-300 text-gray-700 rounded-lg hover:bg-gray-400 transition text-sm font-medium">
                                        ❌ Annuler
                                    </button>
                                </div>
                            </div>
                        ` : `
                            <!-- Mode affichage -->
                            <div class="p-4 bg-gradient-to-r from-indigo-50 to-blue-50 rounded-xl border-2 border-indigo-200 hover:shadow-md transition">
                                <div class="flex items-center justify-between">
                                    <div class="flex-1">
                                        <div class="flex items-center gap-3 mb-2">
                                            <span class="text-2xl">🎭</span>
                                            <div>
                                                <h3 class="font-bold text-gray-900">${role.nom}</h3>
                                                <p class="text-sm text-gray-600">Niveau ${role.niveau}</p>
                                            </div>
                                        </div>
                                        <p class="text-xs text-gray-600 italic">${role.description || 'Aucune description'}</p>
                                    </div>
                                    <div class="flex gap-2">
                                        <button onclick='startEditRole("${role._id}")' class="px-3 py-1 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition text-xs font-medium">
                                            ✏️ Modifier
                                        </button>
                                        <button onclick='deleteRole("${role._id}")' class="px-3 py-1 bg-red-500 text-white rounded-lg hover:bg-red-600 transition text-xs font-medium">
                                            🗑️ Supprimer
                                        </button>
                                    </div>
                                </div>
                            </div>
                        `}
                    `).join('')}
                </div>

                <!-- Formulaire d'ajout -->
                <div class="bg-gradient-to-r from-blue-50 to-indigo-50 p-4 rounded-xl border-2 border-indigo-300 mb-4">
                    <h3 class="font-bold text-gray-800 mb-3">➕ Ajouter un nouveau rôle</h3>
                    <div class="space-y-3">
                        <input id="new_role_nom" type="text" placeholder="Nom du rôle"
                               class="w-full px-3 py-2 border-2 rounded-lg input-modern text-sm">
                        <select id="new_role_niveau" class="w-full px-3 py-2 border-2 rounded-lg input-modern text-sm">
                            <option value="">-- Sélectionner un niveau --</option>
                            <option value="1">Niveau 1 (Administrateur)</option>
                            <option value="2">Niveau 2 (Utilisateur)</option>
                            <option value="3">Niveau 3 (Invité)</option>
                        </select>
                        <textarea id="new_role_desc" placeholder="Description" rows="2"
                                  class="w-full px-3 py-2 border-2 rounded-lg input-modern text-sm resize-none"></textarea>
                        <button onclick="addRole()" class="w-full px-4 py-2 bg-indigo-500 text-white rounded-lg hover:bg-indigo-600 transition font-medium">
                            ➕ Créer le rôle
                        </button>
                    </div>
                </div>

                <button onclick="toggleRolesManagement()" class="w-full px-6 py-3 bg-gradient-to-br from-gray-200 to-gray-300 rounded-xl hover:shadow-md transition font-medium">
                    Fermer
                </button>
            </div>
        </div>
    `;
}

function renderAdvancedStats() {
    if (!state.showAdvancedStats) return '';

    // Calculer les statistiques
    const totalDocs = state.documents.length;
    const docsByCategory = {};
    const docsByDepartment = {};
    const docsByUser = {};

    state.documents.forEach(doc => {
        // Par catégorie
        const cat = state.categories.find(c => c.id === doc.categorie);
        const catName = cat ? cat.nom : 'Autre';
        docsByCategory[catName] = (docsByCategory[catName] || 0) + 1;

        // Par département
        const deptName = doc.departementArchivage || 'Non spécifié';
        docsByDepartment[deptName] = (docsByDepartment[deptName] || 0) + 1;

        // Par utilisateur
        const userName = doc.idUtilisateur || 'Inconnu';
        docsByUser[userName] = (docsByUser[userName] || 0) + 1;
    });

    const totalUsers = state.allUsersForManagement.length || 0;
    const totalCategories = state.categories.length;
    const totalDepartments = state.departements.length;

    return `
        <div class="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4 backdrop-blur-sm"
             onclick="if(event.target === this) toggleAdvancedStats()">
            <div class="modal-glass rounded-2xl p-8 max-w-6xl w-full max-h-[90vh] overflow-y-auto shadow-2xl animate-fade-in" onclick="event.stopPropagation()">
                <h2 class="text-2xl font-bold mb-6 bg-gradient-to-r from-green-600 to-teal-600 bg-clip-text text-transparent">📊 Statistiques avancées</h2>

                <!-- Statistiques générales -->
                <div class="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
                    <div class="bg-gradient-to-br from-blue-500 to-blue-600 p-4 rounded-xl text-white shadow-lg">
                        <p class="text-sm opacity-90">Total Documents</p>
                        <p class="text-3xl font-bold mt-1">${totalDocs}</p>
                    </div>
                    <div class="bg-gradient-to-br from-purple-500 to-purple-600 p-4 rounded-xl text-white shadow-lg">
                        <p class="text-sm opacity-90">Utilisateurs</p>
                        <p class="text-3xl font-bold mt-1">${totalUsers}</p>
                    </div>
                    <div class="bg-gradient-to-br from-green-500 to-green-600 p-4 rounded-xl text-white shadow-lg">
                        <p class="text-sm opacity-90">Catégories</p>
                        <p class="text-3xl font-bold mt-1">${totalCategories}</p>
                    </div>
                    <div class="bg-gradient-to-br from-orange-500 to-orange-600 p-4 rounded-xl text-white shadow-lg">
                        <p class="text-sm opacity-90">Départements</p>
                        <p class="text-3xl font-bold mt-1">${totalDepartments}</p>
                    </div>
                </div>

                <!-- Documents par catégorie -->
                <div class="bg-white p-6 rounded-xl shadow-md mb-6 border-2 border-blue-200">
                    <h3 class="font-bold text-lg mb-4 text-gray-800">📁 Documents par catégorie</h3>
                    <div class="space-y-2">
                        ${Object.entries(docsByCategory).map(([cat, count]) => {
                            const percentage = (count / totalDocs * 100).toFixed(1);
                            return `
                                <div>
                                    <div class="flex justify-between mb-1">
                                        <span class="text-sm font-medium text-gray-700">${cat}</span>
                                        <span class="text-sm font-bold text-gray-900">${count} (${percentage}%)</span>
                                    </div>
                                    <div class="w-full bg-gray-200 rounded-full h-2">
                                        <div class="bg-gradient-to-r from-blue-500 to-blue-600 h-2 rounded-full" style="width: ${percentage}%"></div>
                                    </div>
                                </div>
                            `;
                        }).join('')}
                    </div>
                </div>

                <!-- Documents par département -->
                <div class="bg-white p-6 rounded-xl shadow-md mb-6 border-2 border-green-200">
                    <h3 class="font-bold text-lg mb-4 text-gray-800">🏢 Documents par département</h3>
                    <div class="space-y-2">
                        ${Object.entries(docsByDepartment).map(([dept, count]) => {
                            const percentage = (count / totalDocs * 100).toFixed(1);
                            return `
                                <div>
                                    <div class="flex justify-between mb-1">
                                        <span class="text-sm font-medium text-gray-700">${dept}</span>
                                        <span class="text-sm font-bold text-gray-900">${count} (${percentage}%)</span>
                                    </div>
                                    <div class="w-full bg-gray-200 rounded-full h-2">
                                        <div class="bg-gradient-to-r from-green-500 to-green-600 h-2 rounded-full" style="width: ${percentage}%"></div>
                                    </div>
                                </div>
                            `;
                        }).join('')}
                    </div>
                </div>

                <!-- Documents par utilisateur (top 10) -->
                <div class="bg-white p-6 rounded-xl shadow-md mb-6 border-2 border-purple-200">
                    <h3 class="font-bold text-lg mb-4 text-gray-800">👥 Documents par utilisateur (Top 10)</h3>
                    <div class="space-y-2">
                        ${Object.entries(docsByUser)
                            .sort((a, b) => b[1] - a[1])
                            .slice(0, 10)
                            .map(([user, count]) => {
                                const percentage = (count / totalDocs * 100).toFixed(1);
                                return `
                                    <div>
                                        <div class="flex justify-between mb-1">
                                            <span class="text-sm font-medium text-gray-700">@${user}</span>
                                            <span class="text-sm font-bold text-gray-900">${count} (${percentage}%)</span>
                                        </div>
                                        <div class="w-full bg-gray-200 rounded-full h-2">
                                            <div class="bg-gradient-to-r from-purple-500 to-purple-600 h-2 rounded-full" style="width: ${percentage}%"></div>
                                        </div>
                                    </div>
                                `;
                            }).join('')}
                    </div>
                </div>

                <button onclick="toggleAdvancedStats()" class="w-full px-6 py-3 bg-gradient-to-br from-gray-200 to-gray-300 rounded-xl hover:shadow-md transition font-medium">
                    Fermer
                </button>
            </div>
        </div>
    `;
}

// Exposer les fonctions globalement
window.deleteUser = deleteUser;
window.startEditUser = startEditUser;
window.cancelEditUser = cancelEditUser;
window.saveEditUser = saveEditUser;
window.resetUserPassword = resetUserPassword;
window.addRole = addRole;
window.deleteRole = deleteRole;
window.startEditRole = startEditRole;
window.cancelEditRole = cancelEditRole;
window.saveEditRole = saveEditRole;
window.renderUsersManagement = renderUsersManagement;
window.renderRolesManagement = renderRolesManagement;
window.renderAdvancedStats = renderAdvancedStats;
