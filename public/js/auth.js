// ============================================
// GESTION AUTHENTIFICATION - ARCHIVAGE C.E.R.E.R
// ============================================

// Connexion
async function login(username, password) {
    try {
        const result = await loginUser(username, password);
        
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

// Inscription
async function register(username, password, nom, email, idRole, idDepartement, adminPassword) {
    if (adminPassword !== '0811') {
        showNotification('Mot de passe admin incorrect', 'error');
        return false;
    }

    try {
        const result = await registerUser(username, password, nom, email, idRole, idDepartement);

        if (result.success) {
            showNotification('✅ Compte créé avec succès!');
            return true;
        }
    } catch (error) {
        return false;
    }
}

// Déconnexion
async function logout() {
    const confirmed = await customConfirm({
        title: 'Déconnexion',
        message: 'Voulez-vous vraiment vous déconnecter ?',
        confirmText: 'Oui, me déconnecter',
        cancelText: 'Annuler',
        type: 'warning',
        icon: '🚪'
    });

    if (confirmed) {
        state.currentUser = null;
        state.isAuthenticated = false;
        state.documents = [];
        state.categories = [];
        showNotification('✅ Déconnexion réussie');
        render();
    }
}

// Gestion du formulaire de connexion
async function handleLogin() {
    const username = document.getElementById('login_username').value.trim();
    const password = document.getElementById('login_password').value;

    if (!username || !password) {
        showNotification('Veuillez remplir tous les champs', 'error');
        return;
    }

    await login(username, password);
}

// Gestion du formulaire d'inscription
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
        showNotification('Veuillez remplir tous les champs', 'error');
        return;
    }

    if (username.length < 3 || password.length < 4) {
        showNotification('Username: 3+ caractères, Password: 4+ caractères', 'error');
        return;
    }

    if (password !== passwordConfirm) {
        showNotification('Les mots de passe ne correspondent pas', 'error');
        return;
    }

    const success = await register(username, password, nom, email, idRole, idDepartement, adminPassword);
    if (success) {
        state.showRegister = false;
        render();
    }
}

// Basculer vers le formulaire d'inscription
function toggleRegister() {
    state.showRegister = !state.showRegister;
    render();
}