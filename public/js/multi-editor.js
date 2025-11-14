// ============================================
// GESTIONNAIRE MULTI-ÉDITEURS - ARCHIVAGE C.E.R.E.R
// ============================================

// Configuration des éditeurs disponibles
const EditorConfig = {
    onlyoffice: {
        name: 'OnlyOffice',
        icon: '📝',
        description: 'Éditeur collaboratif complet (nécessite serveur)',
        supports: ['docx', 'doc', 'xlsx', 'xls', 'pptx', 'ppt', 'odt', 'ods', 'odp'],
        color: 'blue',
        available: false, // Sera vérifié dynamiquement
        priority: 1
    },
    office365: {
        name: 'Microsoft Office Online',
        icon: '🌐',
        description: 'Visualiseur Office officiel Microsoft',
        supports: ['docx', 'doc', 'xlsx', 'xls', 'pptx', 'ppt'],
        color: 'indigo',
        available: true,
        priority: 2
    },
    google: {
        name: 'Google Docs Viewer',
        icon: '📄',
        description: 'Visualiseur Google (nécessite authentification)',
        supports: ['docx', 'doc', 'xlsx', 'xls', 'pptx', 'ppt', 'pdf'],
        color: 'green',
        available: false, // Désactivé car nécessite OAuth2
        priority: 3
    },
    local: {
        name: 'Éditeur Local',
        icon: '⚡',
        description: 'Éditeur intégré rapide (Excel uniquement)',
        supports: ['xlsx', 'xls'],
        color: 'purple',
        available: true,
        priority: 4
    },
    zoho: {
        name: 'Zoho Office',
        icon: '🔷',
        description: 'Suite bureautique Zoho',
        supports: ['docx', 'doc', 'xlsx', 'xls', 'pptx', 'ppt'],
        color: 'red',
        available: true,
        priority: 5
    }
};

// État du gestionnaire multi-éditeurs
const multiEditorState = {
    currentEditor: null,
    currentDoc: null,
    availableEditors: []
};

// Vérifier la disponibilité d'OnlyOffice
async function checkOnlyOfficeAvailability() {
    try {
        if (typeof DocsAPI !== 'undefined') {
            EditorConfig.onlyoffice.available = true;
            return true;
        }

        // Essayer de charger OnlyOffice
        const response = await fetch('https://documentserver.onlyoffice.com/web-apps/apps/api/documents/api.js', {
            method: 'HEAD',
            mode: 'no-cors'
        });

        // Si pas d'erreur, considérer comme disponible
        EditorConfig.onlyoffice.available = true;
        return true;
    } catch (error) {
        console.warn('OnlyOffice non disponible:', error);
        EditorConfig.onlyoffice.available = false;
        return false;
    }
}

// Obtenir les éditeurs compatibles pour un fichier
function getCompatibleEditors(fileName) {
    const ext = fileName.toLowerCase().split('.').pop();

    const compatible = Object.entries(EditorConfig)
        .filter(([key, config]) => {
            return config.available && config.supports.includes(ext);
        })
        .sort((a, b) => a[1].priority - b[1].priority)
        .map(([key, config]) => ({
            id: key,
            ...config
        }));

    return compatible;
}

// Afficher le menu de sélection d'éditeur
async function showEditorSelector(doc) {
    // Vérifier OnlyOffice au préalable
    await checkOnlyOfficeAvailability();

    const compatibleEditors = getCompatibleEditors(doc.nomFichier);

    if (compatibleEditors.length === 0) {
        showNotification('Aucun éditeur disponible pour ce type de fichier', 'error');
        return;
    }

    // Si un seul éditeur disponible, l'ouvrir directement
    if (compatibleEditors.length === 1) {
        openWithEditor(doc, compatibleEditors[0].id);
        return;
    }

    // Créer le modal de sélection
    const modal = document.createElement('div');
    modal.id = 'editor-selector-modal';
    modal.className = 'fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-75';

    modal.innerHTML = `
        <div class="bg-white rounded-lg max-w-2xl w-full mx-4 max-h-[90vh] overflow-auto">
            <!-- Header -->
            <div class="bg-gradient-to-r from-blue-500 to-purple-600 p-6 text-white">
                <h2 class="text-2xl font-bold mb-2">Choisir un éditeur</h2>
                <p class="text-blue-100 text-sm">${doc.nomFichier}</p>
            </div>

            <!-- Éditeurs disponibles -->
            <div class="p-6">
                <p class="text-gray-600 mb-4">
                    Plusieurs éditeurs sont disponibles pour ce fichier. Choisissez celui qui vous convient :
                </p>

                <div class="space-y-3">
                    ${compatibleEditors.map(editor => `
                        <button
                            class="editor-option w-full text-left p-4 border-2 rounded-lg hover:border-${editor.color}-500 hover:bg-${editor.color}-50 transition-all group"
                            data-editor="${editor.id}"
                        >
                            <div class="flex items-center gap-4">
                                <div class="text-4xl">${editor.icon}</div>
                                <div class="flex-1">
                                    <div class="flex items-center gap-2 mb-1">
                                        <h3 class="text-lg font-bold text-gray-800">${editor.name}</h3>
                                        ${editor.id === 'onlyoffice' && editor.available ?
                                            '<span class="px-2 py-0.5 bg-green-100 text-green-700 text-xs rounded">✓ Disponible</span>' :
                                            editor.id === 'onlyoffice' ?
                                            '<span class="px-2 py-0.5 bg-red-100 text-red-700 text-xs rounded">✗ Non disponible</span>' :
                                            ''
                                        }
                                        ${editor.priority === 1 ?
                                            '<span class="px-2 py-0.5 bg-blue-100 text-blue-700 text-xs rounded">Recommandé</span>' :
                                            ''
                                        }
                                    </div>
                                    <p class="text-sm text-gray-600">${editor.description}</p>
                                </div>
                                <div class="text-${editor.color}-500 opacity-0 group-hover:opacity-100 transition-opacity">
                                    <svg class="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
                                    </svg>
                                </div>
                            </div>
                        </button>
                    `).join('')}
                </div>

                <!-- Info supplémentaire -->
                <div class="mt-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
                    <div class="flex items-start gap-3">
                        <div class="text-2xl">💡</div>
                        <div class="flex-1 text-sm">
                            <p class="font-semibold text-blue-900 mb-1">Conseils de choix :</p>
                            <ul class="text-blue-800 space-y-1">
                                <li><strong>OnlyOffice</strong> : Meilleur pour l'édition complète (si disponible)</li>
                                <li><strong>Office Online</strong> : Fidélité Microsoft, visualisation excellente</li>
                                <li><strong>Éditeur Local</strong> : Le plus rapide pour Excel</li>
                                <li><strong>Google Viewer</strong> : Fiable mais lecture seule</li>
                            </ul>
                        </div>
                    </div>
                </div>
            </div>

            <!-- Footer -->
            <div class="bg-gray-50 px-6 py-4 border-t flex items-center justify-between">
                <button
                    id="preview-instead-btn"
                    class="px-4 py-2 text-gray-600 hover:text-gray-800 transition"
                >
                    👁️ Juste prévisualiser
                </button>
                <button
                    id="close-selector-btn"
                    class="px-6 py-2 bg-gray-500 text-white rounded hover:bg-gray-600 transition"
                >
                    Annuler
                </button>
            </div>
        </div>
    `;

    document.body.appendChild(modal);

    // Gérer la sélection d'éditeur
    modal.querySelectorAll('.editor-option').forEach(btn => {
        btn.addEventListener('click', () => {
            const editorId = btn.dataset.editor;
            modal.remove();
            openWithEditor(doc, editorId);
        });
    });

    // Bouton prévisualiser
    modal.querySelector('#preview-instead-btn').addEventListener('click', () => {
        modal.remove();
        if (typeof openPreview === 'function') {
            openPreview(doc);
        }
    });

    // Bouton annuler
    modal.querySelector('#close-selector-btn').addEventListener('click', () => {
        modal.remove();
    });

    // Fermer en cliquant à l'extérieur
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            modal.remove();
        }
    });
}

// Ouvrir avec l'éditeur choisi
async function openWithEditor(doc, editorId) {
    multiEditorState.currentEditor = editorId;
    multiEditorState.currentDoc = doc;

    console.log(`📝 Ouverture avec ${EditorConfig[editorId].name}`);

    try {
        switch (editorId) {
            case 'onlyoffice':
                await openOnlyOfficeEditor(doc);
                break;

            case 'office365':
                openOffice365Editor(doc);
                break;

            case 'google':
                openGoogleEditor(doc);
                break;

            case 'local':
                openLocalEditor(doc);
                break;

            case 'zoho':
                openZohoEditor(doc);
                break;

            default:
                showNotification('Éditeur non implémenté', 'error');
        }
    } catch (error) {
        console.error(`Erreur avec ${editorId}:`, error);
        showNotification(`Erreur lors de l'ouverture avec ${EditorConfig[editorId].name}`, 'error');
    }
}

// ============================================
// ÉDITEUR MICROSOFT OFFICE 365
// ============================================
function openOffice365Editor(doc) {
    const modal = createEditorModal('office365', doc);

    const fileUrl = `${window.location.origin}/api/office-file/${state.currentUser}/${doc._id}`;
    const encodedUrl = encodeURIComponent(fileUrl);

    // Microsoft Office Online Viewer
    const viewerUrl = `https://view.officeapps.live.com/op/embed.aspx?src=${encodedUrl}`;

    const container = modal.querySelector('.editor-container');
    container.innerHTML = `
        <div class="h-full flex flex-col">
            <div class="bg-blue-50 border-b p-3">
                <div class="flex items-center gap-2 text-sm">
                    <span class="text-blue-800 font-medium">🌐 Microsoft Office Online</span>
                    <span class="text-gray-400">•</span>
                    <span class="text-gray-600">Visualisation fidèle au format Office</span>
                </div>
            </div>
            <iframe
                src="${viewerUrl}"
                class="flex-1 w-full border-0"
                frameborder="0"
            ></iframe>
            <div class="bg-gray-100 border-t p-2 text-center text-xs text-gray-600">
                💡 Visualisation via Microsoft Office Online
            </div>
        </div>
    `;
}

// ============================================
// ÉDITEUR GOOGLE DOCS/SHEETS/SLIDES
// ============================================
function openGoogleEditor(doc) {
    const modal = createEditorModal('google', doc);

    const container = modal.querySelector('.editor-container');
    container.innerHTML = `
        <div class="h-full flex flex-col items-center justify-center bg-gradient-to-br from-red-50 to-orange-50 p-8">
            <div class="max-w-md text-center">
                <div class="text-6xl mb-4">🔒</div>
                <h3 class="text-xl font-bold text-gray-800 mb-2">
                    Google Docs Viewer non disponible
                </h3>
                <p class="text-gray-600 mb-4">
                    Google nécessite maintenant une authentification OAuth2 pour utiliser leur visualiseur.
                </p>
                <div class="bg-blue-50 border border-blue-200 rounded p-4 text-sm text-left mb-6">
                    <p class="font-semibold text-blue-800 mb-2">💡 Alternatives disponibles :</p>
                    <ul class="text-blue-700 space-y-1">
                        <li>• <strong>Microsoft Office Online</strong> : Visualisation fidèle</li>
                        <li>• <strong>Zoho Office</strong> : Visualisation fiable</li>
                        <li>• <strong>Éditeur Local</strong> : Édition Excel rapide</li>
                    </ul>
                </div>
                <button
                    onclick="document.getElementById('google-editor-modal').remove(); showEditorSelector(multiEditorState.currentDoc)"
                    class="px-6 py-3 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition"
                >
                    🔄 Choisir un autre éditeur
                </button>
            </div>
        </div>
    `;
}

// ============================================
// ÉDITEUR LOCAL (Excel)
// ============================================
function openLocalEditor(doc) {
    const ext = doc.nomFichier.toLowerCase().split('.').pop();

    if (ext === 'xlsx' || ext === 'xls') {
        // Initialiser l'état de l'éditeur (requis pour openExcelEditor)
        if (typeof editorState !== 'undefined') {
            editorState.isOpen = true;
            editorState.currentDoc = doc;
            editorState.docType = 'excel';
            editorState.changes = {};
        }

        // Utiliser l'éditeur Excel existant
        if (typeof openExcelEditor === 'function') {
            openExcelEditor(doc);
        } else {
            showNotification('Éditeur Excel local non disponible', 'error');
        }
    } else {
        showNotification('Éditeur local disponible uniquement pour Excel', 'error');
    }
}

// ============================================
// ÉDITEUR ZOHO OFFICE
// ============================================
function openZohoEditor(doc) {
    const modal = createEditorModal('zoho', doc);

    const fileUrl = `${window.location.origin}/api/office-file/${state.currentUser}/${doc._id}`;
    const encodedUrl = encodeURIComponent(fileUrl);

    // Zoho Office Viewer
    const viewerUrl = `https://viewer.zoho.com/api/urlview.do?url=${encodedUrl}&embed=true`;

    const container = modal.querySelector('.editor-container');
    container.innerHTML = `
        <div class="h-full flex flex-col">
            <div class="bg-red-50 border-b p-3">
                <div class="flex items-center gap-2 text-sm">
                    <span class="text-red-800 font-medium">🔷 Zoho Office Viewer</span>
                    <span class="text-gray-400">•</span>
                    <span class="text-gray-600">Visualisation en ligne</span>
                </div>
            </div>
            <iframe
                src="${viewerUrl}"
                class="flex-1 w-full border-0"
                frameborder="0"
            ></iframe>
            <div class="bg-gray-100 border-t p-2 text-center text-xs text-gray-600">
                💡 Visualisation via Zoho Office
            </div>
        </div>
    `;
}

// ============================================
// UTILITAIRES
// ============================================

// Créer un modal d'éditeur générique
function createEditorModal(editorId, doc) {
    const config = EditorConfig[editorId];

    const modal = document.createElement('div');
    modal.id = `${editorId}-editor-modal`;
    modal.className = 'fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-75';

    modal.innerHTML = `
        <div class="bg-white rounded-lg w-11/12 h-5/6 flex flex-col">
            <div class="flex items-center justify-between p-4 border-b bg-gradient-to-r from-${config.color}-500 to-${config.color}-600">
                <div class="flex-1 min-w-0">
                    <h2 class="text-xl font-bold text-white truncate">
                        ${config.icon} ${config.name}
                    </h2>
                    <p class="text-sm text-${config.color}-100 truncate">${doc.titre}</p>
                </div>
                <div class="flex items-center gap-2 ml-4">
                    <button
                        class="download-btn px-4 py-2 bg-white text-${config.color}-600 rounded hover:bg-gray-100 transition"
                    >
                        📥 Télécharger
                    </button>
                    <button
                        class="change-editor-btn px-4 py-2 bg-yellow-500 text-white rounded hover:bg-yellow-600 transition"
                    >
                        🔄 Changer d'éditeur
                    </button>
                    <button
                        class="close-btn px-4 py-2 bg-gray-500 text-white rounded hover:bg-gray-600 transition"
                    >
                        ✕ Fermer
                    </button>
                </div>
            </div>

            <div class="editor-container flex-1 overflow-hidden bg-gray-100"></div>
        </div>
    `;

    document.body.appendChild(modal);

    // Bouton télécharger
    modal.querySelector('.download-btn').addEventListener('click', () => {
        if (typeof downloadDoc === 'function') {
            downloadDoc(doc);
        }
    });

    // Bouton changer d'éditeur
    modal.querySelector('.change-editor-btn').addEventListener('click', () => {
        modal.remove();
        showEditorSelector(doc);
    });

    // Bouton fermer
    modal.querySelector('.close-btn').addEventListener('click', () => {
        modal.remove();
    });

    // Fermer en cliquant à l'extérieur
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            modal.remove();
        }
    });

    return modal;
}

// Fonction pour remplacer openEditor par défaut
function openEditor(doc) {
    showEditorSelector(doc);
}

console.log('✅ Gestionnaire multi-éditeurs chargé');
console.log('📝 Éditeurs disponibles:', Object.keys(EditorConfig).join(', '));
