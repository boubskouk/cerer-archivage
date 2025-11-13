// ============================================
// SYSTÈME DE PRÉVISUALISATION - ARCHIVAGE C.E.R.E.R
// ============================================

// État de la prévisualisation
const previewState = {
    isOpen: false,
    currentDoc: null,
    pdfInstance: null
};

// Déterminer le type de fichier
function getFileType(mimeType, fileName) {
    if (!mimeType && !fileName) return 'unknown';

    const type = mimeType || '';
    const ext = fileName ? fileName.toLowerCase().split('.').pop() : '';

    // Images
    if (type.startsWith('image/')) return 'image';

    // PDF
    if (type === 'application/pdf' || ext === 'pdf') return 'pdf';

    // Word
    if (type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
        ext === 'docx') return 'word';
    if (type === 'application/msword' || ext === 'doc') return 'word-old';

    // Excel
    if (type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
        ext === 'xlsx') return 'excel';
    if (type === 'application/vnd.ms-excel' || ext === 'xls') return 'excel-old';

    // PowerPoint
    if (type === 'application/vnd.openxmlformats-officedocument.presentationml.presentation' ||
        ext === 'pptx') return 'powerpoint';
    if (type === 'application/vnd.ms-powerpoint' || ext === 'ppt') return 'powerpoint-old';

    // Texte
    if (type.startsWith('text/') || ext === 'txt') return 'text';

    return 'unknown';
}

// Convertir data URL en ArrayBuffer
function dataURLToArrayBuffer(dataURL) {
    const base64 = dataURL.split(',')[1];
    const binaryString = atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes.buffer;
}

// Convertir data URL en Blob
function dataURLToBlob(dataURL) {
    const arr = dataURL.split(',');
    const mime = arr[0].match(/:(.*?);/)[1];
    const bstr = atob(arr[1]);
    let n = bstr.length;
    const u8arr = new Uint8Array(n);
    while (n--) {
        u8arr[n] = bstr.charCodeAt(n);
    }
    return new Blob([u8arr], { type: mime });
}

// Prévisualiser une image
function previewImage(dataURL) {
    return `
        <div class="flex items-center justify-center h-full bg-gray-100">
            <img src="${dataURL}" alt="Prévisualisation" class="max-w-full max-h-full object-contain" />
        </div>
    `;
}

// Prévisualiser un PDF
async function previewPDF(dataURL) {
    const container = document.createElement('div');
    container.className = 'pdf-preview-container h-full overflow-auto bg-gray-100';
    container.innerHTML = `
        <div class="flex flex-col items-center p-4">
            <div class="mb-4 flex items-center gap-4 bg-white p-3 rounded shadow">
                <button id="pdf-prev" class="px-3 py-1 bg-blue-500 text-white rounded hover:bg-blue-600">
                    ← Précédent
                </button>
                <span id="pdf-page-info" class="text-sm font-medium">Page 1 / 1</span>
                <button id="pdf-next" class="px-3 py-1 bg-blue-500 text-white rounded hover:bg-blue-600">
                    Suivant →
                </button>
                <button id="pdf-zoom-out" class="px-3 py-1 bg-gray-500 text-white rounded hover:bg-gray-600">
                    -
                </button>
                <span id="pdf-zoom-level" class="text-sm font-medium">100%</span>
                <button id="pdf-zoom-in" class="px-3 py-1 bg-gray-500 text-white rounded hover:bg-gray-600">
                    +
                </button>
            </div>
            <div id="pdf-canvas-container" class="bg-white shadow-lg"></div>
        </div>
    `;

    // Vérifier si PDF.js est chargé
    if (typeof pdfjsLib === 'undefined') {
        container.innerHTML = `
            <div class="flex items-center justify-center h-full">
                <div class="text-center">
                    <p class="text-red-600 mb-4">PDF.js n'est pas chargé</p>
                    <p class="text-sm text-gray-600">Veuillez recharger la page</p>
                </div>
            </div>
        `;
        return container;
    }

    try {
        const arrayBuffer = dataURLToArrayBuffer(dataURL);
        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

        let currentPage = 1;
        let scale = 1.5;
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        document.getElementById('pdf-canvas-container').appendChild(canvas);

        async function renderPage(pageNum) {
            const page = await pdf.getPage(pageNum);
            const viewport = page.getViewport({ scale });

            canvas.width = viewport.width;
            canvas.height = viewport.height;

            await page.render({
                canvasContext: ctx,
                viewport: viewport
            }).promise;

            document.getElementById('pdf-page-info').textContent = `Page ${pageNum} / ${pdf.numPages}`;
            document.getElementById('pdf-prev').disabled = pageNum === 1;
            document.getElementById('pdf-next').disabled = pageNum === pdf.numPages;
        }

        await renderPage(currentPage);

        // Navigation entre les pages
        document.getElementById('pdf-prev').addEventListener('click', async () => {
            if (currentPage > 1) {
                currentPage--;
                await renderPage(currentPage);
            }
        });

        document.getElementById('pdf-next').addEventListener('click', async () => {
            if (currentPage < pdf.numPages) {
                currentPage++;
                await renderPage(currentPage);
            }
        });

        // Zoom
        document.getElementById('pdf-zoom-in').addEventListener('click', async () => {
            scale += 0.25;
            document.getElementById('pdf-zoom-level').textContent = `${Math.round(scale * 100)}%`;
            await renderPage(currentPage);
        });

        document.getElementById('pdf-zoom-out').addEventListener('click', async () => {
            if (scale > 0.5) {
                scale -= 0.25;
                document.getElementById('pdf-zoom-level').textContent = `${Math.round(scale * 100)}%`;
                await renderPage(currentPage);
            }
        });

    } catch (error) {
        console.error('Erreur lors du chargement du PDF:', error);
        container.innerHTML = `
            <div class="flex items-center justify-center h-full">
                <div class="text-center">
                    <p class="text-red-600 mb-4">Erreur lors du chargement du PDF</p>
                    <p class="text-sm text-gray-600">${error.message}</p>
                </div>
            </div>
        `;
    }

    return container;
}

// Prévisualiser un document Word
async function previewWord(dataURL) {
    const container = document.createElement('div');
    container.className = 'word-preview-container h-full overflow-auto bg-white p-8';
    container.innerHTML = '<div class="flex items-center justify-center h-full"><p>Chargement du document...</p></div>';

    // Vérifier si Mammoth est chargé
    if (typeof mammoth === 'undefined') {
        container.innerHTML = `
            <div class="flex items-center justify-center h-full">
                <div class="text-center">
                    <p class="text-red-600 mb-4">Mammoth.js n'est pas chargé</p>
                    <p class="text-sm text-gray-600">Veuillez recharger la page</p>
                </div>
            </div>
        `;
        return container;
    }

    try {
        const arrayBuffer = dataURLToArrayBuffer(dataURL);
        const result = await mammoth.convertToHtml({ arrayBuffer });

        container.innerHTML = `
            <div class="prose max-w-4xl mx-auto">
                ${result.value}
            </div>
            ${result.messages.length > 0 ? `
                <div class="mt-4 p-4 bg-yellow-50 border border-yellow-200 rounded">
                    <p class="text-sm text-yellow-800 font-medium mb-2">Avertissements:</p>
                    <ul class="text-xs text-yellow-700 list-disc list-inside">
                        ${result.messages.map(m => `<li>${m.message}</li>`).join('')}
                    </ul>
                </div>
            ` : ''}
        `;
    } catch (error) {
        console.error('Erreur lors du chargement du document Word:', error);
        container.innerHTML = `
            <div class="flex items-center justify-center h-full">
                <div class="text-center">
                    <p class="text-red-600 mb-4">Erreur lors du chargement du document Word</p>
                    <p class="text-sm text-gray-600">${error.message}</p>
                </div>
            </div>
        `;
    }

    return container;
}

// Prévisualiser un fichier Excel
async function previewExcel(dataURL) {
    const container = document.createElement('div');
    container.className = 'excel-preview-container h-full overflow-auto bg-white p-4';
    container.innerHTML = '<div class="flex items-center justify-center h-full"><p>Chargement du fichier Excel...</p></div>';

    // Vérifier si XLSX est chargé
    if (typeof XLSX === 'undefined') {
        container.innerHTML = `
            <div class="flex items-center justify-center h-full">
                <div class="text-center">
                    <p class="text-red-600 mb-4">SheetJS n'est pas chargé</p>
                    <p class="text-sm text-gray-600">Veuillez recharger la page</p>
                </div>
            </div>
        `;
        return container;
    }

    try {
        const arrayBuffer = dataURLToArrayBuffer(dataURL);
        const workbook = XLSX.read(arrayBuffer, { type: 'array' });

        let html = '<div class="space-y-6">';

        // Sélecteur de feuilles
        if (workbook.SheetNames.length > 1) {
            html += `
                <div class="flex gap-2 flex-wrap">
                    ${workbook.SheetNames.map((name, idx) => `
                        <button
                            class="sheet-tab px-4 py-2 rounded ${idx === 0 ? 'bg-blue-500 text-white' : 'bg-gray-200 text-gray-700'}"
                            data-sheet="${idx}"
                        >
                            ${name}
                        </button>
                    `).join('')}
                </div>
            `;
        }

        // Afficher toutes les feuilles
        workbook.SheetNames.forEach((sheetName, idx) => {
            const worksheet = workbook.Sheets[sheetName];
            const htmlTable = XLSX.utils.sheet_to_html(worksheet, {
                header: '',
                editable: false
            });

            html += `
                <div class="sheet-content ${idx === 0 ? '' : 'hidden'}" data-sheet="${idx}">
                    <h3 class="text-lg font-semibold mb-3">${sheetName}</h3>
                    <div class="overflow-x-auto">
                        ${htmlTable}
                    </div>
                </div>
            `;
        });

        html += '</div>';
        container.innerHTML = html;

        // Ajouter les styles pour les tableaux
        const style = document.createElement('style');
        style.textContent = `
            .excel-preview-container table {
                border-collapse: collapse;
                width: 100%;
                font-size: 0.875rem;
            }
            .excel-preview-container td, .excel-preview-container th {
                border: 1px solid #e5e7eb;
                padding: 0.5rem;
                text-align: left;
            }
            .excel-preview-container th {
                background-color: #f3f4f6;
                font-weight: 600;
            }
            .excel-preview-container tr:nth-child(even) {
                background-color: #f9fafb;
            }
        `;
        container.appendChild(style);

        // Gérer le changement de feuille
        container.querySelectorAll('.sheet-tab').forEach(tab => {
            tab.addEventListener('click', function() {
                const sheetIdx = this.dataset.sheet;

                // Mettre à jour les onglets
                container.querySelectorAll('.sheet-tab').forEach(t => {
                    t.classList.remove('bg-blue-500', 'text-white');
                    t.classList.add('bg-gray-200', 'text-gray-700');
                });
                this.classList.remove('bg-gray-200', 'text-gray-700');
                this.classList.add('bg-blue-500', 'text-white');

                // Afficher la feuille correspondante
                container.querySelectorAll('.sheet-content').forEach(content => {
                    content.classList.add('hidden');
                });
                container.querySelector(`.sheet-content[data-sheet="${sheetIdx}"]`).classList.remove('hidden');
            });
        });

    } catch (error) {
        console.error('Erreur lors du chargement du fichier Excel:', error);
        container.innerHTML = `
            <div class="flex items-center justify-center h-full">
                <div class="text-center">
                    <p class="text-red-600 mb-4">Erreur lors du chargement du fichier Excel</p>
                    <p class="text-sm text-gray-600">${error.message}</p>
                </div>
            </div>
        `;
    }

    return container;
}

// Prévisualiser un fichier texte
function previewText(dataURL) {
    const text = atob(dataURL.split(',')[1]);
    return `
        <div class="h-full overflow-auto bg-white p-8">
            <pre class="whitespace-pre-wrap font-mono text-sm">${text}</pre>
        </div>
    `;
}

// Message pour les fichiers non supportés
function previewUnsupported(fileName, fileType) {
    return `
        <div class="flex items-center justify-center h-full bg-gray-50">
            <div class="text-center max-w-md">
                <svg class="mx-auto h-16 w-16 text-gray-400 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                <h3 class="text-lg font-medium text-gray-900 mb-2">Prévisualisation non disponible</h3>
                <p class="text-sm text-gray-600 mb-4">
                    Ce type de fichier (${fileType || 'inconnu'}) ne peut pas être prévisualisé directement.
                </p>
                <p class="text-xs text-gray-500">
                    Utilisez le bouton "Télécharger" pour ouvrir le fichier avec l'application appropriée.
                </p>
            </div>
        </div>
    `;
}

// Ouvrir la prévisualisation
async function openPreview(doc) {
    previewState.isOpen = true;
    previewState.currentDoc = doc;

    // Récupérer le document complet
    let fullDoc;
    try {
        fullDoc = await getDocument(state.currentUser, doc._id);
    } catch (error) {
        showNotification('Erreur lors du chargement du document', 'error');
        return;
    }

    const fileType = getFileType(fullDoc.type, fullDoc.nomFichier);

    // Vérifier si le document est éditable
    const editableType = isEditable(fullDoc);

    // Créer le modal
    const modal = document.createElement('div');
    modal.id = 'preview-modal';
    modal.className = 'fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-75';

    modal.innerHTML = `
        <div class="bg-white rounded-lg w-11/12 h-5/6 flex flex-col">
            <!-- Header -->
            <div class="flex items-center justify-between p-4 border-b">
                <div class="flex-1 min-w-0">
                    <h2 class="text-xl font-bold truncate">${fullDoc.titre}</h2>
                    <p class="text-sm text-gray-600 truncate">${fullDoc.nomFichier} • ${formatSize(fullDoc.taille)}</p>
                </div>
                <div class="flex items-center gap-2 ml-4">
                    ${editableType ? `
                    <button
                        id="edit-btn"
                        class="px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600 flex items-center gap-2"
                    >
                        <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                        </svg>
                        Éditer
                    </button>
                    ` : ''}
                    <button
                        id="download-btn"
                        class="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 flex items-center gap-2"
                    >
                        <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                        </svg>
                        Télécharger
                    </button>
                    <button
                        id="close-preview-btn"
                        class="px-4 py-2 bg-gray-500 text-white rounded hover:bg-gray-600"
                    >
                        ✕ Fermer
                    </button>
                </div>
            </div>

            <!-- Content -->
            <div id="preview-content" class="flex-1 overflow-hidden">
                <div class="flex items-center justify-center h-full">
                    <p class="text-gray-600">Chargement...</p>
                </div>
            </div>
        </div>
    `;

    document.body.appendChild(modal);

    // Charger le contenu approprié
    const previewContent = document.getElementById('preview-content');

    try {
        let content;

        switch (fileType) {
            case 'image':
                content = previewImage(fullDoc.contenu);
                previewContent.innerHTML = content;
                break;

            case 'pdf':
                content = await previewPDF(fullDoc.contenu);
                previewContent.innerHTML = '';
                previewContent.appendChild(content);
                break;

            case 'word':
                content = await previewWord(fullDoc.contenu);
                previewContent.innerHTML = '';
                previewContent.appendChild(content);
                break;

            case 'excel':
                content = await previewExcel(fullDoc.contenu);
                previewContent.innerHTML = '';
                previewContent.appendChild(content);
                break;

            case 'text':
                content = previewText(fullDoc.contenu);
                previewContent.innerHTML = content;
                break;

            default:
                content = previewUnsupported(fullDoc.nomFichier, fullDoc.type);
                previewContent.innerHTML = content;
        }
    } catch (error) {
        console.error('Erreur lors de la prévisualisation:', error);
        previewContent.innerHTML = `
            <div class="flex items-center justify-center h-full">
                <div class="text-center">
                    <p class="text-red-600 mb-4">Erreur lors de la prévisualisation</p>
                    <p class="text-sm text-gray-600">${error.message}</p>
                </div>
            </div>
        `;
    }

    // Gérer le bouton d'édition (si disponible)
    const editBtn = document.getElementById('edit-btn');
    if (editBtn) {
        editBtn.addEventListener('click', () => {
            closePreview(); // Fermer la prévisualisation
            openEditor(fullDoc); // Ouvrir l'éditeur
        });
    }

    // Gérer le téléchargement
    document.getElementById('download-btn').addEventListener('click', () => {
        downloadDoc(fullDoc);
    });

    // Gérer la fermeture
    document.getElementById('close-preview-btn').addEventListener('click', closePreview);

    // Fermer en cliquant à l'extérieur
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            closePreview();
        }
    });

    // Fermer avec Échap
    document.addEventListener('keydown', handleEscapeKey);
}

// Gérer la touche Échap
function handleEscapeKey(e) {
    if (e.key === 'Escape' && previewState.isOpen) {
        closePreview();
    }
}

// Fermer la prévisualisation
function closePreview() {
    const modal = document.getElementById('preview-modal');
    if (modal) {
        modal.remove();
    }

    previewState.isOpen = false;
    previewState.currentDoc = null;

    document.removeEventListener('keydown', handleEscapeKey);
}
