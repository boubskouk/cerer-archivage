// ============================================
// SYSTÈME D'ÉDITION DE DOCUMENTS - ARCHIVAGE C.E.R.E.R
// ============================================

// État de l'éditeur
const editorState = {
    isOpen: false,
    currentDoc: null,
    docType: null,
    excelData: null,
    changes: {}
};

// Déterminer si un document est éditable
function isEditable(doc) {
    if (!doc.type && !doc.nomFichier) return false;

    const ext = doc.nomFichier ? doc.nomFichier.toLowerCase().split('.').pop() : '';
    const type = doc.type || '';

    // Excel moderne → Éditeur intégré
    if (type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' || ext === 'xlsx') {
        return 'excel';
    }

    // Excel ancien → OnlyOffice (ExcelJS ne supporte pas .xls)
    if (type === 'application/vnd.ms-excel' || ext === 'xls') {
        return 'excel-old';
    }

    // Word (moderne et ancien) → OnlyOffice
    if (type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || ext === 'docx' ||
        type === 'application/msword' || ext === 'doc') {
        return 'word';
    }

    // PowerPoint (moderne et ancien) → OnlyOffice
    if (type === 'application/vnd.openxmlformats-officedocument.presentationml.presentation' || ext === 'pptx' ||
        type === 'application/vnd.ms-powerpoint' || ext === 'ppt') {
        return 'powerpoint';
    }

    return false;
}

// Ouvrir l'éditeur
async function openEditor(doc) {
    const editableType = isEditable(doc);

    if (!editableType) {
        showNotification('Ce type de fichier ne peut pas être édité', 'error');
        return;
    }

    editorState.isOpen = true;
    editorState.currentDoc = doc;
    editorState.docType = editableType;
    editorState.changes = {};

    if (editableType === 'excel') {
        // Excel moderne (.xlsx) → Éditeur intégré
        await openExcelEditor(doc);
    } else if (editableType === 'excel-old' || editableType === 'word' || editableType === 'powerpoint') {
        // Excel ancien (.xls), Word, PowerPoint → OnlyOffice
        await openWordEditor(doc);
    }
}

// ============================================
// ÉDITEUR EXCEL
// ============================================

async function openExcelEditor(doc) {
    try {
        // Récupérer les données du fichier Excel
        const response = await apiCall(`/office/read-excel/${doc._id}`);

        if (!response.success) {
            showNotification('Erreur lors de la lecture du fichier', 'error');
            return;
        }

        editorState.excelData = response.data;

        // Créer le modal d'édition
        const modal = document.createElement('div');
        modal.id = 'editor-modal';
        modal.className = 'fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-75';

        modal.innerHTML = `
            <div class="bg-white rounded-lg w-11/12 h-5/6 flex flex-col">
                <!-- Header -->
                <div class="flex items-center justify-between p-4 border-b bg-blue-50">
                    <div class="flex-1 min-w-0">
                        <h2 class="text-xl font-bold truncate">📝 Édition: ${doc.titre}</h2>
                        <p class="text-sm text-gray-600 truncate">${doc.nomFichier} • ${response.rows} lignes</p>
                    </div>
                    <div class="flex items-center gap-2 ml-4">
                        <button
                            id="save-excel-btn"
                            class="px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600 flex items-center gap-2"
                        >
                            <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
                            </svg>
                            Enregistrer
                        </button>
                        <button
                            id="close-editor-btn"
                            class="px-4 py-2 bg-gray-500 text-white rounded hover:bg-gray-600"
                        >
                            ✕ Fermer
                        </button>
                    </div>
                </div>

                <!-- Instructions -->
                <div class="p-3 bg-yellow-50 border-b text-sm">
                    <p class="text-yellow-800">
                        💡 <strong>Instructions:</strong> Cliquez sur une cellule pour la modifier. Les cellules modifiées sont surlignées en jaune.
                    </p>
                </div>

                <!-- Contenu éditeur -->
                <div id="excel-editor-content" class="flex-1 overflow-auto p-4 bg-gray-50">
                    <div class="bg-white shadow-lg rounded">
                        ${renderExcelTable(response.data)}
                    </div>
                </div>

                <!-- Footer avec compteur -->
                <div class="p-3 border-t bg-gray-50 flex items-center justify-between">
                    <span id="changes-counter" class="text-sm text-gray-600">
                        Aucune modification
                    </span>
                    <span class="text-xs text-gray-500">
                        Cliquez sur "Enregistrer" pour appliquer les modifications
                    </span>
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        // Activer l'édition des cellules
        initExcelCellEditing();

        // Gérer l'enregistrement
        document.getElementById('save-excel-btn').addEventListener('click', saveExcelChanges);

        // Gérer la fermeture
        document.getElementById('close-editor-btn').addEventListener('click', closeEditor);

        // Fermer avec Échap
        document.addEventListener('keydown', handleEditorEscape);

    } catch (error) {
        console.error('Erreur ouverture éditeur Excel:', error);
        showNotification('Erreur lors de l\'ouverture de l\'éditeur', 'error');
    }
}

// Rendre le tableau Excel
function renderExcelTable(data) {
    if (!data || data.length === 0) {
        return '<p class="p-4 text-gray-500">Aucune donnée</p>';
    }

    let html = '<table class="excel-table min-w-full border-collapse">';

    data.forEach((row, rowIndex) => {
        html += '<tr>';
        row.forEach((cell, colIndex) => {
            const cellRef = columnToLetter(colIndex) + (rowIndex + 1);
            const cellValue = cell !== null && cell !== undefined ? String(cell) : '';
            const isFirstRow = rowIndex === 0;

            html += `
                <td
                    data-cell="${cellRef}"
                    data-row="${rowIndex}"
                    data-col="${colIndex}"
                    class="excel-cell border border-gray-300 px-3 py-2 min-w-[100px] ${isFirstRow ? 'bg-blue-50 font-semibold' : 'bg-white'}"
                    contenteditable="true"
                    title="Cellule ${cellRef}"
                >${cellValue}</td>
            `;
        });
        html += '</tr>';
    });

    html += '</table>';
    return html;
}

// Convertir numéro de colonne en lettre (0 -> A, 1 -> B, etc.)
function columnToLetter(col) {
    let letter = '';
    while (col >= 0) {
        letter = String.fromCharCode((col % 26) + 65) + letter;
        col = Math.floor(col / 26) - 1;
    }
    return letter;
}

// Initialiser l'édition des cellules
function initExcelCellEditing() {
    const cells = document.querySelectorAll('.excel-cell');

    cells.forEach(cell => {
        // Sauvegarder la valeur initiale
        cell.dataset.originalValue = cell.textContent;

        // Détecter les modifications
        cell.addEventListener('input', function() {
            const cellRef = this.dataset.cell;
            const newValue = this.textContent;
            const originalValue = this.dataset.originalValue;

            if (newValue !== originalValue) {
                // Marquer comme modifié
                this.classList.add('bg-yellow-100');

                // Enregistrer la modification
                editorState.changes[cellRef] = newValue;
            } else {
                // Retirer le marquage
                this.classList.remove('bg-yellow-100');
                delete editorState.changes[cellRef];
            }

            updateChangesCounter();
        });

        // Sélectionner tout le texte au focus
        cell.addEventListener('focus', function() {
            const range = document.createRange();
            range.selectNodeContents(this);
            const selection = window.getSelection();
            selection.removeAllRanges();
            selection.addRange(range);
        });
    });
}

// Mettre à jour le compteur de modifications
function updateChangesCounter() {
    const counter = document.getElementById('changes-counter');
    const count = Object.keys(editorState.changes).length;

    if (count === 0) {
        counter.textContent = 'Aucune modification';
        counter.className = 'text-sm text-gray-600';
    } else {
        counter.textContent = `${count} cellule${count > 1 ? 's' : ''} modifiée${count > 1 ? 's' : ''}`;
        counter.className = 'text-sm text-yellow-600 font-semibold';
    }
}

// Enregistrer les modifications Excel
async function saveExcelChanges() {
    const changeCount = Object.keys(editorState.changes).length;

    if (changeCount === 0) {
        showNotification('Aucune modification à enregistrer', 'warning');
        return;
    }

    try {
        // Désactiver le bouton
        const saveBtn = document.getElementById('save-excel-btn');
        saveBtn.disabled = true;
        saveBtn.innerHTML = '<span>⏳ Enregistrement...</span>';

        // Envoyer les modifications
        const response = await apiCall(`/office/edit-excel/${editorState.currentDoc._id}`, 'POST', {
            cellUpdates: editorState.changes
        });

        if (response.success) {
            showNotification(`✅ ${changeCount} cellule${changeCount > 1 ? 's' : ''} mise${changeCount > 1 ? 's' : ''} à jour!`);

            // Réinitialiser l'état
            editorState.changes = {};

            // Retirer les marquages jaunes
            document.querySelectorAll('.excel-cell').forEach(cell => {
                cell.classList.remove('bg-yellow-100');
                cell.dataset.originalValue = cell.textContent;
            });

            updateChangesCounter();

            // Recharger les données après une courte pause
            setTimeout(() => {
                closeEditor();
                loadData(); // Recharger la liste des documents
            }, 1500);
        } else {
            showNotification('Erreur lors de l\'enregistrement', 'error');
            saveBtn.disabled = false;
            saveBtn.innerHTML = `
                <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
                </svg>
                Enregistrer
            `;
        }

    } catch (error) {
        console.error('Erreur enregistrement:', error);
        showNotification('Erreur lors de l\'enregistrement', 'error');
    }
}

// ============================================
// ÉDITEUR WORD ET OFFICE (Office Online)
// ============================================

// Détecter si l'application est en ligne ou en local
function isOnlineDeployment() {
    const hostname = window.location.hostname;
    // En local: localhost, 127.0.0.1, ou IP locale
    return hostname !== 'localhost' &&
           hostname !== '127.0.0.1' &&
           !hostname.startsWith('192.168.') &&
           !hostname.startsWith('10.') &&
           !hostname.startsWith('172.');
}

async function openWordEditor(doc) {
    // NOUVELLE APPROCHE: Utiliser OnlyOffice pour Word et PowerPoint
    // OnlyOffice fonctionne sans WOPI (contrairement à Office Online)

    // Vérifier si OnlyOffice est disponible
    if (typeof openOnlyOfficeEditor === 'function') {
        // Utiliser OnlyOffice pour l'édition
        await openOnlyOfficeEditor(doc);
    } else {
        // Fallback: Guide de téléchargement si OnlyOffice n'est pas chargé
        console.warn('⚠️ OnlyOffice non disponible, affichage du guide de téléchargement');
        await openLocalWordEditor(doc);
    }
}

// Éditeur Office Online (pour déploiement en ligne)
async function openOfficeOnlineEditor(doc) {
    const modal = document.createElement('div');
    modal.id = 'editor-modal';
    modal.className = 'fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-75';

    // Construire l'URL publique du fichier
    const baseUrl = window.location.origin;
    const fileUrl = `${baseUrl}/api/office-file/${state.currentUser}/${doc._id}`;

    // Encoder l'URL pour Office Online
    const encodedUrl = encodeURIComponent(fileUrl);

    // URL Office Online pour édition
    const officeOnlineUrl = `https://view.officeapps.live.com/op/edit.aspx?src=${encodedUrl}`;

    modal.innerHTML = `
        <div class="bg-white rounded-lg w-11/12 h-5/6 flex flex-col">
            <div class="flex items-center justify-between p-4 border-b bg-blue-50">
                <div class="flex-1 min-w-0">
                    <h2 class="text-xl font-bold truncate">📝 Édition Office Online: ${doc.titre}</h2>
                    <p class="text-sm text-gray-600 truncate">${doc.nomFichier}</p>
                </div>
                <div class="flex items-center gap-2 ml-4">
                    <button
                        id="save-office-btn"
                        class="px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600"
                        title="Les modifications sont automatiquement sauvegardées par Office Online"
                    >
                        ℹ️ Auto-sauvegarde
                    </button>
                    <button
                        id="close-editor-btn"
                        class="px-4 py-2 bg-gray-500 text-white rounded hover:bg-gray-600"
                    >
                        ✕ Fermer
                    </button>
                </div>
            </div>

            <div class="p-3 bg-green-50 border-b text-sm">
                <p class="text-green-800">
                    ✅ <strong>Office Online activé!</strong> Éditez votre document directement dans le navigateur.
                    Les modifications sont automatiquement sauvegardées.
                </p>
            </div>

            <div class="flex-1 overflow-hidden">
                <iframe
                    id="office-iframe"
                    src="${officeOnlineUrl}"
                    width="100%"
                    height="100%"
                    frameborder="0"
                    style="border: none;"
                ></iframe>
            </div>

            <div class="p-3 border-t bg-gray-50 text-center text-xs text-gray-600">
                Propulsé par Microsoft Office Online
            </div>
        </div>
    `;

    document.body.appendChild(modal);

    // Info auto-sauvegarde
    document.getElementById('save-office-btn').addEventListener('click', () => {
        showNotification('💡 Office Online sauvegarde automatiquement vos modifications', 'info');
    });

    document.getElementById('close-editor-btn').addEventListener('click', () => {
        if (confirm('Fermer l\'éditeur Office Online? Les modifications sont déjà sauvegardées.')) {
            closeEditor();
            loadData(); // Recharger pour voir les changements
        }
    });

    document.addEventListener('keydown', handleEditorEscape);
}

// Éditeur local (localhost - guide de téléchargement)
async function openLocalWordEditor(doc) {
    const modal = document.createElement('div');
    modal.id = 'editor-modal';
    modal.className = 'fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-75';

    modal.innerHTML = `
        <div class="bg-white rounded-lg w-11/12 max-w-2xl flex flex-col">
            <div class="flex items-center justify-between p-4 border-b bg-blue-50">
                <div class="flex-1 min-w-0">
                    <h2 class="text-xl font-bold truncate">📝 Édition Word: ${doc.titre}</h2>
                    <p class="text-sm text-gray-600 truncate">${doc.nomFichier}</p>
                </div>
                <button
                    id="close-editor-btn"
                    class="px-4 py-2 bg-gray-500 text-white rounded hover:bg-gray-600"
                >
                    ✕ Fermer
                </button>
            </div>

            <div class="p-6">
                <div class="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-4">
                    <p class="text-yellow-800 text-sm mb-2">
                        ℹ️ <strong>Mode Local - Édition hors ligne</strong>
                    </p>
                    <p class="text-yellow-700 text-sm">
                        Pour éditer ce document en local, suivez ces étapes:
                    </p>
                </div>

                <div class="space-y-3">
                    <button
                        onclick="downloadDoc(editorState.currentDoc)"
                        class="w-full px-4 py-3 bg-blue-500 text-white rounded hover:bg-blue-600 flex items-center justify-center gap-2"
                    >
                        <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                        </svg>
                        1. Télécharger le document
                    </button>

                    <div class="text-center text-gray-600 text-sm">
                        ↓
                    </div>

                    <div class="px-4 py-3 bg-gray-100 rounded text-center">
                        <p class="text-gray-700 text-sm">
                            2. Éditer avec Microsoft Word ou LibreOffice
                        </p>
                    </div>

                    <div class="text-center text-gray-600 text-sm">
                        ↓
                    </div>

                    <div class="px-4 py-3 bg-gray-100 rounded text-center">
                        <p class="text-gray-700 text-sm">
                            3. Re-téléverser le document modifié dans l'application
                        </p>
                    </div>
                </div>

                <div class="mt-6 p-4 bg-blue-50 border border-blue-200 rounded">
                    <p class="text-blue-800 text-sm mb-2">
                        🚀 <strong>Bonne nouvelle!</strong>
                    </p>
                    <p class="text-blue-700 text-sm">
                        Une fois que vous déployerez cette application en ligne (sur un serveur web),
                        vous pourrez éditer vos documents Word et Excel directement dans le navigateur
                        grâce à <strong>Microsoft Office Online</strong>!
                    </p>
                </div>
            </div>
        </div>
    `;

    document.body.appendChild(modal);

    document.getElementById('close-editor-btn').addEventListener('click', closeEditor);
    document.addEventListener('keydown', handleEditorEscape);
}

// Gérer la touche Échap
function handleEditorEscape(e) {
    if (e.key === 'Escape' && editorState.isOpen) {
        const changeCount = Object.keys(editorState.changes).length;

        if (changeCount > 0) {
            if (confirm(`Vous avez ${changeCount} modification${changeCount > 1 ? 's' : ''} non enregistrée${changeCount > 1 ? 's' : ''}.\n\nVoulez-vous vraiment fermer sans enregistrer?`)) {
                closeEditor();
            }
        } else {
            closeEditor();
        }
    }
}

// Fermer l'éditeur
function closeEditor() {
    const modal = document.getElementById('editor-modal');
    if (modal) {
        modal.remove();
    }

    editorState.isOpen = false;
    editorState.currentDoc = null;
    editorState.docType = null;
    editorState.excelData = null;
    editorState.changes = {};

    document.removeEventListener('keydown', handleEditorEscape);
}

// Style pour le tableau Excel
const style = document.createElement('style');
style.textContent = `
    .excel-table {
        font-size: 0.875rem;
    }

    .excel-cell {
        transition: background-color 0.2s;
    }

    .excel-cell:focus {
        outline: 2px solid #3b82f6;
        outline-offset: -2px;
        background-color: #eff6ff;
    }

    .excel-cell:hover {
        background-color: #f3f4f6;
    }
`;
document.head.appendChild(style);
