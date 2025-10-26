// ============================================
// GESTION DES DOCUMENTS - ARCHIVAGE C.E.R.E.R
// ============================================

// Charger tous les documents et catégories
async function loadData() {
    if (!state.currentUser) return;

    try {
        state.loading = true;
        render();

        const docs = await getDocuments(state.currentUser, false);
        state.documents = docs;

        const cats = await getCategories(state.currentUser);
        state.categories = cats;

        state.storageInfo = calculateStorageUsage(state.documents);

        state.loading = false;
        render();
    } catch (error) {
        state.loading = false;
        render();
    }
}

// Sauvegarder un document
async function saveDocument(doc) {
    try {
        const result = await createDocument(state.currentUser, doc);
        
        if (result.success) {
            await loadData();
            return result.document;
        }
    } catch (error) {
        // Erreur déjà gérée par apiCall
    }
}

// Supprimer un document
async function deleteDoc(id) {
    if (!confirm('Êtes-vous sûr de vouloir supprimer ce document?')) {
        return;
    }

    try {
        await deleteDocument(state.currentUser, id);
        state.selectedDoc = null;
        await loadData();
        showNotification('Document supprimé avec succès');
    } catch (error) {
        // Erreur déjà gérée par apiCall
    }
}

// Supprimer tous les documents
async function deleteAllDocuments() {
    const count = state.documents.length;
    
    if (count === 0) {
        showNotification('Aucun document à supprimer', 'error');
        return;
    }

    if (!confirm(`⚠️ ATTENTION ⚠️\n\nVous allez supprimer ${count} document(s)!\n\nCette action est IRRÉVERSIBLE.\n\nContinuer?`)) {
        return;
    }

    if (!confirm(`🚨 DERNIÈRE CONFIRMATION 🚨\n\nTOUS vos ${count} documents seront DÉFINITIVEMENT supprimés!\n\nÊtes-vous VRAIMENT sûr(e)?`)) {
        return;
    }

    try {
        const result = await deleteAllDocuments(state.currentUser);
        await loadData();
        state.showMenu = false;
        showNotification(`✅ ${result.deletedCount} document(s) supprimé(s)!`);
    } catch (error) {
        showNotification('Erreur lors de la suppression', 'error');
    }
}

// Télécharger un document
async function downloadDoc(doc) {
    try {
        const fullDoc = await getDocument(state.currentUser, doc._id);
        const link = document.createElement('a');
        link.href = fullDoc.contenu;
        link.download = fullDoc.nomFichier;
        link.click();
        showNotification('Téléchargement en cours...');
    } catch (error) {
        // Erreur déjà gérée par apiCall
    }
}

// Gérer l'upload de fichier
async function handleFileUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!formData.titre.trim()) {
        showNotification('Titre requis', 'error');
        e.target.value = '';
        return;
    }

    if (file.size > 50 * 1024 * 1024) {
        showNotification('Fichier trop volumineux (max 50 MB)', 'error');
        e.target.value = '';
        return;
    }

    showNotification('📤 Traitement du fichier...', 'warning');

    try {
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
        
        // Réinitialiser le formulaire
        formData = {
            titre: '',
            categorie: 'factures',
            date: new Date().toISOString().split('T')[0],
            description: '',
            tags: ''
        };

        showNotification('✅ Document ajouté avec succès!');
        render();
        e.target.value = '';
    } catch (error) {
        e.target.value = '';
    }
}

// Exporter les données
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

    showNotification('✅ Données exportées avec succès');
}

// Importer les données
async function importData(e) {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 100 * 1024 * 1024) {
        showNotification('Fichier trop volumineux (max 100 MB)', 'error');
        e.target.value = '';
        return;
    }

    const reader = new FileReader();
    reader.onload = async (event) => {
        try {
            const imported = JSON.parse(event.target.result);
            const docs = Array.isArray(imported) ? imported : imported.documents || [];

            if (docs.length === 0) {
                showNotification('Aucun document trouvé dans le fichier', 'error');
                return;
            }

            if (docs.length > 1000) {
                showNotification('Trop de documents (max 1000)', 'error');
                return;
            }

            if (!confirm(`Importer ${docs.length} document(s)?`)) {
                return;
            }

            state.importProgress = {
                show: true,
                current: 0,
                total: docs.length,
                message: 'Import en cours...'
            };
            render();

            const result = await bulkImportDocuments(state.currentUser, docs);
            await loadData();

            state.importProgress = {
                show: false,
                current: 0,
                total: 0,
                message: ''
            };

            showNotification(`✅ ${result.insertedCount} document(s) importé(s)!`);
        } catch (error) {
            state.importProgress = {
                show: false,
                current: 0,
                total: 0,
                message: ''
            };
            showNotification('Erreur lors de l\'import', 'error');
        }
    };
    reader.readAsText(file);
    e.target.value = '';
}

// Filtrer les documents
function getFilteredDocs() {
    return state.documents.filter(doc => {
        const matchSearch = !state.searchTerm || 
            doc.titre.toLowerCase().includes(state.searchTerm.toLowerCase());
        const matchCategory = state.selectedCategory === 'tous' || 
            doc.categorie === state.selectedCategory;
        return matchSearch && matchCategory;
    });
}

// Afficher les détails d'un document
function showDocDetail(id) {
    state.selectedDoc = state.documents.find(d => d._id === id);
    render();
}

// Fermer les détails du document
function closeDocDetail() {
    state.selectedDoc = null;
    render();
}

// Basculer le formulaire d'upload
function toggleUploadForm() {
    state.showUploadForm = !state.showUploadForm;
    state.showCategories = false;
    render();
}

// Mettre à jour les données du formulaire
function updateFormData(field, value) {
    formData[field] = value;
}

// Mettre à jour la recherche temporaire
function updateTempSearch(value) {
    state.tempSearchTerm = value;
}

// Mettre à jour la catégorie temporaire
function updateTempCategory(value) {
    state.tempSelectedCategory = value;
}

// Appliquer les filtres
function applyFilters() {
    state.searchTerm = state.tempSearchTerm;
    state.selectedCategory = state.tempSelectedCategory;
    render();
}

// Réinitialiser les filtres
function resetFilters() {
    state.searchTerm = '';
    state.selectedCategory = 'tous';
    state.tempSearchTerm = '';
    state.tempSelectedCategory = 'tous';
    render();
}

// Basculer le menu
function toggleMenu() {
    state.showMenu = !state.showMenu;
    render();
}