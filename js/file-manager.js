// ========================================
// FILE MANAGER LOGIC
// ========================================

let currentFolderId = null;
let currentFilesChannelId = null;
let selectedFileItem = null;
let folderPath = []; // Stack to track navigation

// Initialize file manager event listeners
document.getElementById('create-folder-btn').addEventListener('click', () => {
    document.getElementById('create-folder-modal').classList.add('active');
});

document.getElementById('upload-file-btn').addEventListener('click', () => {
    document.getElementById('upload-file-modal').classList.add('active');
});

// Create Folder
document.getElementById('create-folder-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const folderName = document.getElementById('folder-name-input').value.trim();

    if (!folderName) {
        alert('Por favor ingresa un nombre para la carpeta');
        return;
    }

    try {
        const profile = await getUserProfile(currentUser.uid);
        const displayName = profile?.displayName || currentUser.email.split('@')[0];

        await addDoc(collection(db, "class_files"), {
            classId: currentClassId,
            channelId: currentFilesChannelId,
            name: folderName,
            type: "folder",
            parentId: currentFolderId,
            isProtected: false,
            createdAt: new Date(),
            createdBy: currentUser.uid,
            createdByName: displayName,
            lastModified: new Date(),
            lastModifiedBy: currentUser.uid,
            lastModifiedByName: displayName
        });

        document.getElementById('create-folder-modal').classList.remove('active');
        document.getElementById('folder-name-input').value = '';
    } catch (error) {
        console.error('Error creating folder:', error);
        alert('Error al crear carpeta: ' + error.message);
    }
});

// Upload File
document.getElementById('upload-file-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fileInput = document.getElementById('file-upload-input');
    const file = fileInput.files[0];

    if (!file) {
        alert('Por favor selecciona un archivo');
        return;
    }

    try {
        const profile = await getUserProfile(currentUser.uid);
        const displayName = profile?.displayName || currentUser.email.split('@')[0];

        // Show progress
        document.getElementById('upload-progress').style.display = 'block';
        document.getElementById('upload-submit-btn').disabled = true;
        document.getElementById('upload-status').textContent = 'Subiendo...';

        // Upload to YeetYourFiles
        const uploaded = await uploadToYeet(file);

        document.getElementById('upload-status').textContent = 'Guardando...';



        // Save metadata to Firestore
        await addDoc(collection(db, "class_files"), {
            classId: currentClassId,
            channelId: currentFilesChannelId,
            name: file.name,
            type: "file",
            fileUrl: uploaded.url,
            fileSize: file.size,
            contentType: file.type,
            parentId: currentFolderId,
            isProtected: false,
            createdAt: new Date(),
            createdBy: currentUser.uid,
            createdByName: displayName,
            lastModified: new Date(),
            lastModifiedBy: currentUser.uid,
            lastModifiedByName: displayName
        });

        document.getElementById('upload-file-modal').classList.remove('active');
        document.getElementById('file-upload-input').value = '';
        document.getElementById('upload-progress').style.display = 'none';
        document.getElementById('upload-submit-btn').disabled = false;
    } catch (error) {
        console.error('Error uploading file:', error);
        alert('Error al subir archivo: ' + error.message);
        document.getElementById('upload-progress').style.display = 'none';
        document.getElementById('upload-submit-btn').disabled = false;
    }
});

// Load Files and Folders
function loadFiles(channelId, folderId = null) {
    currentFilesChannelId = channelId;
    currentFolderId = folderId;

    const filesGrid = document.getElementById('files-grid');
    const emptyState = document.getElementById('files-empty-state');
    filesGrid.innerHTML = '';

    // Update breadcrumb and back button
    updateFilesBreadcrumb();

    // Query files/folders
    const q = query(
        collection(db, "class_files"),
        where("channelId", "==", channelId),
        where("parentId", "==", folderId)
    );

    onSnapshot(q, async (snapshot) => {
        filesGrid.innerHTML = '';

        if (snapshot.empty) {
            filesGrid.style.display = 'none';
            emptyState.style.display = 'block';
        } else {
            filesGrid.style.display = 'grid';
            emptyState.style.display = 'none';

            // Get class data to check permissions
            const classSnap = await getDoc(doc(db, "classes", currentClassId));
            const classData = classSnap.data();
            const isAdmin = classData.admins && classData.admins.includes(currentUser.email);
            const isProf = classData.professorId === currentUser.uid;

            const items = [];
            snapshot.forEach(doc => {
                items.push({ id: doc.id, ...doc.data() });
            });

            // Sort: folders first, then files
            items.sort((a, b) => {
                if (a.type === 'folder' && b.type !== 'folder') return -1;
                if (a.type !== 'folder' && b.type === 'folder') return 1;
                return a.name.localeCompare(b.name);
            });

            items.forEach(item => {
                renderFileItem(item, isAdmin || isProf);
            });
        }
    });
}

function renderFileItem(item, canManageProtected) {
    const filesGrid = document.getElementById('files-grid');
    const div = document.createElement('div');
    div.className = item.type === 'folder' ? 'folder-item' : 'file-item';

    if (item.isProtected && !canManageProtected) {
        div.classList.add('protected');
    }

    if (item.type === 'folder') {
        div.innerHTML = `
            <i class="fas fa-folder folder-icon"></i>
            <div class="folder-name">${item.name}</div>
            <div class="file-meta">Modificado: ${formatDate(item.lastModified)}</div>
        `;
        div.onclick = () => navigateToFolder(item.id, item.name);
    } else {
        const icon = getFileIcon(item.name, item.contentType);
        const size = formatFileSize(item.fileSize);

        div.innerHTML = `
            ${icon}
            <div class="file-name">${item.name}</div>
            <div class="file-meta">${size} • ${formatDate(item.lastModified)}</div>
            <div class="file-meta" style="font-size: 0.7rem;">Por: ${item.lastModifiedByName || 'Desconocido'}</div>
        `;
        div.onclick = () => openFile(item);
    }

    // Right-click context menu
    div.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        // Only allow context menu actions if not protected or user has permission
        if (item.isProtected && !canManageProtected) {
            return;
        }
        showContextMenu(e.clientX, e.clientY, item);
    });

    filesGrid.appendChild(div);
}

function getFileIcon(fileName, contentType) {
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

function navigateToFolder(folderId, folderName) {
    folderPath.push({ id: folderId, name: folderName });
    loadFiles(currentFilesChannelId, folderId);
}

window.navigateToParentFolder = () => {
    if (folderPath.length === 0) return;
    folderPath.pop();
    const parentFolder = folderPath.length > 0 ? folderPath[folderPath.length - 1].id : null;
    loadFiles(currentFilesChannelId, parentFolder);
};

function updateFilesBreadcrumb() {
    const breadcrumb = document.getElementById('files-breadcrumb');
    const backBtn = document.getElementById('files-back-btn');
    const folderNameEl = document.getElementById('current-folder-name');

    if (folderPath.length === 0) {
        breadcrumb.innerHTML = '<i class="fas fa-folder"></i> Raíz';
        backBtn.style.display = 'none';
        folderNameEl.textContent = 'Archivos';
    } else {
        const parts = ['<a href="#" onclick="navigateToRoot(); return false;"><i class="fas fa-folder"></i> Raíz</a>'];
        folderPath.forEach((folder, index) => {
            if (index === folderPath.length - 1) {
                parts.push(`<span>${folder.name}</span>`);
            } else {
                parts.push(`<a href="#" onclick="navigateToBreadcrumb(${index}); return false;">${folder.name}</a>`);
            }
        });
        breadcrumb.innerHTML = parts.join(' <i class="fas fa-chevron-right" style="font-size: 0.7rem; opacity: 0.5;"></i> ');
        backBtn.style.display = 'block';
        folderNameEl.textContent = folderPath[folderPath.length - 1].name;
    }
}

window.navigateToRoot = () => {
    folderPath = [];
    loadFiles(currentFilesChannelId, null);
};

window.navigateToBreadcrumb = (index) => {
    folderPath = folderPath.slice(0, index + 1);
    loadFiles(currentFilesChannelId, folderPath[index].id);
};

function openFile(item) {
    if (item.contentType && item.contentType.startsWith('image/')) {
        openMedia(item.fileUrl, 'image');
    } else if (item.name.toLowerCase().endsWith('.pdf')) {
        openMedia(item.fileUrl, 'pdf');
    } else {
        window.open(item.fileUrl, '_blank');
    }
}

// Context Menu
function showContextMenu(x, y, item) {
    selectedFileItem = item;
    const menu = document.getElementById('file-context-menu');
    menu.style.display = 'block';
    menu.style.left = x + 'px';
    menu.style.top = y + 'px';
}

// Hide context menu when clicking elsewhere
document.addEventListener('click', () => {
    document.getElementById('file-context-menu').style.display = 'none';
});

window.contextMenuAction = async (action) => {
    if (!selectedFileItem) return;

    switch (action) {
        case 'download':
            window.open(selectedFileItem.fileUrl, '_blank');
            break;
        case 'rename':
            document.getElementById('rename-item-id').value = selectedFileItem.id;
            document.getElementById('rename-input').value = selectedFileItem.name;
            document.getElementById('rename-modal').classList.add('active');
            break;
        case 'move':
            await showMoveDialog(selectedFileItem);
            break;
        case 'delete':
            if (confirm(`¿Estás seguro de eliminar "${selectedFileItem.name}"?`)) {
                await deleteFile(selectedFileItem.id);
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
        const profile = await getUserProfile(currentUser.uid);
        const displayName = profile?.displayName || currentUser.email.split('@')[0];

        await updateDoc(doc(db, "class_files", itemId), {
            name: newName,
            lastModified: new Date(),
            lastModifiedBy: currentUser.uid,
            lastModifiedByName: displayName
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
    rootDiv.innerHTML = '<i class="fas fa-folder"></i> Raíz';
    rootDiv.onclick = () => moveFileToFolder(item.id, null);
    list.appendChild(rootDiv);

    // Load all folders
    const q = query(
        collection(db, "class_files"),
        where("channelId", "==", currentFilesChannelId),
        where("type", "==", "folder")
    );

    const snapshot = await getDocs(q);
    snapshot.forEach(folderDoc => {
        const folder = folderDoc.data();
        if (folderDoc.id !== item.id) { // Don't show the item itself if it's a folder
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
        const profile = await getUserProfile(currentUser.uid);
        const displayName = profile?.displayName || currentUser.email.split('@')[0];

        await updateDoc(doc(db, "class_files", itemId), {
            parentId: newParentId,
            lastModified: new Date(),
            lastModifiedBy: currentUser.uid,
            lastModifiedByName: displayName
        });

        document.getElementById('move-file-modal').classList.remove('active');
    } catch (error) {
        console.error('Error moving:', error);
        alert('Error al mover: ' + error.message);
    }
}

async function deleteFile(itemId) {
    try {
        await deleteDoc(doc(db, "class_files", itemId));
    } catch (error) {
        console.error('Error deleting:', error);
        alert('Error al eliminar: ' + error.message);
    }
}
