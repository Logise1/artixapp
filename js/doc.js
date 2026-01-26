import { auth, db, collection, addDoc, getDoc, doc, updateDoc, onSnapshot, setDoc } from "./firebase-config.js";

let currentUser = null;
let documentId = null;
let documentData = null;
let saveTimeout = null;
let isReadOnly = false;
let shareToken = null;
let hasUnsavedChanges = false;
let myPresenceId = null;
let isSyncing = false;

// Get document ID from URL
const urlParams = new URLSearchParams(window.location.search);
documentId = urlParams.get('document');
shareToken = urlParams.get('token');

if (!documentId) {
    alert('No se especificó un documento');
    window.location.href = 'drive.html';
}

// Auth check
auth.onAuthStateChanged(async (user) => {
    if (!user && !shareToken) {
        window.location.href = 'login.html';
        return;
    }

    currentUser = user;
    await loadDocument();
});

// Load document
async function loadDocument() {
    try {
        const docRef = doc(db, "user_files", documentId);
        const docSnap = await getDoc(docRef);

        if (!docSnap.exists()) {
            alert('Documento no encontrado');
            window.location.href = 'drive.html';
            return;
        }

        documentData = docSnap.data();

        // Check permissions
        if (shareToken) {
            // Check if token is valid
            const shareLink = documentData.shareLinks?.find(link => link.token === shareToken);
            if (!shareLink) {
                alert('Enlace de acceso inválido o expirado');
                window.location.href = 'login.html';
                return;
            }
            isReadOnly = shareLink.permission === 'view';
        } else if (currentUser) {
            // Check if user is owner
            if (documentData.userId !== currentUser.uid) {
                alert('No tienes permiso para acceder a este documento');
                window.location.href = 'drive.html';
                return;
            }
            isReadOnly = false;
        }

        // Update UI
        document.getElementById('document-name').value = documentData.name.replace('.txt', '');
        document.getElementById('doc-title').textContent = documentData.name + ' | Artix';
        document.getElementById('editor').innerHTML = documentData.content || '<p>Empieza a escribir...</p>';

        if (isReadOnly) {
            document.getElementById('editor').contentEditable = 'false';
            document.getElementById('editor').style.background = '#f8fafc';
            document.getElementById('document-name').disabled = true;
            document.querySelector('.share-btn').style.display = 'none';

            // Disable toolbar
            document.querySelectorAll('.toolbar-btn, .toolbar-select, .color-picker').forEach(el => {
                el.disabled = true;
                el.style.opacity = '0.5';
                el.style.cursor = 'not-allowed';
            });

            showSaveStatus('saved', 'Solo lectura');
        } else {
            // Listen for changes
            setupAutoSave();
            loadShareLinks();

            // Add my presence
            await addPresence();
        }

        // Real-time sync for collaborative editing
        onSnapshot(docRef, (snapshot) => {
            if (snapshot.exists()) {
                const data = snapshot.data();

                // Update collaborators list
                updateCollaboratorsList(data.activeUsers || []);

                if (!isReadOnly) {
                    // Only update if content changed from another source and user is not typing
                    if (data.lastModified?.toMillis() > (documentData.lastModified?.toMillis() || 0)) {
                        documentData = data;
                        if (!document.getElementById('editor').matches(':focus') && !isSyncing) {
                            document.getElementById('editor').innerHTML = data.content || '<p>Empieza a escribir...</p>';
                            hasUnsavedChanges = false;
                            showSaveStatus('saved');

                            // Re-wrap images after sync
                            setTimeout(() => wrapAllImages(), 100);
                        }
                    }
                }
            }
        });

    } catch (error) {
        console.error('Error loading document:', error);
        alert('Error al cargar documento: ' + error.message);
    }
}

// Auto-save functionality
function setupAutoSave() {
    const editor = document.getElementById('editor');
    const nameInput = document.getElementById('document-name');

    editor.addEventListener('input', () => {
        if (isReadOnly) return;
        hasUnsavedChanges = true;
        showSaveStatus('saving');
        clearTimeout(saveTimeout);
        // Save every 1 minute (60000ms) instead of 1.5 seconds
        saveTimeout = setTimeout(() => saveDocument(), 60000);
    });

    nameInput.addEventListener('input', () => {
        if (isReadOnly) return;
        hasUnsavedChanges = true;
        clearTimeout(saveTimeout);
        saveTimeout = setTimeout(() => saveDocument(), 60000);
    });
}

// Save document
async function saveDocument() {
    if (isReadOnly) return;

    try {
        isSyncing = true;
        const content = document.getElementById('editor').innerHTML;
        const name = document.getElementById('document-name').value.trim() || 'Sin título';

        await updateDoc(doc(db, "user_files", documentId), {
            name: name + '.txt',
            content: content,
            lastModified: new Date()
        });

        document.getElementById('doc-title').textContent = name + ' | Artix';
        hasUnsavedChanges = false;
        showSaveStatus('saved');

        // Update my presence timestamp
        await updatePresence();
    } catch (error) {
        console.error('Error saving document:', error);
        showSaveStatus('error', 'Error al guardar');
    } finally {
        isSyncing = false;
    }
}

// Add my presence to the document
async function addPresence() {
    if (!currentUser && !shareToken) return

    const userName = currentUser?.email || 'Anónimo';
    const userId = currentUser?.uid || `anon_${shareToken}`;

    myPresenceId = userId + '_' + Date.now();

    const docRef = doc(db, "user_files", documentId);
    const docSnap = await getDoc(docRef);

    if (docSnap.exists()) {
        const currentUsers = docSnap.data().activeUsers || [];

        // Remove old entries for this user
        const filteredUsers = currentUsers.filter(u => !u.id.startsWith(userId));

        // Add me
        filteredUsers.push({
            id: myPresenceId,
            name: userName,
            color: getRandomColor(),
            lastSeen: new Date()
        });

        await updateDoc(docRef, {
            activeUsers: filteredUsers
        });
    }

    // Update presence every 10 seconds
    setInterval(updatePresence, 10000);

    // Remove presence on page unload
    window.addEventListener('beforeunload', () => {
        removePresence();
    });
}

// Update my presence timestamp
async function updatePresence() {
    if (!myPresenceId) return;

    try {
        const docRef = doc(db, "user_files", documentId);
        const docSnap = await getDoc(docRef);

        if (docSnap.exists()) {
            const currentUsers = docSnap.data().activeUsers || [];
            const updatedUsers = currentUsers.map(u => {
                if (u.id === myPresenceId) {
                    return { ...u, lastSeen: new Date() };
                }
                return u;
            });

            // Remove stale users (inactive for > 30 seconds)
            const now = Date.now();
            const activeUsers = updatedUsers.filter(u => {
                const lastSeen = u.lastSeen?.toDate ? u.lastSeen.toDate().getTime() : u.lastSeen;
                return now - lastSeen < 30000;
            });

            await updateDoc(docRef, {
                activeUsers: activeUsers
            });
        }
    } catch (error) {
        console.error('Error updating presence:', error);
    }
}

// Remove my presence
function removePresence() {
    if (!myPresenceId) return;

    navigator.sendBeacon(`/api/remove-presence?docId=${documentId}&presenceId=${myPresenceId}`);
}

// Update collaborators list UI
function updateCollaboratorsList(users) {
    const listEl = document.getElementById('collaborators-list');
    listEl.innerHTML = '';

    // Filter out myself and stale users
    const now = Date.now();
    const activeUsers = users.filter(u => {
        const lastSeen = u.lastSeen?.toDate ? u.lastSeen.toDate().getTime() : u.lastSeen;
        return u.id !== myPresenceId && (now - lastSeen < 30000);
    });

    if (activeUsers.length === 0) return;

    // Show up to 3 avatars
    activeUsers.slice(0, 3).forEach(user => {
        const avatar = document.createElement('div');
        avatar.className = 'collaborator-avatar';
        avatar.style.background = user.color;
        avatar.textContent = user.name[0].toUpperCase();
        avatar.title = user.name;
        listEl.appendChild(avatar);
    });

    // Show count if more than 3
    if (activeUsers.length > 3) {
        const count = document.createElement('span');
        count.className = 'collaborator-count';
        count.textContent = `+${activeUsers.length - 3}`;
        listEl.appendChild(count);
    }
}

// Generate random color for user avatar
function getRandomColor() {
    const colors = ['#4f46e5', '#ec4899', '#8b5cf6', '#10b981', '#f59e0b', '#ef4444', '#06b6d4', '#6366f1'];
    return colors[Math.floor(Math.random() * colors.length)];
}

// Show save status
function showSaveStatus(status, customText = null) {
    const statusEl = document.getElementById('save-status');
    const spinner = statusEl.querySelector('.fa-spin');
    const check = statusEl.querySelector('.fa-check');
    const text = statusEl.querySelector('span');

    statusEl.className = 'saving-indicator ' + status;

    if (status === 'saving') {
        spinner.style.display = 'none';
        check.style.display = 'none';
        text.textContent = customText || 'Sin guardar';
        statusEl.style.color = '#f59e0b'; // Orange for unsaved
    } else if (status === 'saved') {
        spinner.style.display = 'none';
        check.style.display = 'block';
        text.textContent = customText || 'Guardado';
        statusEl.style.color = '#16a34a'; // Green for saved
    } else if (status === 'error') {
        spinner.style.display = 'none';
        check.style.display = 'none';
        text.textContent = customText || 'Error al guardar';
        statusEl.style.color = '#ef4444'; // Red for error
    }
}

// Execute formatting commands
window.execCommand = (command, value = null) => {
    if (isReadOnly) return;

    if (command === 'createLink') {
        const selection = window.getSelection();
        if (!selection.rangeCount) {
            alert('Por favor selecciona el texto que quieres convertir en enlace');
            return;
        }

        const url = prompt('Introduce la URL:');
        if (url) {
            document.execCommand(command, false, url);
        }
    } else {
        document.execCommand(command, false, value);
    }

    document.getElementById('editor').focus();
};

// Insert image from file picker
window.insertImage = async () => {
    if (isReadOnly) return;

    const fileInput = document.getElementById('image-file-input');
    fileInput.click();
};

// Handle file input change
document.getElementById('image-file-input').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    await uploadAndInsertImage(file);
    e.target.value = ''; // Reset input
});

// Upload image to YYF and insert it
async function uploadAndInsertImage(file) {
    if (!file.type.startsWith('image/')) {
        alert('Por favor selecciona un archivo de imagen');
        return;
    }

    // Show uploading modal
    document.getElementById('upload-progress-modal').classList.add('active');

    try {
        // Upload to YeetYourFiles
        const formData = new FormData();
        formData.append('file', file, file.name);

        const response = await fetch('https://yyf.mubilop.com/api/upload', {
            method: 'POST',
            body: formData
        });

        if (!response.ok) throw new Error('Error en la subida');
        const result = await response.json();
        const imageUrl = `https://yyf.mubilop.com${result.fileUrl}`;

        // Insert image into editor
        const img = document.createElement('img');
        img.src = imageUrl;
        img.style.maxWidth = '100%';

        // Insert at cursor position
        const selection = window.getSelection();
        if (selection.rangeCount > 0) {
            const range = selection.getRangeAt(0);
            range.insertNode(img);
            range.collapse(false);
        }

        // Wrap images after insertion
        setTimeout(() => {
            wrapAllImages();
        }, 100);

    } catch (error) {
        console.error('Error uploading image:', error);
        alert('Error al subir imagen: ' + error.message);
    } finally {
        // Hide uploading modal
        document.getElementById('upload-progress-modal').classList.remove('active');
    }
}

// Wrap all unwrapped images with resize wrapper
function wrapAllImages() {
    const editor = document.getElementById('editor');
    const images = editor.querySelectorAll('img:not(.wrapped)');

    images.forEach(img => {
        // Skip if already wrapped
        if (img.parentElement.classList.contains('image-resize-wrapper')) {
            return;
        }

        // Create wrapper
        const wrapper = document.createElement('div');
        wrapper.className = 'image-resize-wrapper';
        wrapper.contentEditable = false;

        // Wrap image
        img.parentNode.insertBefore(wrapper, img);
        wrapper.appendChild(img);
        img.classList.add('wrapped');

        // Create 8 resize handles
        const handles = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
        handles.forEach(position => {
            const handle = document.createElement('div');
            handle.className = `resize-handle ${position}`;
            handle.dataset.position = position;
            wrapper.appendChild(handle);

            // Add mousedown event for resizing
            handle.addEventListener('mousedown', (e) => startResize(e, wrapper, position));
        });

        // Click on wrapper to select
        wrapper.addEventListener('click', (e) => {
            e.stopPropagation();
            selectImage(wrapper);
        });

        // Click on image to select wrapper
        img.addEventListener('click', (e) => {
            e.stopPropagation();
            selectImage(wrapper);
        });
    });
}

// Select an image wrapper
function selectImage(wrapper) {
    // Deselect all
    document.querySelectorAll('.image-resize-wrapper').forEach(w => {
        w.classList.remove('selected');
    });
    // Select this one
    wrapper.classList.add('selected');
}

// Resize functionality
let isResizing = false;
let currentWrapper = null;
let currentHandle = null;
let startX, startY, startWidth, startHeight;

function startResize(e, wrapper, position) {
    e.preventDefault();
    e.stopPropagation();

    isResizing = true;
    currentWrapper = wrapper;
    currentHandle = position;

    const img = wrapper.querySelector('img');
    const rect = img.getBoundingClientRect();

    startX = e.clientX;
    startY = e.clientY;
    startWidth = rect.width;
    startHeight = rect.height;

    document.addEventListener('mousemove', doResize);
    document.addEventListener('mouseup', stopResize);
}

function doResize(e) {
    if (!isResizing) return;

    const img = currentWrapper.querySelector('img');
    const deltaX = e.clientX - startX;
    const deltaY = e.clientY - startY;

    let newWidth = startWidth;
    let newHeight = startHeight;

    // Calculate new dimensions based on handle position
    switch (currentHandle) {
        case 'se':
        case 'e':
        case 'ne':
            newWidth = startWidth + deltaX;
            break;
        case 'sw':
        case 'w':
        case 'nw':
            newWidth = startWidth - deltaX;
            break;
    }

    switch (currentHandle) {
        case 'se':
        case 's':
        case 'sw':
            newHeight = startHeight + deltaY;
            break;
        case 'ne':
        case 'n':
        case 'nw':
            newHeight = startHeight - deltaY;
            break;
    }

    // Maintain aspect ratio
    const aspectRatio = startWidth / startHeight;

    if (['nw', 'ne', 'se', 'sw'].includes(currentHandle)) {
        // Corner handles - maintain aspect ratio
        if (Math.abs(deltaX) > Math.abs(deltaY)) {
            newHeight = newWidth / aspectRatio;
        } else {
            newWidth = newHeight * aspectRatio;
        }
    }

    // Apply minimum size
    if (newWidth < 50) newWidth = 50;
    if (newHeight < 50) newHeight = 50;

    img.style.width = newWidth + 'px';
    img.style.height = newHeight + 'px';
}

function stopResize() {
    isResizing = false;
    document.removeEventListener('mousemove', doResize);
    document.removeEventListener('mouseup', stopResize);
}

// Handle paste events (including images from clipboard)
document.getElementById('editor').addEventListener('paste', async (e) => {
    if (isReadOnly) return;

    const items = e.clipboardData.items;

    for (let item of items) {
        if (item.type.startsWith('image/')) {
            e.preventDefault();
            const file = item.getAsFile();
            await uploadAndInsertImage(file);
            return;
        }
    }
});

// Handle drag and drop
const editorElement = document.getElementById('editor');

editorElement.addEventListener('dragover', (e) => {
    if (isReadOnly) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    editorElement.style.background = '#f0f4ff';
});

editorElement.addEventListener('dragleave', (e) => {
    if (isReadOnly) return;
    editorElement.style.background = 'white';
});

editorElement.addEventListener('drop', async (e) => {
    if (isReadOnly) return;
    e.preventDefault();
    editorElement.style.background = 'white';

    const files = e.dataTransfer.files;
    if (files.length > 0 && files[0].type.startsWith('image/')) {
        await uploadAndInsertImage(files[0]);
    }
});

// Deselect images when clicking elsewhere
document.getElementById('editor').addEventListener('click', (e) => {
    if (!e.target.closest('.image-resize-wrapper')) {
        document.querySelectorAll('.image-resize-wrapper').forEach(wrapper => {
            wrapper.classList.remove('selected');
        });
    }
});

// Wrap images when document loads and after saves
setTimeout(() => {
    wrapAllImages();
}, 500);

// Re-wrap images after content updates
const observer = new MutationObserver(() => {
    wrapAllImages();
});

observer.observe(document.getElementById('editor'), {
    childList: true,
    subtree: true
});

// Share functionality
window.openShareModal = () => {
    if (isReadOnly) return;
    document.getElementById('share-modal').classList.add('active');
    loadShareLinks();
};

window.closeShareModal = () => {
    document.getElementById('share-modal').classList.remove('active');
};

// Load share links
async function loadShareLinks() {
    const docRef = doc(db, "user_files", documentId);
    const docSnap = await getDoc(docRef);

    if (!docSnap.exists()) return;

    const data = docSnap.data();
    const links = data.shareLinks || [];

    const linksList = document.getElementById('links-list');
    linksList.innerHTML = '';

    if (links.length === 0) {
        linksList.innerHTML = '<p style="color: var(--text-dim); text-align: center; padding: 20px;">No hay enlaces compartidos aún</p>';
        return;
    }

    links.forEach((link, index) => {
        const linkItem = document.createElement('div');
        linkItem.className = 'link-item';

        const url = `${window.location.origin}/doc.html?document=${documentId}&token=${link.token}`;

        linkItem.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
                <span class="permission-badge ${link.permission}">
                    <i class="fas fa-${link.permission === 'edit' ? 'pen' : 'eye'}"></i>
                    ${link.permission === 'edit' ? 'Puede editar' : 'Solo lectura'}
                </span>
                <button onclick="deleteShareLink(${index})" style="background: #fee2e2; color: #dc2626; border: none; padding: 4px 8px; border-radius: 4px; cursor: pointer;">
                    <i class="fas fa-trash"></i>
                </button>
            </div>
            <div class="link-url">${url}</div>
            <button class="copy-btn" onclick="copyToClipboard('${url}')">
                <i class="fas fa-copy"></i> Copiar enlace
            </button>
        `;

        linksList.appendChild(linkItem);
    });
}

// Create share link
window.createShareLink = async (permission) => {
    try {
        const token = generateToken();
        const docRef = doc(db, "user_files", documentId);
        const docSnap = await getDoc(docRef);

        if (!docSnap.exists()) return;

        const currentLinks = docSnap.data().shareLinks || [];
        currentLinks.push({
            token: token,
            permission: permission,
            createdAt: new Date()
        });

        await updateDoc(docRef, {
            shareLinks: currentLinks
        });

        loadShareLinks();
    } catch (error) {
        console.error('Error creating share link:', error);
        alert('Error al crear enlace: ' + error.message);
    }
};

// Delete share link
window.deleteShareLink = async (index) => {
    if (!confirm('¿Eliminar este enlace? Las personas con este enlace ya no podrán acceder.')) {
        return;
    }

    try {
        const docRef = doc(db, "user_files", documentId);
        const docSnap = await getDoc(docRef);

        if (!docSnap.exists()) return;

        const currentLinks = docSnap.data().shareLinks || [];
        currentLinks.splice(index, 1);

        await updateDoc(docRef, {
            shareLinks: currentLinks
        });

        loadShareLinks();
    } catch (error) {
        console.error('Error deleting share link:', error);
        alert('Error al eliminar enlace: ' + error.message);
    }
};

// Copy to clipboard
window.copyToClipboard = (text) => {
    navigator.clipboard.writeText(text).then(() => {
        alert('¡Enlace copiado!');
    }).catch(err => {
        console.error('Error copying:', err);
        alert('Error al copiar enlace');
    });
};

// Generate random token
function generateToken() {
    return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
}

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
    if (isReadOnly) return;

    if (e.ctrlKey || e.metaKey) {
        switch (e.key.toLowerCase()) {
            case 'b':
                e.preventDefault();
                execCommand('bold');
                break;
            case 'i':
                e.preventDefault();
                execCommand('italic');
                break;
            case 'u':
                e.preventDefault();
                execCommand('underline');
                break;
            case 's':
                e.preventDefault();
                saveDocument();
                break;
        }
    }
});

// Close modal on click outside
document.getElementById('share-modal')?.addEventListener('click', (e) => {
    if (e.target.id === 'share-modal') {
        closeShareModal();
    }
});

// Warn before leaving with unsaved changes
window.addEventListener('beforeunload', (e) => {
    if (hasUnsavedChanges && !isReadOnly) {
        e.preventDefault();
        e.returnValue = ''; // Required for Chrome
        return '¿Seguro que quieres salir? Tienes cambios sin guardar.';
    }
});
