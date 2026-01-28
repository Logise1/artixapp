import { auth, db, storage, signOut, collection, addDoc, getDoc, getDocs, doc, query, where, onSnapshot, orderBy, updateDoc, setDoc, deleteDoc } from "./firebase-config.js";

let currentUser = null;
let currentFolderId = null;
let selectedItem = null;
let folderPath = [];
let totalStorageUsed = 0;

// Auth check
auth.onAuthStateChanged(async (user) => {
    if (!user) {
        window.location.href = 'login.html';
        return;
    }
    currentUser = user;

    // Update UI
    document.getElementById('user-email').textContent = user.email;
    const avatar = document.getElementById('current-user-avatar');
    avatar.querySelector('span').textContent = user.email[0].toUpperCase();

    // Load user profile photo if exists
    const userDoc = await getDoc(doc(db, "users", user.uid));
    if (userDoc.exists() && userDoc.data().photoURL) {
        avatar.innerHTML = `<img src="${userDoc.data().photoURL}">`;
    }

    // Load files
    loadFiles(null);
    calculateStorageUsed();
});

// Logout
document.getElementById('logout-btn').addEventListener('click', async () => {
    await signOut(auth);
    window.location.href = 'login.html';
});

// Modal handlers
document.querySelectorAll('.close-modal').forEach(btn => {
    btn.addEventListener('click', (e) => {
        e.target.closest('.modal').classList.remove('active');
    });
});

document.querySelectorAll('.modal').forEach(modal => {
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            modal.classList.remove('active');
        }
    });
});

// New Folder
document.getElementById('new-folder-btn').addEventListener('click', () => {
    document.getElementById('create-folder-modal').classList.add('active');
});

document.getElementById('create-folder-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const folderName = document.getElementById('folder-name-input').value.trim();

    if (!folderName) {
        alert('Por favor ingresa un nombre para la carpeta');
        return;
    }

    try {
        await addDoc(collection(db, "user_files"), {
            userId: currentUser.uid,
            name: folderName,
            type: "folder",
            parentId: currentFolderId,
            createdAt: new Date(),
            lastModified: new Date()
        });

        document.getElementById('create-folder-modal').classList.remove('active');
        document.getElementById('folder-name-input').value = '';
    } catch (error) {
        console.error('Error creating folder:', error);
        alert('Error al crear carpeta: ' + error.message);
    }
});

// Upload File
document.getElementById('upload-btn').addEventListener('click', () => {
    document.getElementById('upload-file-modal').classList.add('active');
});

document.getElementById('upload-file-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fileInput = document.getElementById('file-upload-input');
    const file = fileInput.files[0];

    if (!file) {
        alert('Por favor selecciona un archivo');
        return;
    }

    try {
        document.getElementById('upload-progress').style.display = 'block';
        document.getElementById('upload-submit-btn').disabled = true;
        document.getElementById('upload-status').textContent = 'Subiendo...';

        // Upload to YeetYourFiles
        const uploaded = await uploadToYeet(file);

        document.getElementById('upload-status').textContent = 'Guardando...';

        await addDoc(collection(db, "user_files"), {
            userId: currentUser.uid,
            name: file.name,
            type: "file",
            fileUrl: uploaded.url,
            fileSize: file.size,
            contentType: file.type,
            parentId: currentFolderId,
            createdAt: new Date(),
            lastModified: new Date()
        });

        document.getElementById('upload-file-modal').classList.remove('active');
        document.getElementById('file-upload-input').value = '';
        document.getElementById('upload-progress').style.display = 'none';
        document.getElementById('upload-submit-btn').disabled = false;

        calculateStorageUsed();
    } catch (error) {
        console.error('Error uploading file:', error);
        alert('Error al subir archivo: ' + error.message);
        document.getElementById('upload-progress').style.display = 'none';
        document.getElementById('upload-submit-btn').disabled = false;
    }
});

// YeetYourFiles upload helper
async function uploadToYeet(file) {
    const formData = new FormData();
    formData.append('file', file, file.name);

    try {
        const response = await fetch('https://yyf.mubilop.com/api/upload', {
            method: 'POST',
            body: formData
        });

        if (!response.ok) throw new Error('Error en la subida');
        const result = await response.json();
        return {
            url: `https://yyf.mubilop.com${result.fileUrl}`,
            filename: file.name
        };
    } catch (err) {
        console.error(err);
        throw new Error("Error al subir archivo. Inténtalo de nuevo.");
    }
}

// Create Document
document.getElementById('new-doc-btn').addEventListener('click', () => {
    document.getElementById('create-doc-modal').classList.add('active');
});

document.getElementById('create-doc-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const docName = document.getElementById('doc-name-input').value.trim() || 'Sin título';

    try {
        // Create document without content - just metadata
        const docRef = await addDoc(collection(db, "user_files"), {
            userId: currentUser.uid,
            name: `${docName}.txt`,
            type: "document",
            content: '', // Empty content initially
            parentId: currentFolderId,
            createdAt: new Date(),
            lastModified: new Date(),
            shareLinks: [] // Initialize share links array
        });

        document.getElementById('create-doc-modal').classList.remove('active');
        document.getElementById('doc-name-input').value = '';

        // Redirect to editor
        window.location.href = `doc.html?document=${docRef.id}`;
    } catch (error) {
        console.error('Error creating document:', error);
        alert('Error al crear documento: ' + error.message);
    }
});

// Load Files
function loadFiles(folderId = null) {
    currentFolderId = folderId;

    const filesGrid = document.getElementById('files-grid');
    const emptyState = document.getElementById('empty-state');
    filesGrid.innerHTML = '';

    updateBreadcrumb();

    const q = query(
        collection(db, "user_files"),
        where("userId", "==", currentUser.uid),
        where("parentId", "==", folderId)
    );

    onSnapshot(q, (snapshot) => {
        filesGrid.innerHTML = '';

        if (snapshot.empty) {
            filesGrid.style.display = 'none';
            emptyState.style.display = 'block';
        } else {
            filesGrid.style.display = 'grid';
            emptyState.style.display = 'none';

            const items = [];
            snapshot.forEach(docSnap => {
                items.push({ id: docSnap.id, ...docSnap.data() });
            });

            // Sort: folders first, then files
            items.sort((a, b) => {
                if (a.type === 'folder' && b.type !== 'folder') return -1;
                if (a.type !== 'folder' && b.type === 'folder') return 1;
                return a.name.localeCompare(b.name);
            });

            items.forEach(item => {
                renderFileItem(item);
            });
        }
    });
}

function renderFileItem(item) {
    const filesGrid = document.getElementById('files-grid');
    const div = document.createElement('div');
    div.className = item.type === 'folder' ? 'folder-item' : 'file-item';

    // Drag and Drop support
    div.draggable = true;
    div.dataset.id = item.id;
    div.dataset.type = item.type;

    div.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/plain', item.id);
        e.dataTransfer.effectAllowed = 'move';
        div.classList.add('dragging');
    });

    div.addEventListener('dragend', () => {
        div.classList.remove('dragging');
    });

    if (item.type === 'folder') {
        div.addEventListener('dragover', (e) => {
            e.preventDefault();
            div.classList.add('drag-over');
        });

        div.addEventListener('dragleave', () => {
            div.classList.remove('drag-over');
        });

        div.addEventListener('drop', async (e) => {
            e.preventDefault();
            div.classList.remove('drag-over');
            const draggedId = e.dataTransfer.getData('text/plain');
            if (draggedId && draggedId !== item.id) {
                await moveItem(draggedId, item.id);
            }
        });

        div.innerHTML = `
            <i class="fas fa-folder folder-icon"></i>
            <div class="folder-name">${item.name}</div>
            <div class="file-meta">${formatDate(item.lastModified)}</div>
        `;
        div.onclick = () => navigateToFolder(item.id, item.name);
    } else {
        const icon = getFileIcon(item.name, item.contentType, item.type);
        const size = formatFileSize(item.fileSize);

        div.innerHTML = `
            ${icon}
            <div class="file-name">${item.name}</div>
            <div class="file-meta">${size} • ${formatDate(item.lastModified)}</div>
        `;

        if (item.type === 'document') {
            div.onclick = () => openDocument(item);
        } else {
            div.onclick = () => openFile(item);
        }
    }

    // Right-click context menu
    div.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        showContextMenu(e.clientX, e.clientY, item);
    });

    filesGrid.appendChild(div);
}

async function moveItem(itemId, newParentId) {
    try {
        // Prevent moving a folder into itself or a child (simple check for same folder)
        if (itemId === newParentId) return;

        await updateDoc(doc(db, "user_files", itemId), {
            parentId: newParentId,
            lastModified: new Date()
        });
    } catch (error) {
        console.error('Error moving:', error);
        alert('Error al mover el archivo: ' + error.message);
    }
}

function getFileIcon(fileName, contentType, type) {
    if (type === 'document') {
        return '<i class="fas fa-file-alt file-icon file-icon-doc"></i>';
    }

    const ext = fileName.split('.').pop().toLowerCase();
    let iconClass = 'fa-file';
    let colorClass = 'file-icon-default';

    if (contentType && contentType.startsWith('image/')) {
        iconClass = 'fa-file-image';
        colorClass = 'file-icon-img';
    } else if (ext === 'pdf') {
        iconClass = 'fa-file-pdf';
        colorClass = 'file-icon-pdf';
    } else if (['doc', 'docx'].includes(ext)) {
        iconClass = 'fa-file-word';
        colorClass = 'file-icon-doc';
    } else if (['mp4', 'mov', 'avi'].includes(ext)) {
        iconClass = 'fa-file-video';
        colorClass = 'file-icon-video';
    }

    return `<i class="fas ${iconClass} file-icon ${colorClass}"></i>`;
}

function formatFileSize(bytes) {
    if (!bytes) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
}

function formatDate(timestamp) {
    if (!timestamp) return '';
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Ahora';
    if (diffMins < 60) return `Hace ${diffMins}m`;
    if (diffHours < 24) return `Hace ${diffHours}h`;
    if (diffDays < 7) return `Hace ${diffDays}d`;
    return date.toLocaleDateString();
}

// Navigation
function navigateToFolder(folderId, folderName) {
    folderPath.push({ id: folderId, name: folderName });
    loadFiles(folderId);
}

window.navigateToParentFolder = () => {
    if (folderPath.length === 0) return;
    folderPath.pop();
    const parentFolder = folderPath.length > 0 ? folderPath[folderPath.length - 1].id : null;
    loadFiles(parentFolder);
};

function updateBreadcrumb() {
    const breadcrumb = document.getElementById('breadcrumb');
    const backBtn = document.getElementById('back-btn');
    const folderNameEl = document.getElementById('current-folder-name');

    if (folderPath.length === 0) {
        breadcrumb.innerHTML = '<i class="fas fa-cloud"></i> Raíz';
        backBtn.style.display = 'none';
        folderNameEl.textContent = 'Mi Drive';
    } else {
        const parts = ['<a href="#" onclick="navigateToRoot(); return false;" style="color: var(--primary); text-decoration: none;"><i class="fas fa-cloud"></i> Mi Drive</a>'];
        folderPath.forEach((folder, index) => {
            if (index === folderPath.length - 1) {
                parts.push(`<span>${folder.name}</span>`);
            } else {
                parts.push(`<a href="#" onclick="navigateToBreadcrumb(${index}); return false;" style="color: var(--primary); text-decoration: none;">${folder.name}</a>`);
            }
        });
        breadcrumb.innerHTML = parts.join(' <i class="fas fa-chevron-right" style="font-size: 0.7rem; opacity: 0.5; margin: 0 8px;"></i> ');
        backBtn.style.display = 'block';
        folderNameEl.textContent = folderPath[folderPath.length - 1].name;
    }
}

window.navigateToRoot = () => {
    folderPath = [];
    loadFiles(null);
};

window.navigateToBreadcrumb = (index) => {
    folderPath = folderPath.slice(0, index + 1);
    loadFiles(folderPath[index].id);
};

// Open file
function openFile(item) {
    if (item.contentType && item.contentType.startsWith('image/')) {
        openMedia(item.fileUrl, 'image');
    } else if (item.name.toLowerCase().endsWith('.pdf')) {
        openMedia(item.fileUrl, 'pdf');
    } else {
        window.open(item.fileUrl, '_blank');
    }
}

window.openMedia = (url, type) => {
    const modal = document.getElementById('media-viewer-modal');
    const content = document.getElementById('media-viewer-content');

    if (type === 'image') {
        content.innerHTML = `<img src="${url}" style="max-width: 90vw; max-height: 90vh; object-fit: contain;">`;
    } else if (type === 'pdf') {
        content.innerHTML = `<iframe src="${url}" style="width: 90vw; height: 90vh; border: none;"></iframe>`;
    }

    modal.classList.add('active');
};

// Open Document for editing
function openDocument(item) {
    window.location.href = `doc.html?document=${item.id}`;
}

// Context Menu
function showContextMenu(x, y, item) {
    selectedItem = item;
    const menu = document.getElementById('file-context-menu');
    menu.style.display = 'block';
    menu.style.left = x + 'px';
    menu.style.top = y + 'px';
}

document.addEventListener('click', () => {
    document.getElementById('file-context-menu').style.display = 'none';
});

window.contextMenuAction = async (action) => {
    if (!selectedItem) return;

    switch (action) {
        case 'open':
            if (selectedItem.type === 'folder') {
                navigateToFolder(selectedItem.id, selectedItem.name);
            } else if (selectedItem.type === 'document') {
                openDocument(selectedItem);
            } else {
                openFile(selectedItem);
            }
            break;
        case 'download':
            if (selectedItem.fileUrl) {
                window.open(selectedItem.fileUrl, '_blank');
            }
            break;
        case 'rename':
            document.getElementById('rename-item-id').value = selectedItem.id;
            document.getElementById('rename-input').value = selectedItem.name;
            document.getElementById('rename-modal').classList.add('active');
            break;
        case 'move':
            await showMoveDialog(selectedItem);
            break;
        case 'delete':
            if (confirm(`¿Estás seguro de eliminar "${selectedItem.name}"?`)) {
                await deleteFile(selectedItem.id);
            }
            break;
    }

    document.getElementById('file-context-menu').style.display = 'none';
};

// Rename
document.getElementById('rename-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const itemId = document.getElementById('rename-item-id').value;
    const newName = document.getElementById('rename-input').value.trim();

    if (!newName) {
        alert('Por favor ingresa un nombre');
        return;
    }

    try {
        await updateDoc(doc(db, "user_files", itemId), {
            name: newName,
            lastModified: new Date()
        });

        document.getElementById('rename-modal').classList.remove('active');
    } catch (error) {
        console.error('Error renaming:', error);
        alert('Error al renombrar: ' + error.message);
    }
});

// Move Dialog
async function showMoveDialog(item) {
    const modal = document.getElementById('move-file-modal');
    const list = document.getElementById('move-folders-list');
    list.innerHTML = '';

    // Add root option
    const rootDiv = document.createElement('div');
    rootDiv.className = 'context-menu-item';
    rootDiv.innerHTML = '<i class="fas fa-cloud"></i> Raíz (Mi Drive)';
    rootDiv.onclick = () => moveFileToFolder(item.id, null);
    list.appendChild(rootDiv);

    // Load all folders
    const q = query(
        collection(db, "user_files"),
        where("userId", "==", currentUser.uid),
        where("type", "==", "folder")
    );

    const snapshot = await getDocs(q);
    snapshot.forEach(folderDoc => {
        const folder = folderDoc.data();
        if (folderDoc.id !== item.id) {
            const div = document.createElement('div');
            div.className = 'context-menu-item';
            div.innerHTML = `<i class="fas fa-folder"></i> ${folder.name}`;
            div.onclick = () => moveFileToFolder(item.id, folderDoc.id);
            list.appendChild(div);
        }
    });

    modal.classList.add('active');
}

async function moveFileToFolder(itemId, newParentId) {
    try {
        await updateDoc(doc(db, "user_files", itemId), {
            parentId: newParentId,
            lastModified: new Date()
        });

        document.getElementById('move-file-modal').classList.remove('active');
    } catch (error) {
        console.error('Error moving:', error);
        alert('Error al mover: ' + error.message);
    }
}

// Delete
async function deleteFile(itemId) {
    try {
        await deleteDoc(doc(db, "user_files", itemId));
        calculateStorageUsed();
    } catch (error) {
        console.error('Error deleting:', error);
        alert('Error al eliminar: ' + error.message);
    }
}

// Calculate storage used
async function calculateStorageUsed() {
    try {
        const q = query(
            collection(db, "user_files"),
            where("userId", "==", currentUser.uid)
        );

        const snapshot = await getDocs(q);
        let total = 0;

        snapshot.forEach(docSnap => {
            const data = docSnap.data();
            if (data.fileSize) {
                total += data.fileSize;
            }
        });

        totalStorageUsed = total;
        document.getElementById('storage-used').textContent = formatFileSize(total);
    } catch (error) {
        console.error('Error calculating storage:', error);
    }
}
