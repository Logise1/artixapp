import { auth, db, storage, signOut, collection, addDoc, getDoc, getDocs, doc, query, where, onSnapshot, orderBy, updateDoc, setDoc, arrayUnion, arrayRemove, deleteDoc, ref, uploadBytes, getDownloadURL } from "./firebase-config.js";

let currentUser = null;
let currentRole = null;
let currentClassId = null;
let currentChannelId = null;

let currentChannelType = 'chat';
let activeListeners = {};

function unsubscribeFrom(key) {
    if (activeListeners[key]) {
        activeListeners[key]();
        delete activeListeners[key];
    }
}

function escapeHtml(text) {
    if (!text) return text;
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

// UI Elements
const dashboardView = document.getElementById('dashboard-view');
const classView = document.getElementById('class-view');
const classesGrid = document.getElementById('classes-grid');
const logoutBtn = document.getElementById('logout-btn');
const createClassBtn = document.getElementById('create-class-btn');
const joinClassBtn = document.getElementById('join-class-btn');
const backToDashBtn = document.getElementById('back-to-dash');
const channelsContainer = document.getElementById('channels-container');
const messagesContainer = document.getElementById('messages-container');
const directMessagesContainer = document.getElementById('direct-messages-container'); // NEW
const messageForm = document.getElementById('message-form');
const directMessageForm = document.getElementById('direct-message-form'); // NEW
const tasksView = document.getElementById('tasks-view');
const messagesView = document.getElementById('messages-view');
const settingsView = document.getElementById('settings-view');
const tasksContainer = document.getElementById('tasks-container');

// State for View Navigation
let currentMainView = 'classes'; // 'classes' or 'chats'
let activeMessageContainer = messagesContainer; // Reference to currently active container

let myBlockedUsers = [];
let pinnedChats = [];

// Auth State Helper: Update UI with Profile Data
async function updateProfileUI(user) {
    document.getElementById('user-email').textContent = user.email;
    const avatarEl = document.getElementById('current-user-avatar');

    // Check if we have extended user data (photoURL) in Firestore
    try {
        const userDoc = await getDoc(doc(db, "users", user.uid));
        if (userDoc.exists()) {
            const data = userDoc.data();
            currentRole = data.role || 'student';
            myBlockedUsers = data.blockedUsers || [];
            pinnedChats = data.pinnedChats || [];

            // Render Avatar
            if (data.photoURL) {
                avatarEl.innerHTML = `<img src="${data.photoURL}" alt="Profile"><input type="file" id="profile-upload-input" style="display:none;" accept="image/*"><div class="profile-overlay"><i class="fas fa-camera"></i></div>`;
            } else {
                avatarEl.innerHTML = `<span>${user.email[0].toUpperCase()}</span><input type="file" id="profile-upload-input" style="display:none;" accept="image/*"><div class="profile-overlay"><i class="fas fa-camera"></i></div>`;
            }
            // Re-attach listener because innerHTML wiped it
            attachProfileUploadListener();

            setupUIForRole();
            loadClasses();
        } else {
            // ... existing fallback ...
            avatarEl.querySelector('span').textContent = user.email[0].toUpperCase();
        }
    } catch (err) {
        console.error(err);
    }
}

window.toggleBlockUser = async (targetUid) => {
    if (!currentUser) return;

    // Check if already blocked
    const isBlocked = myBlockedUsers.includes(targetUid);

    if (confirm(isBlocked ? "¿Desbloquear a este usuario?" : "¿Bloquear a este usuario? No verás sus mensajes.")) {
        try {
            if (isBlocked) {
                await updateDoc(doc(db, "users", currentUser.uid), {
                    blockedUsers: arrayRemove(targetUid)
                });
                myBlockedUsers = myBlockedUsers.filter(id => id !== targetUid);
                alert("Usuario desbloqueado.");
            } else {
                await updateDoc(doc(db, "users", currentUser.uid), {
                    blockedUsers: arrayUnion(targetUid)
                });
                myBlockedUsers.push(targetUid);
                alert("Usuario bloqueado.");
            }

            // Refresh current view if needed
            if (currentDirectChatId) {
                const currentChatName = document.getElementById('direct-chat-header-name').textContent;
                // We need the UID, which we might not have explicitly in the header var, but selectDirectChat has logic.
                // We will reload the chat header logic.
                // Or better, just reload the page or re-select.

                // Hack: Re-click the active chat item
                const activeItem = document.querySelector('.chat-list-item.active');
                if (activeItem) activeItem.click();
            }

        } catch (err) {
            console.error(err);
            alert("Error al actualizar bloqueo: " + err.message);
        }
    }
};

function attachProfileUploadListener() {
    const avatarData = document.getElementById('current-user-avatar');
    const input = document.getElementById('profile-upload-input');

    avatarData.onclick = (e) => {
        if (e.target !== input) input.click();
    };

    input.onchange = async () => {
        const file = input.files[0];
        if (!file) return;

        try {
            // Optimistic Update
            const reader = new FileReader();
            reader.onload = (e) => {
                avatarData.querySelector('img')
                    ? (avatarData.querySelector('img').src = e.target.result)
                    : (avatarData.innerHTML = `<img src="${e.target.result}"><input type="file" id="profile-upload-input" style="display:none;" accept="image/*"><div class="profile-overlay"><i class="fas fa-camera"></i></div>`);
                attachProfileUploadListener(); // Re-attach
            };
            reader.readAsDataURL(file);

            // Upload
            const uploaded = await uploadToYeet(file);

            // Update Firestore
            await updateDoc(doc(db, "users", currentUser.uid), {
                photoURL: uploaded.url
            });

        } catch (err) {
            console.error(err);
            alert("Error al actualizar la foto de perfil.");
        }
    };
}


// ... (Existing messages logic) ...




// Auth Listener Update to call new updateProfileUI
auth.onAuthStateChanged(async (user) => {
    if (!user) {
        window.location.href = 'login.html';
        return;
    }
    currentUser = user;

    // NEW: Update Profile UI
    await updateProfileUI(user);
});


function setupUIForRole() {
    // Basic Role UI (Prof/Admin vs Student)
    // Note: admins are students with elevated privileges in a specific class, 
    // but top-level 'role' in User doc is global. 
    // We'll handle Class-Level Admin logic inside class view.

    if (currentRole === 'professor') {
        createClassBtn.style.display = 'block';
        joinClassBtn.style.display = 'none';
        document.querySelectorAll('.prof-only').forEach(el => el.style.display = 'block'); // Global prof-only
    } else {
        createClassBtn.style.display = 'none';
        joinClassBtn.style.display = 'block';
        document.querySelectorAll('.prof-only').forEach(el => el.style.display = 'none');
    }
}

window.switchRole = async (newRole) => {
    if (!currentUser) return;
    if (confirm(`¿Cambiar tipo de cuenta a ${newRole}? Esto recargará la página.`)) {
        try {
            await updateDoc(doc(db, "users", currentUser.uid), {
                role: newRole
            });
            window.location.reload();
        } catch (err) {
            alert("Error: " + err.message);
        }
    }
};

// ----------------------
// MAIN NAVIGATION (Rail)
// ----------------------
window.switchMainView = (viewName) => {
    currentMainView = viewName;

    // Update Rail UI
    document.querySelectorAll('.rail-item').forEach(el => el.classList.remove('active'));
    if (viewName === 'classes') document.getElementById('nav-classes').classList.add('active');
    if (viewName === 'chats') document.getElementById('nav-chats').classList.add('active');

    // Update Main Area UI
    if (viewName === 'classes') {
        document.getElementById('direct-chat-view').style.display = 'none';

        // Restore class view state or dashboard
        if (currentClassId) {
            dashboardView.style.display = 'none';
            classView.style.display = 'flex';
        } else {
            dashboardView.style.display = 'block';
            classView.style.display = 'none';
        }
    } else {
        // Chats
        unsubscribeFrom('classes'); // Optional if we want to stop listening to class list updates while in chat view
        dashboardView.style.display = 'none';
        classView.style.display = 'none';
        document.getElementById('direct-chat-view').style.display = 'flex';
        loadDirectChats();
    }
};

// ----------------------
// CLASSES LOGIC
// ----------------------

async function loadClasses() {
    classesGrid.innerHTML = '<div class="loader">Cargando...</div>';

    let q;
    if (currentRole === 'professor') {
        q = query(collection(db, "classes"), where("professorId", "==", currentUser.uid));
    } else {
        q = query(collection(db, "classes"), where("studentEmails", "array-contains", currentUser.email));
    }

    unsubscribeFrom('classes');
    activeListeners['classes'] = onSnapshot(q, (snapshot) => {
        classesGrid.innerHTML = '';
        if (snapshot.empty) {
            classesGrid.innerHTML = `
                <div style="text-align:center; grid-column: 1/-1; padding: 40px; color: var(--text-dim);">
                    <i class="fas fa-school" style="font-size: 3rem; margin-bottom: 20px; opacity: 0.5;"></i>
                    <p style="font-size:1.1rem; margin-bottom:10px;">No se encontraron clases.</p>
                    ${currentRole === 'professor'
                    ? '<p>¡Crea tu primera clase para empezar!</p>'
                    : `<p>Haz clic en "Unirse con Código" para entrar a una clase.</p>`
                }
                </div>
            `;
            return;
        }

        snapshot.forEach((doc) => {
            renderClassCard(doc.id, doc.data());
        });
    }, (error) => {
        console.error("Error loading classes:", error);
        classesGrid.innerHTML = `<p class="error">Error cargando clases: ${error.message}</p>`;
    });
}

function renderClassCard(id, data) {
    const card = document.createElement('div');
    card.className = 'class-card';

    // Generate gradient
    const hue = data.name.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0) % 360;
    const gradient = `linear-gradient(135deg, hsl(${hue}, 70%, 60%), hsl(${hue + 40}, 70%, 40%))`;

    card.innerHTML = `
        <div class="class-header" style="background: ${gradient}">
            <div class="class-title">${escapeHtml(data.name)}</div>
        </div>
        <div class="class-body">
            <div class="class-info">
                <i class="fas fa-users" style="margin-right: 6px;"></i>
                ${data.studentEmails ? data.studentEmails.length : 0} Estudiantes
            </div>
            <div style="font-size: 0.8rem; color: #64748b; margin-top: auto;">
                Código: <strong>${data.code || 'N/A'}</strong>
            </div>
        </div>
    `;
    card.addEventListener('click', () => enterClass(id, data));
    classesGrid.appendChild(card);
}

// Create Class
const createClassModal = document.getElementById('create-class-modal');
const createClassForm = document.getElementById('create-class-form');

createClassBtn.addEventListener('click', () => createClassModal.classList.add('active'));

createClassForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('new-class-name').value;
    const code = Math.random().toString(36).substring(2, 8).toUpperCase(); // 6 chars random ID

    try {
        const classRef = await addDoc(collection(db, "classes"), {
            name: name,
            professorId: currentUser.uid,
            code: code,
            createdAt: new Date(),
            studentEmails: [],
            admins: [], // Array of emails of class admins
            settings: {
                emojisEnabled: true
            }
        });

        // Create default general channel
        await addDoc(collection(db, "channels"), {
            classId: classRef.id,
            name: "general",
            type: "chat",
            createdAt: new Date()
        });

        // Create files channel
        const filesChannelRef = await addDoc(collection(db, "channels"), {
            classId: classRef.id,
            name: "archivos",
            type: "files",
            createdAt: new Date()
        });

        // Create "Materiales de clase" folder (protected, only admins and professors can manage)
        await addDoc(collection(db, "class_files"), {
            classId: classRef.id,
            channelId: filesChannelRef.id,
            name: "Materiales de clase",
            type: "folder",
            parentId: null,
            isProtected: true, // Only admins and professors can edit/delete
            createdAt: new Date(),
            createdBy: currentUser.uid,
            lastModified: new Date(),
            lastModifiedBy: currentUser.uid
        });

        createClassModal.classList.remove('active');
        document.getElementById('new-class-name').value = '';
    } catch (err) {
        alert("Error creando clase: " + err.message);
    }
});

// Join Class
const joinClassModal = document.getElementById('join-class-modal');
const joinClassForm = document.getElementById('join-class-form');

joinClassBtn.addEventListener('click', () => joinClassModal.classList.add('active'));

joinClassForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const code = document.getElementById('join-code-input').value.toUpperCase().trim();

    try {
        const q = query(collection(db, "classes"), where("code", "==", code));
        const limitSnapshot = await getDocs(q); // Should be unique

        if (limitSnapshot.empty) {
            alert("Código de Clase Inválido");
            return;
        }

        const classDoc = limitSnapshot.docs[0];
        const classData = classDoc.data();

        if (classData.studentEmails && classData.studentEmails.includes(currentUser.email)) {
            alert("¡Ya estás en esta clase!");
            joinClassModal.classList.remove('active');
            return;
        }

        await updateDoc(doc(db, "classes", classDoc.id), {
            studentEmails: arrayUnion(currentUser.email)
        });

        alert("¡Te has unido a la clase con éxito!");
        joinClassModal.classList.remove('active');
        document.getElementById('join-code-input').value = '';
    } catch (err) {
        console.error(err);
        alert("Error al unirse a la clase: " + err.message);
    }
});


// ----------------------
// CLASS NAVIGATION
// ----------------------

async function enterClass(classId, classData) {
    currentClassId = classId;
    document.getElementById('current-class-name').textContent = classData.name;
    document.getElementById('display-join-code').textContent = classData.code;

    dashboardView.style.display = 'none';
    classView.style.display = 'flex';

    loadChannels(classId);
}

backToDashBtn.addEventListener('click', () => {
    classView.style.display = 'none';
    dashboardView.style.display = 'block';
    currentClassId = null;
    currentChannelId = null;
});

// ----------------------
// CHANNELS LOGIC
// ----------------------

function loadChannels(classId) {
    // Use single orderBy to avoid composite index requirement issues initially
    // We will do client side sorting for order if needed, but for now simple createdAt is safer without index setup
    const q = query(collection(db, "channels"), where("classId", "==", classId));

    // Setup Drag and Drop Container
    if (currentRole === 'professor') {
        setupDragAndDrop(channelsContainer);
    }

    unsubscribeFrom('channels');
    activeListeners['channels'] = onSnapshot(q, (snapshot) => {
        channelsContainer.innerHTML = '';
        const channels = [];
        snapshot.forEach((doc) => {
            channels.push({ id: doc.id, ...doc.data() });
        });

        // Client-side sort: Order first (asc), then CreatedAt (asc)
        channels.sort((a, b) => {
            const orderA = a.order || 0;
            const orderB = b.order || 0;
            if (orderA !== orderB) return orderA - orderB;
            return (a.createdAt?.seconds || 0) - (b.createdAt?.seconds || 0);
        });

        let firstChannel = null;
        channels.forEach(ch => {
            if (!firstChannel) firstChannel = ch;
            renderChannelItem(ch.id, ch);
        });

        // Add Separator and Settings Item
        // Add Separator and Settings Item
        if (currentRole === 'professor') {
            const sep = document.createElement('div');
            sep.style.cssText = 'height: 1px; background: var(--border-color); margin: 10px 12px; opacity: 0.5;';
            channelsContainer.appendChild(sep);

            const addBtn = document.createElement('div');
            addBtn.className = 'channel-item';
            addBtn.style.color = 'var(--primary)';
            addBtn.innerHTML = '<span class="channel-icon"><i class="fas fa-plus"></i></span><span>Nuevo Canal</span>';
            addBtn.addEventListener('click', () => document.getElementById('add-channel-btn').click());
            channelsContainer.appendChild(addBtn);
        }

        const separator = document.createElement('div');
        separator.style.cssText = 'height: 1px; background: var(--border-color); margin: 10px 12px; opacity: 0.5;';
        channelsContainer.appendChild(separator);

        const settingsDiv = document.createElement('div');
        settingsDiv.className = `channel-item ${currentChannelType === 'settings' ? 'active' : ''}`;
        settingsDiv.innerHTML = `
            <span class="channel-icon"><i class="fas fa-cog"></i></span>
            <span>Configuración</span>
        `;
        settingsDiv.addEventListener('click', () => openSettings());
        channelsContainer.appendChild(settingsDiv);

        // Only select first channel manually if we are not already in settings and no channel selected
        if (!currentChannelId && currentChannelType !== 'settings' && firstChannel) {
            selectChannel(firstChannel.id, firstChannel);
        } else if (currentChannelId) {
            // Keep current selection visual handled by re-render roughly,
            // but if we are in settings, visual is handled by openSettings()
        }
    });
}

function renderChannelItem(id, data) {
    const div = document.createElement('div');
    div.className = `channel-item ${currentChannelId === id ? 'active' : ''} ${currentRole === 'professor' ? 'draggable' : ''}`;

    if (currentRole === 'professor') {
        div.draggable = true;
        div.dataset.id = id;
        div.dataset.order = data.order || 0;
    }

    let settingsIcon = '';
    if (currentRole === 'professor') {
        settingsIcon = `<i class="fas fa-cog" style="margin-left:auto; opacity:0.5; font-size:0.8rem;" onclick="event.stopPropagation(); openChannelSettings('${id}')"></i>`;
    }

    div.innerHTML = `
        <span class="channel-icon"><i class="fas ${data.type === 'tasks' ? 'fa-clipboard-list' : data.type === 'files' ? 'fa-folder' : 'fa-hashtag'}"></i></span>
        <span>${escapeHtml(data.name)}</span>
        ${settingsIcon}
    `;
    div.addEventListener('click', () => selectChannel(id, data));
    channelsContainer.appendChild(div);
}

// Drag and Drop Logic
function setupDragAndDrop(container) {
    container.addEventListener('dragstart', e => {
        if (e.target.classList.contains('draggable')) {
            e.target.classList.add('dragging');
        }
    });

    container.addEventListener('dragend', async e => {
        if (e.target.classList.contains('draggable')) {
            e.target.classList.remove('dragging');
            await saveChannelOrder();
        }
    });

    container.addEventListener('dragover', e => {
        e.preventDefault();
        const afterElement = getDragAfterElement(container, e.clientY);
        const draggable = document.querySelector('.dragging');
        if (draggable) {
            if (afterElement == null) {
                // Insert before the static "New Channel" button if it exists, otherwise append
                // Actually channelsContainer has static elements at bottom (separator, settings).
                // We should only reorder valid channel items. 
                // Simple approach: Insert before 'afterElement'
                container.insertBefore(draggable, afterElement);
            } else {
                container.insertBefore(draggable, afterElement);
            }
        }
    });
}

function getDragAfterElement(container, y) {
    // Select only draggable channel items, ignore static ones
    const draggableElements = [...container.querySelectorAll('.draggable:not(.dragging)')];

    return draggableElements.reduce((closest, child) => {
        const box = child.getBoundingClientRect();
        const offset = y - box.top - box.height / 2;
        if (offset < 0 && offset > closest.offset) {
            return { offset: offset, element: child };
        } else {
            return closest;
        }
    }, { offset: Number.NEGATIVE_INFINITY }).element;
}

async function saveChannelOrder() {
    const items = [...document.querySelectorAll('.channel-item.draggable')];
    const updates = items.map((item, index) => {
        const id = item.dataset.id;
        return updateDoc(doc(db, "channels", id), {
            order: index
        });
    });

    // Optimistic update implied by DOM change, but let's await
    try {
        await Promise.all(updates);
    } catch (e) {
        console.error("Error saving order", e);
    }
}

window.openChannelSettings = async (channelId) => {
    const docSnap = await getDoc(doc(db, "channels", channelId));
    if (!docSnap.exists()) return;
    const data = docSnap.data();

    document.getElementById('edit-channel-id').value = channelId;
    document.getElementById('edit-channel-name').value = data.name;
    document.getElementById('edit-channel-admin-only').checked = !!data.adminOnly;
    document.getElementById('edit-channel-order').value = data.order || 0;

    document.getElementById('channel-settings-modal').classList.add('active');
};

document.getElementById('channel-settings-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('edit-channel-id').value;
    const name = document.getElementById('edit-channel-name').value;
    const adminOnly = document.getElementById('edit-channel-admin-only').checked;
    const order = parseInt(document.getElementById('edit-channel-order').value) || 0;

    await updateDoc(doc(db, "channels", id), {
        name, adminOnly, order
    });

    document.getElementById('channel-settings-modal').classList.remove('active');
});

window.deleteCurrentChannel = async () => {
    const id = document.getElementById('edit-channel-id').value;
    if (confirm("¿Eliminar este canal y todos sus mensajes?")) {
        await deleteDoc(doc(db, "channels", id));
        document.getElementById('channel-settings-modal').classList.remove('active');
        // Logic to clear view handled by listener usually, but might need forced reset if current channel
        if (currentChannelId === id) {
            messagesContainer.innerHTML = '';
            currentChannelId = null;
        }
    }
};

function selectChannel(id, data) {
    currentChannelId = id;
    currentChannelType = data.type;
    document.getElementById('current-channel-name').textContent = data.name;

    // Unsubscribe from previous channel views
    unsubscribeFrom('messages');
    unsubscribeFrom('tasks');
    unsubscribeFrom('files');

    document.querySelectorAll('.channel-item').forEach(el => el.classList.remove('active'));
    // Re-rendering happens on snapshot, this is visual feedback for instant click

    // Clear views immediately to avoid ghost content
    messagesContainer.innerHTML = '';
    tasksContainer.innerHTML = '';

    // Hide all views first
    messagesView.style.display = 'none';
    tasksView.style.display = 'none';
    settingsView.style.display = 'none';
    const filesView = document.getElementById('files-view');
    if (filesView) filesView.style.display = 'none';

    if (data.type === 'tasks') {
        tasksView.style.display = 'flex';
        loadTasks(id);
    } else if (data.type === 'files') {
        if (filesView) {
            filesView.style.display = 'flex';
            loadFiles(id, null); // Load root files
        }
    } else {
        messagesView.style.display = 'flex';
        // Admin Only Check
        checkChannelPermissions(id);
        loadMessages(id);
    }
}

async function checkChannelPermissions(channelId) {
    // Reset inputs
    document.getElementById('message-input').disabled = false;
    document.getElementById('message-input').placeholder = "Escribe un mensaje...";
    document.querySelector('#message-form button').disabled = false;

    const snap = await getDoc(doc(db, "channels", channelId));
    if (!snap.exists()) return;
    const data = snap.data();

    // Check if user is Class Admin or Professor
    const classSnap = await getDoc(doc(db, "classes", currentClassId));
    if (!classSnap.exists()) return;
    const classData = classSnap.data();

    const isAdmin = classData.admins && classData.admins.includes(currentUser.email);
    const isProf = classData.professorId === currentUser.uid;

    if (data.adminOnly && !isAdmin && !isProf) {
        document.getElementById('message-input').disabled = true;
        document.getElementById('message-input').placeholder = "Solo administradores pueden enviar mensajes aquí.";
        document.querySelector('#message-form button').disabled = true;
    }
}

// Create Channel
const createChannelModal = document.getElementById('create-channel-modal');
const createChannelForm = document.getElementById('create-channel-form');
document.getElementById('add-channel-btn').addEventListener('click', () => createChannelModal.classList.add('active'));

createChannelForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('new-channel-name').value;
    const type = document.getElementById('channel-type').value;

    await addDoc(collection(db, "channels"), {
        classId: currentClassId,
        name: name,
        type: type,
        adminOnly: document.getElementById('channel-admin-only').checked,
        createdAt: new Date()
    });
    createChannelModal.classList.remove('active');
});

// ----------------------
// FILE UPLOAD HELPER (YeetYourFiles)
// ----------------------
// ----------------------
// FILE UPLOAD HELPER (GreenBase)
// ----------------------
async function uploadToYeet(file) {
    const formData = new FormData();
    formData.append('file', file);

    try {
        const response = await fetch('https://greenbase.arielcapdevila.com/upload', {
            method: 'POST',
            body: formData
        });

        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`Error en la subida: ${response.status} - ${errText}`);
        }

        const data = await response.json();
        return {
            url: `https://greenbase.arielcapdevila.com/file/${data.id}`,
            filename: file.name
        };
    } catch (err) {
        console.error(err);
        throw new Error("Error al subir archivo: " + err.message);
    }
}

// ----------------------
// ----------------------
// MESSAGES LOGIC
// ----------------------

const chatFileInput = document.getElementById('chat-file-input');
const chatPreview = document.getElementById('chat-upload-preview');
let currentChatFile = null;

chatFileInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (file) {
        currentChatFile = file;
        chatPreview.style.display = 'block';
        chatPreview.innerHTML = `<i class="fas fa-paperclip"></i> ${file.name} (Listo para enviar)`;
    }
});

/* Reply State */
let replyState = null; // { id, userName, text }

window.startReply = (id, userName, text) => {
    replyState = { id, userName, text };
    const indicator = currentMainView === 'chats' ? document.getElementById('direct-reply-indicator-container') : document.getElementById('reply-indicator-container');
    indicator.style.display = 'block';
    indicator.innerHTML = `Replying to <b>${userName}</b>: ${text} <button onclick="cancelReply()" style="margin-left:10px; border:none; background:transparent;">&times;</button>`;

    if (currentMainView === 'chats') document.getElementById('direct-message-input').focus();
    else document.getElementById('message-input').focus();
};

window.cancelReply = () => {
    replyState = null;
    document.getElementById('reply-indicator-container').style.display = 'none';
    document.getElementById('direct-reply-indicator-container').style.display = 'none';
};

/* Media Viewer */
window.openMedia = (url, type) => {
    const modal = document.getElementById('media-viewer-modal');
    const content = document.getElementById('media-viewer-content');

    if (type === 'image') {
        content.innerHTML = `<img src="${url}">`;
    } else if (type === 'pdf') {
        content.innerHTML = `<iframe src="${url}"></iframe>`;
    }

    modal.classList.add('active');
};
// Make sure to define refreshUserAvatars BEFORE it's called in renderMessage
// ----------------------
// GLOBAL USER CACHE
// ----------------------
const userCache = {}; // { uid: { photoURL, email, displayName, ... } }
const emailToUidCache = {};

async function getUserProfile(uid) {
    if (userCache[uid]) return userCache[uid];

    // Check if UID is actually an email (Unregistered User)
    if (uid.includes('@')) {
        try {
            // Whitelist IDs are emails (check casing logic or query?) 
            // The script saves them as doc IDs? No, the script used normalized keys or patch to studentwhitelist/email.
            // Firestore IDs for the whitelist were set to the email in the script.
            // Let's try direct get, or query if casing mismatch.
            const snap = await getDoc(doc(db, "studentwhitelist", uid));
            if (snap.exists()) {
                const data = snap.data();
                userCache[uid] = { ...data, photoURL: data.photoURL, displayName: data.name };
                return userCache[uid];
            } else {
                // Try lowercase fallback just in case
                const snapLower = await getDoc(doc(db, "studentwhitelist", uid.toLowerCase()));
                if (snapLower.exists()) {
                    const data = snapLower.data();
                    userCache[uid] = { ...data, photoURL: data.photoURL, displayName: data.name };
                    return userCache[uid];
                }
            }
        } catch (e) { console.error(e); }
        return null; // Not found
    }

    try {
        const snap = await getDoc(doc(db, "users", uid));
        if (snap.exists()) {
            const data = snap.data();

            // Fallback: If no photoURL, check whitelist using their email
            if (!data.photoURL && data.email) {
                try {
                    const wSnap = await getDoc(doc(db, "studentwhitelist", data.email));
                    if (wSnap.exists() && wSnap.data().photoURL) {
                        data.photoURL = wSnap.data().photoURL;
                    } else {
                        // Try lowercase
                        const wSnapL = await getDoc(doc(db, "studentwhitelist", data.email.toLowerCase()));
                        if (wSnapL.exists() && wSnapL.data().photoURL) {
                            data.photoURL = wSnapL.data().photoURL;
                        }
                    }
                } catch (err) { console.error("Whitelist fallback error", err); }
            }

            userCache[uid] = data;
            return data;
        }
    } catch (e) {
        console.error(e);
    }
    return null;
}

async function getUserProfileByEmail(email) {
    if (emailToUidCache[email] && userCache[emailToUidCache[email]]) {
        return userCache[emailToUidCache[email]];
    }

    try {
        const q = query(collection(db, "users"), where("email", "==", email));
        const snaps = await getDocs(q);
        if (!snaps.empty) {
            const data = snaps.docs[0].data();
            const uid = snaps.docs[0].id;
            userCache[uid] = data;
            emailToUidCache[email] = uid;
            return data;
        }
    } catch (e) { console.error(e); }
    return null;
}

// Updates all avatar elements for a specific user ID on the page
async function refreshUserAvatars(uid) {
    const profile = await getUserProfile(uid);
    const photoURL = profile ? profile.photoURL : null;

    if (photoURL) {
        // Use attribute selector to avoid issues with @ and . in UIDs (emails)
        // We match any element that has the specific class
        // Since class list is space separated, [class*="..."] might be loose but [class~="..."] works for exact word match
        // But `user-avatar-${uid}` is a single class string.
        // Let's use CSS.escape if available or attribute selector.
        // safest: 
        const selector = `[class*="user-avatar-${uid.replace(/["\\]/g, '\\$&')}"]`;
        // actually simple getElementsByClassName is fastest/safest?
        // But we want specific ones. 
        // Let's use attribute selector with exact substring if possible or just use escaped UID.

        // Simpler: iterate all avatars? No too slow.
        // Let's try CSS.escape pattern manually?
        // Actually, if we use setAttribute('data-userid', uid), it is much cleaner.

        // Let's stick to the class strategy but fix the selector
        // .user-avatar-someone@example.com -> invalid selector directly.
        // CSS.escape("user-avatar-" + uid) works in modern browsers.
        try {
            const escapedClass = CSS.escape(`user-avatar-${uid}`);
            document.querySelectorAll(`.${escapedClass}`).forEach(el => {
                el.innerHTML = `<img src="${photoURL}" style="width:100%; height:100%; border-radius:50%; object-fit:cover;">`;
            });
        } catch (e) {
            // Fallback for older browsers or if CSS.escape missing (unlikely in modern web app)
            // Try attribute selector
            document.querySelectorAll(`[class*="user-avatar-${uid}"]`).forEach(el => {
                // Double check strict match to avoid partials (e.g. user-avatar-rob vs user-avatar-robert)
                if (el.classList.contains(`user-avatar-${uid}`)) {
                    el.innerHTML = `<img src="${photoURL}" style="width:100%; height:100%; border-radius:50%; object-fit:cover;">`;
                }
            });
        }
    }
}


function loadMessages(channelId, containerOverride = null) {
    const targetContainer = containerOverride || messagesContainer;
    activeMessageContainer = targetContainer; // Update global reference

    // Clear immediately
    targetContainer.innerHTML = '';

    const q = query(collection(db, "messages"), where("channelId", "==", channelId), orderBy("createdAt", "asc"));

    unsubscribeFrom('messages');
    activeListeners['messages'] = onSnapshot(q, (snapshot) => {
        targetContainer.innerHTML = '';
        snapshot.forEach((doc) => {
            // Pass ID by merging it
            renderMessage({ id: doc.id, ...doc.data() }, targetContainer);
        });
        targetContainer.scrollTop = targetContainer.scrollHeight;
    });
}

function renderMessage(data, container = activeMessageContainer) {
    if (!container) return; // Safety check

    // Filter Blocked Users
    if (myBlockedUsers.includes(data.userId)) return;

    const div = document.createElement('div');
    div.className = 'message';
    div.id = `msg-${data.id}`;

    // Determine Avatar (Use stored photoURL if available, else letter)
    // We add a specific class to update this avatar later if the user profile changes or if we want to confirm the latest photo
    // We try to use the stored userPhoto as immediate placeholder
    let avatarHtml = `<div class="avatar user-avatar-${data.userId}">${data.userName[0].toUpperCase()}</div>`;
    if (data.userPhoto) {
        avatarHtml = `<div class="avatar user-avatar-${data.userId}"><img src="${data.userPhoto}"></div>`;
    }

    // Trigger async refresh to ensure we have the very latest photo from the user Profile (normalization)
    if (data.userId) refreshUserAvatars(data.userId);

    // Determine Content
    let content = `<p>${escapeHtml(data.text)}</p>`;

    if (data.type === 'file') {
        const isImg = data.contentType && data.contentType.startsWith('image');
        const isPdf = data.fileName.toLowerCase().endsWith('.pdf');

        if (isImg) {
            // Image Card
            content += `
                <div class="teams-attachment-card" onclick="openMedia('${data.fileUrl}', 'image')">
                    <div class="card-preview">
                        <img src="${data.fileUrl}">
                        <div class="preview-overlay">
                            <div class="preview-btn"><i class="fas fa-expand"></i> Ver</div>
                        </div>
                    </div>
                     <div class="card-metadata">
                        <div class="file-icon-large file-icon-img"><i class="fas fa-image"></i></div>
                        <div class="file-info">
                            <div class="filename">${data.fileName}</div>
                        </div>
                    </div>
                </div>
            `;
        } else if (isPdf) {
            content += `
                 <div class="teams-attachment-card" onclick="openMedia('${data.fileUrl}', 'pdf')">
                    <div class="card-preview pdf-preview">
                        <div class="fake-doc">
                            <div class="fake-doc-header"><i class="fas fa-file-pdf"></i></div>
                            <div class="fake-doc-line"></div>
                            <div class="fake-doc-line"></div>
                            <div class="fake-doc-line short"></div>
                            <div class="fake-doc-line"></div>
                            <div class="fake-doc-line"></div>
                        </div>
                         <div class="preview-overlay">
                            <div class="preview-btn"><i class="fas fa-eye"></i> Leer</div>
                        </div>
                    </div>
                    <div class="card-metadata">
                        <div class="file-icon-large file-icon-pdf"><i class="fas fa-file-pdf"></i></div>
                        <div class="file-info">
                            <div class="filename">${data.fileName}</div>
                        </div>
                    </div>
                </div>
            `;
        } else {
            // Generic Download Only
            content += `
                <div class="teams-attachment-card" onclick="window.open('${data.fileUrl}')">
                     <div class="card-preview" style="background:#f8fafc; color:#cbd5e1;">
                         <i class="fas fa-file" style="font-size:3rem;"></i>
                    </div>
                    <div class="card-metadata">
                        <div class="file-icon-large"><i class="fas fa-file-alt"></i></div>
                        <div class="file-info">
                            <div class="filename">${data.fileName}</div>
                        </div>
                    </div>
                </div>
            `;
        }
    }

    // Reply Quote
    let replyHtml = '';
    if (data.replyTo) {
        replyHtml = `
            <div class="quoted-message">
                <strong>${data.replyTo.userName}</strong>: ${escapeHtml(data.replyTo.text)}
            </div>
        `;
    }

    // Message Actions (Delete for Prof)
    let deleteBtn = '';

    // Check if I am professor of this class
    if (currentRole === 'professor') {
        deleteBtn = `<button class="reply-btn" style="color:#ef4444;" onclick="deleteMessage('${data.id}')"><i class="fas fa-trash"></i></button>`;
    }

    div.innerHTML = `
        ${avatarHtml}
        <div class="msg-content" style="flex:1;">
            <h4>
                ${escapeHtml(data.userName)} 
                <span style="font-size:0.75rem; color:var(--text-dim); font-weight:400; margin-left:8px;">
                    ${new Date(data.createdAt.toDate()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
            </h4>
            ${replyHtml}
            ${content}
            <div class="message-actions" style="display:flex; gap:10px;">
                <button class="reply-btn" onclick="startReply('${data.id}', '${data.userName}', '${data.text ? escapeHtml(data.text.substr(0, 40)).replace(/'/g, "\\'") + '...' : 'Archivo'}')">
                    <i class="fas fa-reply"></i> Responder
                </button>
                ${deleteBtn}
            </div>
        </div>
    `;

    container.appendChild(div);
}

window.deleteMessage = async (msgId) => {
    if (confirm("¿Borrar mensaje?")) {
        await deleteDoc(doc(db, "messages", msgId));
    }
};




// SEND MESSAGE LOGIC (Refactored to support Direct Chats)
async function handleSendMessage(inputEl, fileInputEl, formPreviewEl, channelId, formElement) {
    const text = inputEl.value;
    const fileFile = fileInputEl.files[0];

    if (!text.trim() && !fileFile) return;

    let fileData = null;
    let msgType = 'text';

    if (fileFile) {
        formPreviewEl.innerHTML = 'Uploading... <i class="fas fa-spinner fa-spin"></i>';
        formPreviewEl.style.display = 'block';
        try {
            const uploaded = await uploadToYeet(fileFile);
            fileData = {
                fileUrl: uploaded.url,
                fileName: uploaded.filename,
                contentType: fileFile.type
            };
            msgType = 'file';
        } catch (err) {
            alert(err.message);
            formPreviewEl.style.display = 'none';
            fileInputEl.value = '';
            return;
        }
    }

    // Get current user photo and display name
    let userPhoto = null;
    let displayName = currentUser.email.split('@')[0]; // Default fallback

    try {
        // We can reuse the getUserProfile cache function if we move it up or just fetch here
        // Since we are inside module, we can access getUserProfile if defined in scope.
        // But getUserProfile is defined above.
        const profile = await getUserProfile(currentUser.uid);
        if (profile) {
            userPhoto = profile.photoURL || null;
            if (profile.displayName) displayName = profile.displayName;
            else if (profile.firstName && profile.lastName) displayName = `${profile.firstName} ${profile.lastName}`;
        }
    } catch (e) { console.error("Error fetching user profile for message", e); }

    const msgData = {
        channelId: channelId,
        text: text,
        userId: currentUser.uid,
        userName: displayName,
        // userPhoto: userPhoto,  <-- REMOVED to ensure dynamic updates via profile fetch
        createdAt: new Date(),
        type: msgType,
        ...fileData
    };

    if (replyState) {
        msgData.replyTo = {
            id: replyState.id,
            userName: replyState.userName,
            text: replyState.text
        };
    }

    await addDoc(collection(db, "messages"), msgData);

    // Update Direct Chat metadata (unhide, lastUpdated)
    if (msgData.type === 'text' || msgData.type === 'file') {
        // We do this for both class channels and direct chats, but 'hiddenBy' only exists on direct_chats usually.
        // It's safe to try updating if we know it corresponds to a direct chat doc structure, 
        // but 'channelId' is the doc ID. Mixed collections?
        // The app seems to separate logic by view, but handleSendMessage is shared.
        // We should check if we are in direct chat mode.
        if (currentDirectChatId && channelId === currentDirectChatId) {
            try {
                // Clear hiddenBy so it reappears for everyone, update time
                await updateDoc(doc(db, "direct_chats", channelId), {
                    hiddenBy: [],
                    lastUpdated: new Date()
                });
            } catch (e) { console.log("Not a direct chat or update failed", e); }
        }
    }

    cancelReply();
    inputEl.value = '';
    formPreviewEl.style.display = 'none';
    fileInputEl.value = '';
    // Reset file global tracking if using old one (will deprecate)
    currentChatFile = null;
}

messageForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!currentChannelId) return;
    await handleSendMessage(
        document.getElementById('message-input'),
        chatFileInput, // Using global variable or query selector? chatFileInput is defined top of file
        chatPreview,
        currentChannelId,
        messageForm
    );
});

directMessageForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!currentDirectChatId) return;
    await handleSendMessage(
        document.getElementById('direct-message-input'),
        document.getElementById('direct-chat-file-input'),
        document.getElementById('direct-chat-upload-preview'),
        currentDirectChatId,
        directMessageForm
    );
});

// File Input Listeners for Preview
document.getElementById('direct-chat-file-input').addEventListener('change', (e) => {
    const file = e.target.files[0];
    const preview = document.getElementById('direct-chat-upload-preview');
    if (file) {
        preview.style.display = 'block';
        preview.innerHTML = `<i class="fas fa-paperclip"></i> ${file.name} (Listo para enviar)`;
    } else {
        preview.style.display = 'none';
    }
});

// ----------------------
// TASKS & SUBMISSIONS (Updated Logic)
// ----------------------

const taskDetailsView = document.getElementById('task-details-view');
let currentTaskId = null;

function loadTasks(channelId) {
    const q = query(collection(db, "tasks"), where("channelId", "==", channelId), orderBy("createdAt", "desc"));

    unsubscribeFrom('tasks');
    activeListeners['tasks'] = onSnapshot(q, (snapshot) => {
        tasksContainer.innerHTML = '';
        if (snapshot.empty) {
            tasksContainer.innerHTML = '<div class="empty-state"><i class="fas fa-clipboard-check" style="font-size:2rem; opacity:0.3; margin-bottom:10px;"></i><br>No hay asignaciones todavía.</div>';
        }
        snapshot.forEach((doc) => {
            renderTaskSummary(doc.id, doc.data());
        });
    });
}

function renderTaskSummary(id, data) {
    const div = document.createElement('div');
    div.className = 'task-card';
    div.onclick = () => openTaskDetails(id, data); /* Open Large View */

    div.innerHTML = `
        <div class="task-header">
            <h4 style="font-size:1.1rem; font-weight:700;">${escapeHtml(data.title)}</h4>
            <span style="font-size:0.8rem; color:var(--text-dim);">${new Date(data.createdAt.toDate()).toLocaleDateString()}</span>
        </div>
        <p style="color:var(--text-main); margin-bottom:10px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHtml(data.description)}</p>
        <button style="width:auto; padding:6px 12px; font-size:0.8rem; pointer-events:none; background:var(--bg-app); color:var(--text-dim); border:1px solid var(--border-color);">Ver Detalles</button>
    `;
    tasksContainer.appendChild(div);
}

// Open Large Task View
window.openTaskDetails = async (id, data) => {
    currentTaskId = id;

    // Hide others
    tasksView.style.display = 'none';
    taskDetailsView.style.display = 'flex';

    // Fill Info
    document.getElementById('detail-task-title').textContent = data.title;
    document.getElementById('detail-task-date').textContent = new Date(data.createdAt.toDate()).toLocaleString();
    document.getElementById('detail-task-desc').textContent = data.description;

    // Render Attachments
    const attachmentsDiv = document.getElementById('detail-task-attachments');
    attachmentsDiv.innerHTML = '';

    if (data.fileUrl) {
        attachmentsDiv.innerHTML = `<h4 style="margin-bottom:10px;">Adjunto del Profesor</h4>
             <a href="${data.fileUrl}" target="_blank" class="file-attachment" style="display:inline-flex; align-items:center; gap:10px; background:white; padding:15px; border-radius:8px; text-decoration:none; color:inherit; border:1px solid var(--border-color); box-shadow:var(--shadow-soft);">
                <div style="width:40px; height:40px; background:var(--bg-app); border-radius:8px; display:flex; align-items:center; justify-content:center; color:var(--primary); font-size:1.4rem;">
                    <i class="fas fa-file-download"></i>
                </div>
                <div>
                    <div style="font-weight:600;">${data.fileName || 'Archivo Adjunto'}</div>
                    <div style="font-size:0.8rem; color:var(--text-dim);">Descargar Recurso</div>
                </div>
            </a>`;
    }

    // Role Specific
    if (currentRole === 'student') {
        document.getElementById('detail-submission-area').style.display = 'block';
        document.getElementById('detail-prof-view').style.display = 'none';
        checkMySubmission(id);
    } else {
        document.getElementById('detail-submission-area').style.display = 'none';
        document.getElementById('detail-prof-view').style.display = 'block';
        loadAllSubmissions(id);
    }
};

window.closeTaskDetails = () => {
    taskDetailsView.style.display = 'none';
    tasksView.style.display = 'flex';
    currentTaskId = null;
};

// Student Submission Logic in Detail View
const submissionForm = document.getElementById('submission-form');
const submissionDropZone = document.getElementById('submission-drop-zone');
const submissionFileInput = document.getElementById('submission-file');
const submissionFilePreview = document.getElementById('submission-file-preview');

submissionDropZone.onclick = () => submissionFileInput.click();
submissionFileInput.onchange = () => {
    if (submissionFileInput.files[0]) {
        document.getElementById('submission-filename').textContent = submissionFileInput.files[0].name;
        submissionDropZone.style.display = 'none';
        submissionFilePreview.style.display = 'flex';
    }
};

window.clearSubmissionFile = () => {
    submissionFileInput.value = '';
    submissionFilePreview.style.display = 'none';
    submissionDropZone.style.display = 'block';
};

submissionForm.onsubmit = async (e) => {
    e.preventDefault();
    const currentFileInput = document.getElementById('submission-file');
    const driveUrlInput = document.getElementById('submission-drive-url');

    const file = currentFileInput ? currentFileInput.files[0] : null;
    const driveUrl = driveUrlInput ? driveUrlInput.value : null;

    if (!file && !driveUrl) return alert("Por favor selecciona un archivo o elige de tu Drive.");

    // Visual feedback
    const btn = submissionForm.querySelector('button[type="submit"]');
    const originalText = btn.textContent;
    btn.textContent = "Entregando...";
    btn.disabled = true;

    try {
        let submissionData = {
            taskId: currentTaskId,
            studentId: currentUser.uid,
            studentEmail: currentUser.email,
            createdAt: new Date()
        };

        if (file) {
            btn.textContent = "Subiendo archivo...";
            const uploaded = await uploadToYeet(file);
            submissionData.link = uploaded.url;
            submissionData.fileName = uploaded.filename;
            submissionData.type = 'file';
        } else if (driveUrl) {
            submissionData.link = driveUrl;
            submissionData.fileName = document.getElementById('submission-filename').textContent;
            submissionData.type = 'drive';
        }

        await addDoc(collection(db, "submissions"), {
            ...submissionData
        });

        alert("¡Entregado exitosamente!");
        checkMySubmission(currentTaskId); // Refresh view
    } catch (err) {
        console.error("Error submitting", err);
        alert("Error al entregar: " + err.message);
    } finally {
        if (btn) {
            btn.textContent = originalText;
            btn.disabled = false;
        }
    }
};

window.deleteSubmission = async (subId) => {
    if (confirm("¿Seguro que quieres anular la entrega? Podrás volver a entregar después.")) {
        await deleteDoc(doc(db, "submissions", subId));
        checkMySubmission(currentTaskId);
    }
};

window.clearSubmissionFile = () => {
    const fileInput = document.getElementById('submission-file');
    const driveUrl = document.getElementById('submission-drive-url');
    const preview = document.getElementById('submission-file-preview');
    const dropZone = document.getElementById('submission-drop-zone');

    if (fileInput) fileInput.value = '';
    if (driveUrl) driveUrl.value = '';
    if (preview) preview.style.display = 'none';
    if (dropZone) dropZone.style.display = 'block';
};

async function checkMySubmission(taskId) {
    const q = query(collection(db, "submissions"), where("taskId", "==", taskId), where("studentId", "==", currentUser.uid));
    const snap = await getDocs(q);
    if (!snap.empty) {
        const sub = snap.docs[0].data();
        submissionForm.innerHTML = `
            <div style="text-align:center; padding:30px;">
                <i class="fas fa-check-circle" style="font-size:3rem; color:green; margin-bottom:15px;"></i>
                <h3>Entregado</h3>
                <p>El ${new Date(sub.createdAt.toDate()).toLocaleDateString()}</p>
                <p>Archivo: <a href="${sub.link}" target="_blank">${sub.fileName || 'Ver'}</a></p>
                <button type="button" onclick="deleteSubmission('${snap.docs[0].id}')" style="background:#fee2e2; color:#ef4444; width:auto; border:none; margin-top:10px;">Anular entrega</button>
            </div>
        `;
    } else {
        // Reset form
        submissionForm.innerHTML = `
             <div class="file-upload-box" id="submission-drop-zone" onclick="document.getElementById('submission-file').click()" style="border: 2px dashed var(--border-color); padding: 30px; text-align: center; border-radius: 12px; background: white; cursor: pointer; transition: all 0.2s;">
                <i class="fas fa-cloud-upload-alt" style="font-size: 2rem; color: var(--text-dim); margin-bottom: 10px;"></i>
                <p style="color: var(--text-dim); margin-bottom: 5px;">Click para subir o arrastrar</p>
                <input type="file" id="submission-file" style="display:none;" onchange="handleSubFileSelect(this)">
            </div>
            <div style="text-align:center; margin: 15px 0;">
                <span style="background: var(--bg-app); padding: 0 10px; color: var(--text-dim); position: relative; z-index: 1;">o</span>
                <div style="height:1px; background: var(--border-color); margin-top: -10px;"></div>
            </div>
            <button type="button" onclick="openDriveSelector()" style="width: 100%; border: 1px solid var(--primary); background: transparent; color: var(--primary); display: flex; align-items: center; justify-content: center; gap: 8px;">
                <i class="fas fa-folder"></i> Elegir de mi Drive
            </button>

            <div id="submission-file-preview" style="margin-top: 15px; display: none; align-items: center; gap: 10px; background: white; padding: 10px; border-radius: 8px; border: 1px solid var(--border-color);">
                <i class="fas fa-file-alt" style="color: var(--primary);"></i>
                <span id="submission-filename">file.txt</span>
                <input type="hidden" id="submission-drive-url">
                <button type="button" onclick="clearSubmissionFile()" style="margin-left: auto; width: auto; padding: 5px; color: #ef4444; background: transparent;"><i class="fas fa-times"></i></button>
            </div>
            <button type="submit" style="width: 100%; margin-top: 20px;">Entregar tarea</button>
         `;
    }
}

// Global handler for the dynamically re-inserted input
// ----------------------
// SEARCH BAR LOGIC
// ----------------------

const searchInput = document.getElementById('global-search-input');
const searchDropdown = document.getElementById('search-results-dropdown');
const clearSearchBtn = document.getElementById('clear-search-btn');
let searchTimeout = null;

searchInput.addEventListener('input', (e) => {
    // Pass raw term to preserve case for Name matching, but Trim it.
    const term = e.target.value.trim();

    if (term.length > 0) {
        clearSearchBtn.style.display = 'block';
        if (searchTimeout) clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => performSearch(term), 300);
    } else {
        clearSearchBtn.style.display = 'none';
        searchDropdown.style.display = 'none';
    }
});

clearSearchBtn.addEventListener('click', () => {
    searchInput.value = '';
    searchDropdown.style.display = 'none';
    clearSearchBtn.style.display = 'none';
    searchInput.focus();
});

// Close dropdown when clicking outside
document.addEventListener('click', (e) => {
    if (!e.target.closest('#global-search-input') && !e.target.closest('#search-results-dropdown')) {
        searchDropdown.style.display = 'none';
    }
});

async function performSearch(rawTerm) {
    searchDropdown.innerHTML = '<div class="loader" style="font-size:0.8rem; padding:10px;">Buscando...</div>';
    searchDropdown.style.display = 'block';

    const results = [];
    const termLower = rawTerm.toLowerCase();
    const termUpper = rawTerm.toUpperCase();

    try {
        const registeredEmails = new Set();
        const whitelistMap = new Map(); // email -> photoURL

        // 1. Fetch Whitelist - Two Queries: Email, Name

        // A) Email (Lower)
        const qWhitelistEmail = query(collection(db, "studentwhitelist"),
            where("email", ">=", termLower),
            where("email", "<=", termLower + '\uf8ff')
        );

        // B) Name (Upper - assuming whitelist names are UPPERCASE as per script)
        const qWhitelistName = query(collection(db, "studentwhitelist"),
            where("name", ">=", termUpper),
            where("name", "<=", termUpper + '\uf8ff')
        );

        const [snapW1, snapW2] = await Promise.all([
            getDocs(qWhitelistEmail),
            getDocs(qWhitelistName)
        ]);

        // Merge Whitelist Results
        const mergeWhitelist = (doc) => {
            const data = doc.data();
            if (data.email) {
                whitelistMap.set(data.email.toLowerCase(), data);
            }
        };
        snapW1.forEach(mergeWhitelist);
        snapW2.forEach(mergeWhitelist);


        // 2. Fetch Registered Users - Two Queries: Email, DisplayName

        // A) Email (Lower)
        const qUsersEmail = query(collection(db, "users"),
            where("email", ">=", termLower),
            where("email", "<=", termLower + '\uf8ff')
        );

        // B) DisplayName (Try Uppercase first as it is dominant for students)
        // Note: If user typed "Ale", termUpper is "ALE". Matches "ALEJANDRO".
        const qUsersName = query(collection(db, "users"),
            where("displayName", ">=", termUpper),
            where("displayName", "<=", termUpper + '\uf8ff')
        );

        // We could also try rawTerm if it's different?
        // Let's stick to Upper for now as it solves the reported issue "Si pongo Ale...".

        const [snapU1, snapU2] = await Promise.all([
            getDocs(qUsersEmail),
            getDocs(qUsersName)
        ]);

        const processUserDoc = (doc) => {
            // Allow searching for yourself
            const data = doc.data();
            const emailLower = data.email.toLowerCase();

            // Avoid duplicates if matched by both email and name
            if (registeredEmails.has(emailLower)) return;
            registeredEmails.add(emailLower);

            // Smart Photo Logic
            let photoToUse = data.photoURL;
            if (!photoToUse && whitelistMap.has(emailLower)) {
                photoToUse = whitelistMap.get(emailLower).photoURL;
            }

            let title = data.displayName || data.email;
            if (doc.id === currentUser.uid) {
                title += " (Tú)";
            }

            results.push({
                type: 'user',
                id: doc.id,
                title: title,
                subtitle: data.email,
                photoURL: photoToUse,
                data: data
            });
        };

        snapU1.forEach(processUserDoc);
        snapU2.forEach(processUserDoc);


        // 3. Add Whitelist users who are NOT registered
        whitelistMap.forEach((data, emailLower) => {
            if (emailLower !== currentUser.email.toLowerCase() && !registeredEmails.has(emailLower)) {
                results.push({
                    type: 'user',
                    id: data.email,
                    title: data.name || data.email,
                    subtitle: data.email + ' (No registrado)',
                    photoURL: data.photoURL,
                    data: { ...data, isUnregistered: true }
                });
            }
        });

        // 4. Also simple class search (My Classes) - Local Filter (Small list usually)
        // We fetch ALL my classes and filter locally. Safer/Correct for case-insensitive.
        const myClassesQ = currentRole === 'professor'
            ? query(collection(db, "classes"), where("professorId", "==", currentUser.uid))
            : query(collection(db, "classes"), where("studentEmails", "array-contains", currentUser.email));

        const classSnaps = await getDocs(myClassesQ);
        classSnaps.forEach(doc => {
            const data = doc.data();
            if (data.name.toLowerCase().includes(termLower)) {
                results.push({
                    type: 'class',
                    id: doc.id,
                    title: data.name,
                    subtitle: 'Clase',
                    data: data
                });
            }
        });

    } catch (err) {
        console.error("Search error", err);
    }

    renderSearchResults(results);
}

function renderSearchResults(results) {
    searchDropdown.innerHTML = '';

    if (results.length === 0) {
        searchDropdown.innerHTML = '<div style="padding:15px; text-align:center; color:var(--text-dim);">No se encontraron resultados</div>';
        return;
    }

    results.forEach(item => {
        const div = document.createElement('div');
        div.className = 'search-result-item'; // Add css later or inline
        div.style.cssText = 'padding:10px 15px; border-bottom:1px solid var(--border-color); cursor:pointer; display:flex; align-items:center; gap:10px; transition:background 0.2s;';
        div.onmouseover = () => div.style.background = 'var(--bg-app)';
        div.onmouseout = () => div.style.background = 'white';

        let icon = '';

        if (item.type === 'user') {
            if (item.photoURL) {
                icon = `<div class="avatar" style="width:32px; height:32px;"><img src="${item.photoURL}" style="width:100%; height:100%; border-radius:50%; object-fit:cover;"></div>`;
            } else {
                icon = `<div class="avatar" style="width:32px; height:32px; font-size:0.9rem;">${item.title[0].toUpperCase()}</div>`;
            }
        } else {
            icon = `<div style="width:32px; height:32px; background:#e0e7ff; border-radius:8px; display:flex; align-items:center; justify-content:center; color:var(--primary);"><i class="fas fa-chalkboard"></i></div>`;
        }

        div.innerHTML = `
            ${icon}
            <div>
                <div style="font-weight:600; font-size:0.9rem;">${escapeHtml(item.title)}</div>
                <div style="font-size:0.8rem; color:var(--text-dim);">${escapeHtml(item.subtitle)}</div>
            </div>
        `;

        div.addEventListener('click', () => {
            if (item.type === 'user') {
                // Check if chat exists or create new
                startChatWithUser(item.data.email, item.id, item.title);
            } else {
                enterClass(item.id, item.data);
            }
            searchDropdown.style.display = 'none';
            searchInput.value = '';
        });

        searchDropdown.appendChild(div);
    });
}

async function startChatWithUser(email, uid, displayName) {
    // Reuse new chat logic
    // Check if chat exists
    try {
        const q = query(collection(db, "direct_chats"),
            where("participantEmails", "array-contains", currentUser.email)
        );
        const snaps = await getDocs(q);
        let existingId = null;

        snaps.forEach(d => {
            if (d.data().participantEmails.includes(email)) existingId = d.id;
        });

        if (existingId) {
            switchMainView('chats');
            selectDirectChat(existingId, displayName);
        } else {
            // Create New
            const newDoc = await addDoc(collection(db, "direct_chats"), {
                participantEmails: [currentUser.email, email],
                participants: [currentUser.uid, uid],
                createdAt: new Date(),
                lastUpdated: new Date()
            });
            switchMainView('chats');
            // Allow time for listener to pick up
            setTimeout(() => selectDirectChat(newDoc.id, displayName), 500);
        }
    } catch (e) {
        console.error(e);
        alert("Error iniciando chat: " + e.message);
    }
}


// Prof Submissions List
async function loadAllSubmissions(taskId) {
    const container = document.getElementById('detail-submissions-list');
    container.innerHTML = '<div class="loader">Loading...</div>';

    const q = query(collection(db, "submissions"), where("taskId", "==", taskId), orderBy("createdAt", "desc"));
    const snap = await getDocs(q);

    document.getElementById('submission-count').textContent = `${snap.size} entregadas`;
    container.innerHTML = '';

    if (snap.empty) {
        container.innerHTML = '<p style="grid-column:1/-1; text-align:center; color:var(--text-dim);">No hay entregas todavía.</p>';
        return;
    }

    snap.forEach(doc => {
        const d = doc.data();
        const div = document.createElement('div');
        div.className = "submission-item";
        div.style.cssText = "display:flex; justify-content:space-between; align-items:center; padding:15px; border-bottom:1px solid var(--border-color);";

        div.innerHTML = `
             <div style="display:flex; flex-direction:column; gap:4px;">
                <div style="font-weight:600; color:var(--text-main);">${d.studentEmail}</div>
                <div style="font-size:0.8rem; color:var(--text-dim);">${new Date(d.createdAt.toDate()).toLocaleString()}</div>
             </div>
             <a href="${d.link}" target="_blank" class="submission-link-card">
                 <div style="width:32px; height:32px; background:var(--bg-app); border-radius:6px; display:flex; align-items:center; justify-content:center; color:var(--primary);">
                    <i class="fas fa-file-invoice"></i>
                 </div>
                 <div style="display:flex; flex-direction:column;">
                    <span style="font-weight:600; font-size:0.9rem;">${d.fileName || 'Archivo'}</span>
                    <span style="font-size:0.75rem; color:var(--text-dim);">Clic para ver</span>
                 </div>
             </a>
         `;
        container.appendChild(div);
    });
}

// Create Task with Attachment
const createTaskModal = document.getElementById('create-task-modal');
const createTaskForm = document.getElementById('create-task-form');
document.getElementById('create-task-btn').addEventListener('click', () => createTaskModal.classList.add('active'));

createTaskForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const title = document.getElementById('task-title').value;
    const desc = document.getElementById('task-desc').value;
    const file = document.getElementById('task-attachment').files[0];

    // Feedback
    const btn = createTaskForm.querySelector('button');
    const origText = btn.textContent;
    btn.textContent = "Creando...";
    btn.disabled = true;

    try {
        let fileData = {};
        if (file) {
            btn.textContent = "Subiendo Adjunto...";
            const uploaded = await uploadToYeet(file);
            fileData = {
                fileUrl: uploaded.url,
                fileName: uploaded.filename
            };
        }

        await addDoc(collection(db, "tasks"), {
            channelId: currentChannelId,
            title: title,
            description: desc,
            createdAt: new Date(),
            ...fileData
        });

        createTaskModal.classList.remove('active');
        createTaskForm.reset();
    } catch (err) {
        alert("Error: " + err.message);
    } finally {
        btn.textContent = origText;
        btn.disabled = false;
    }
});


// Modal Closers
document.querySelectorAll('.close-modal').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.modal').forEach(m => m.classList.remove('active'));
    });
});

logoutBtn.addEventListener('click', () => {
    signOut(auth);
});

// ----------------------
// SETTINGS LOGIC
// ----------------------

window.openSettings = async () => {
    currentChannelId = null;
    currentChannelType = 'settings';

    // Unsubscribe from previous
    unsubscribeFrom('messages');
    unsubscribeFrom('tasks');
    unsubscribeFrom('files');

    document.querySelectorAll('.channel-item').forEach(el => el.classList.remove('active'));
    // Find the settings item to make it active (last child)
    const items = channelsContainer.querySelectorAll('.channel-item');
    if (items.length > 0) items[items.length - 1].classList.add('active');

    document.getElementById('current-channel-name').textContent = "Configuración";

    messagesView.style.display = 'none';
    tasksView.style.display = 'none';
    const filesView = document.getElementById('files-view');
    if (filesView) filesView.style.display = 'none';
    settingsView.style.display = 'flex';

    // Load Settings Data
    const classDoc = await getDoc(doc(db, "classes", currentClassId));
    if (!classDoc.exists()) return;
    const classData = classDoc.data();

    document.getElementById('settings-class-name').textContent = classData.name;
    document.getElementById('settings-class-code').textContent = classData.code || 'N/A';

    // Load Class Settings
    document.getElementById('settings-emojis-enabled').checked = classData.settings?.emojisEnabled !== false;

    // Save Settings Handler (Auto-save)
    document.getElementById('settings-emojis-enabled').onclick = async (e) => {
        await updateDoc(doc(db, "classes", currentClassId), {
            "settings.emojisEnabled": e.target.checked
        });
    };

    // Members List with Admin Promotio Logic
    const membersList = document.getElementById('settings-members-list');
    membersList.innerHTML = '<div class="loader" style="padding:20px;"></div>';

    const students = classData.studentEmails || [];
    const admins = classData.admins || [];
    const isProf = classData.professorId === currentUser.uid;
    const amIAdmin = admins.includes(currentUser.email) || isProf;

    if (students.length === 0) {
        membersList.innerHTML = '<div style="padding:20px; text-align:center; color:var(--text-dim);">No hay estudiantes todavía.</div>';
    } else {
        let html = '';
        students.forEach(email => {
            const isStudentAdmin = admins.includes(email);
            let actionBtn = '';

            if (isProf) {
                if (isStudentAdmin) {
                    actionBtn = `<button onclick="toggleAdmin('${email}', false)" style="width:auto; padding:4px 10px; font-size:0.75rem; background:#fee2e2; color:#ef4444; margin:0;">Quitar Admin</button>`;
                } else {
                    actionBtn = `<button onclick="toggleAdmin('${email}', true)" style="width:auto; padding:4px 10px; font-size:0.75rem; background:#e0e7ff; color:var(--primary); margin:0;">Hacer Admin</button>`;
                }
            }

            html += `
                <div style="padding: 12px 20px; border-bottom: 1px solid var(--border-color); display: flex; align-items: center; justify-content: space-between;">
                    <div style="display:flex; align-items:center; gap:12px;">
                        <div class="avatar" style="width: 32px; height: 32px; font-size: 0.9rem;">${email[0].toUpperCase()}</div>
                        <div>
                            <div style="font-weight:500;">${email}</div>
                             ${isStudentAdmin ? '<span style="font-size:0.75rem; background:#dcfce7; color:#166534; padding:2px 6px; border-radius:4px;">Admin</span>' : '<span style="font-size:0.75rem; color:var(--text-dim);">Estudiante</span>'}
                        </div>
                    </div>
                    ${actionBtn}
                </div>
            `;
        });
        membersList.innerHTML = html;
    }

    // Role Visibility for Settings
    // Show "Class Settings Controls" only to Admins/Profs
    const controls = document.getElementById('class-settings-controls');
    if (controls) controls.style.display = amIAdmin ? 'block' : 'none';

    // Danger Zone - Leave for Students, Delete for Prof
    const profOnly = settingsView.querySelectorAll('.prof-only');
    const studentOnly = settingsView.querySelectorAll('.student-only');

    if (currentRole === 'professor') {
        profOnly.forEach(el => el.style.display = 'block');
        studentOnly.forEach(el => el.style.display = 'none');
    } else {
        // If student, check if admin for some settings?
        // Actually, deleting class is STRICTLY Professor. 
        // "Class Settings" (emojis) is for Admins too.

        profOnly.forEach(el => {
            // Exception: class settings controls are handled above separately
            if (el.id !== 'class-settings-controls') el.style.display = 'none';
        });
        studentOnly.forEach(el => el.style.display = 'block');
    }
};

window.toggleAdmin = async (email, makeAdmin) => {
    if (!confirm(makeAdmin ? `¿Hacer a ${email} administrador?` : `¿Quitar permisos de admin a ${email}?`)) return;

    try {
        if (makeAdmin) {
            await updateDoc(doc(db, "classes", currentClassId), {
                admins: arrayUnion(email)
            });
        } else {
            await updateDoc(doc(db, "classes", currentClassId), {
                admins: arrayRemove(email)
            });
        }
        openSettings(); // Reload
    } catch (e) {
        alert("Error: " + e.message);
    }
};

window.deleteThisClass = async () => {
    if (confirm("¿Estás seguro de que quieres ELIMINAR esta clase? Esto no se puede deshacer.")) {
        // ideally delete sub-collections too but for now just the class doc to hide it
        await deleteDoc(doc(db, "classes", currentClassId));
        alert("Clase eliminada.");
        document.getElementById('back-to-dash').click();
    }
};

window.leaveThisClass = async () => {
    if (confirm("¿Salir de esta clase?")) {
        await updateDoc(doc(db, "classes", currentClassId), {
            studentEmails: arrayRemove(currentUser.email),
            admins: arrayRemove(currentUser.email) // Also remove from admins if they leave
        });
        alert("Saliste de la clase.");
        document.getElementById('back-to-dash').click();
    }
};

window.addStudentByEmail = async () => {
    const email = document.getElementById('add-student-email').value.trim();
    if (!email) return;

    // Add to studentEmails array
    // Note: This doesn't validate if user exists in 'users' collection, but that's fine for now. 
    // They will see the class when they log in with that email.

    try {
        await updateDoc(doc(db, "classes", currentClassId), {
            studentEmails: arrayUnion(email)
        });
        alert(`${email} añadido a la clase.`);
        document.getElementById('add-student-email').value = '';
        openSettings(); // Refresh list
    } catch (e) {
        alert("Error: " + e.message);
    }
};

// ----------------------
// DIRECT CHATS LOGIC
// ----------------------
let currentDirectChatId = null;

async function loadDirectChats() {
    const chatList = document.getElementById('direct-chat-list');
    chatList.innerHTML = '<div class="loader" style="padding:20px;"></div>';

    const q = query(collection(db, "direct_chats"), where("participantEmails", "array-contains", currentUser.email));

    if (currentMainView === 'chats') {
        unsubscribeFrom('direct_chats');
        unsubscribeFrom('direct_chats');
        activeListeners['direct_chats'] = onSnapshot(q, (snapshot) => {
            chatList.innerHTML = '';
            if (snapshot.empty) {
                chatList.innerHTML = '<div style="padding:20px; text-align:center; color:var(--text-dim);">No tienes chats recientes.</div>';
                return;
            }

            let chats = [];
            snapshot.forEach(doc => {
                chats.push({ id: doc.id, ...doc.data() });
            });

            // Filter Hidden
            chats = chats.filter(c => !c.hiddenBy || !c.hiddenBy.includes(currentUser.uid));

            // Sort: Pinned first, then Last Updated (Desc)
            chats.sort((a, b) => {
                const aPinned = pinnedChats.includes(a.id);
                const bPinned = pinnedChats.includes(b.id);
                if (aPinned && !bPinned) return -1;
                if (!aPinned && bPinned) return 1;
                // fallback to creation or lastUpdated
                const timeA = a.lastUpdated?.seconds || a.createdAt?.seconds || 0;
                const timeB = b.lastUpdated?.seconds || b.createdAt?.seconds || 0;
                return timeB - timeA;
            });

            chats.forEach(c => renderChatListItem(c.id, c));
        });
    }
}

async function renderChatListItem(id, data) {
    const list = document.getElementById('direct-chat-list');
    // If item already exists, remove it to re-order/update? 
    // Actually snapshot listeners handle additions/modifications.
    // Ideally we find existing element.
    let div = list.querySelector(`.chat-list-item[data-id="${id}"]`);
    if (!div) {
        div = document.createElement('div');
        div.className = `chat-list-item`;
        div.dataset.id = id;
        list.appendChild(div);
    }

    if (currentDirectChatId === id) div.classList.add('active');

    // Identify Other User
    // If 'participants' array exists (UIDs), use that. Else fall back to emails.
    let displayName = "Usuario";
    let avatarChar = "?";
    let photoURL = null;
    let targetUid = null;

    if (data.participants && data.participants.length > 0) {
        targetUid = data.participants.find(uid => uid !== currentUser.uid);
    }

    if (targetUid) {
        // Fetch Profile
        try {
            const profile = await getUserProfile(targetUid);
            if (profile) {
                displayName = profile.displayName || profile.email;
                if (profile.photoURL) photoURL = profile.photoURL;
            }
        } catch (e) {
            console.error("Error fetching chat profile", e);
        }
    } else {
        // Fallback to email
        const otherEmail = data.participantEmails.find(e => e !== currentUser.email);
        displayName = otherEmail || "Usuario Desconocido";
    }

    // Determine visual style
    // Check if blocked
    const isBlocked = targetUid && myBlockedUsers.includes(targetUid);
    if (isBlocked) {
        displayName += " (Bloqueado)";
        div.style.opacity = "0.5";
    } else {
        div.style.opacity = "1";
    }

    avatarChar = displayName[0].toUpperCase();

    let avatarHtml = `<div class="avatar" style="width:36px; height:36px; font-size:1rem;">${avatarChar}</div>`;
    if (photoURL) {
        avatarHtml = `<div class="avatar" style="width:36px; height:36px; font-size:1rem;"><img src="${photoURL}"></div>`;
    }

    div.innerHTML = `
        ${avatarHtml}
        <div style="flex:1; overflow:hidden;">
            <div style="font-weight:500; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; display:flex; justify-content:space-between; align-items:center;">
                ${escapeHtml(displayName)}
                ${pinnedChats.includes(id) ? '<i class="fas fa-thumbtack" style="font-size:0.7rem; color:var(--text-dim); margin-left:5px;"></i>' : ''}
            </div>
        </div>
        <div class="chat-options-btn" onclick="showChatContextMenu(event, '${id}', '${targetUid}')" style="padding:4px 8px; color:var(--text-dim); border-radius:4px; transition:background 0.2s;">
            <i class="fas fa-ellipsis-v"></i>
        </div>
    `;

    // Re-attach listener (clicking main div opens chat)
    div.onclick = (e) => {
        // Don't trigger if clicked on the options button
        if (e.target.closest('.chat-options-btn')) return;
        selectDirectChat(id, displayName.replace(" (Bloqueado)", ""));
    };
}

let activeChatContextId = null;
let activeChatTargetUid = null;

window.showChatContextMenu = (e, chatId, targetUid) => {
    e.stopPropagation();
    e.preventDefault();

    if (targetUid === 'null' || targetUid === 'undefined') targetUid = null;

    activeChatContextId = chatId;
    activeChatTargetUid = targetUid;

    const menu = document.getElementById('chat-context-menu');

    // Update labels based on state
    // Block/Unblock label
    const isBlocked = myBlockedUsers.includes(targetUid);
    const blockItem = document.getElementById('ctx-chat-block');
    blockItem.querySelector('span').textContent = isBlocked ? 'Desbloquear' : 'Bloquear';

    // Pin/Unpin label
    const isPinned = pinnedChats.includes(chatId);
    const pinItem = document.getElementById('ctx-chat-pin');
    pinItem.querySelector('span').textContent = isPinned ? 'Desfijar' : 'Fijar';
    pinItem.querySelector('i').className = isPinned ? 'fas fa-thumbtack-slash' : 'fas fa-thumbtack';

    // Position menu
    menu.style.display = 'block';

    // Simple positioning logic
    const rect = e.target.getBoundingClientRect();
    menu.style.top = `${rect.bottom + 5}px`;
    menu.style.left = `${rect.left - 100}px`; // Shift left to keep in view

    // Close on click outside
    const closeHandler = () => {
        menu.style.display = 'none';
        document.removeEventListener('click', closeHandler);
    };
    // Delay slightly so this click doesn't close it immediately
    setTimeout(() => document.addEventListener('click', closeHandler), 0);
};

window.contextChatAction = async (action) => {
    const chatId = activeChatContextId;
    const targetUid = activeChatTargetUid;

    if (!chatId) return;

    if (action === 'delete') {
        // "Borrar" = Hide
        if (confirm("¿Borrar este chat de tu lista? Volverá a aparecer si hay nuevos mensajes.")) {
            try {
                await updateDoc(doc(db, "direct_chats", chatId), {
                    hiddenBy: arrayUnion(currentUser.uid)
                });
                // View will refresh and remove it
                if (currentDirectChatId === chatId) {
                    document.getElementById('direct-chat-content-area').style.display = 'none';
                    document.getElementById('direct-chat-placeholder').style.display = 'flex';
                    currentDirectChatId = null;
                }
            } catch (e) {
                alert("Error: " + e.message);
            }
        }
    } else if (action === 'block') {
        if (targetUid) {
            await toggleBlockUser(targetUid);
            // Label update is handled by reopen or logic, but toggleBlockUser might reload page or reselect logic.
            // toggleBlockUser implementation alerts and modifies 'myBlockedUsers'.
        } else {
            alert("No se puede bloquear a este usuario (ID desconocido).");
        }
    } else if (action === 'pin') {
        try {
            const userRef = doc(db, "users", currentUser.uid);
            if (pinnedChats.includes(chatId)) {
                await updateDoc(userRef, { pinnedChats: arrayRemove(chatId) });
                pinnedChats = pinnedChats.filter(id => id !== chatId);
            } else {
                await updateDoc(userRef, { pinnedChats: arrayUnion(chatId) });
                pinnedChats.push(chatId);
            }
            // Refresh list
            loadDirectChats();
        } catch (e) {
            console.error(e);
        }
    }
};

async function selectDirectChat(chatId, displayName) {
    currentDirectChatId = chatId;
    document.getElementById('direct-chat-placeholder').style.display = 'none';
    const contentArea = document.getElementById('direct-chat-content-area');
    contentArea.style.display = 'flex';

    document.getElementById('direct-chat-header-name').textContent = displayName;
    document.getElementById('direct-chat-header-avatar').textContent = displayName[0].toUpperCase();

    // Find Target UID
    // We need to fetch the chat doc to get participants or store it in the DOM element
    // Let's fetch it, it's safer.
    const chatDoc = await getDoc(doc(db, "direct_chats", chatId));
    let targetUid = null;
    if (chatDoc.exists()) {
        const data = chatDoc.data();
        if (data.participants) {
            targetUid = data.participants.find(uid => uid !== currentUser.uid);
        }
    }

    // Check if blocked
    const isBlocked = targetUid && myBlockedUsers.includes(targetUid);

    // Add Block Button to Header - REMOVED (Replaced by Context Menu)
    const headerName = document.getElementById('direct-chat-header-name');
    const existingBtn = headerName.querySelector('.block-btn-wrapper');
    if (existingBtn) existingBtn.remove();


    // Disable input if blocked
    const input = document.getElementById('direct-message-input');
    const submitBtn = document.querySelector('#direct-message-form button');

    if (isBlocked) {
        input.disabled = true;
        input.placeholder = "Has bloqueado a este usuario.";
        submitBtn.disabled = true;
    } else {
        input.disabled = false;
        input.placeholder = "Escribe un mensaje...";
        submitBtn.disabled = false;
    }

    // Highlight active in list
    document.querySelectorAll('.chat-list-item').forEach(el => el.classList.remove('active'));

    loadMessages(chatId, document.getElementById('direct-messages-container'));
}

// Start New Chat
document.getElementById('new-chat-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('new-chat-email').value.trim();
    if (!email) return;

    if (email === currentUser.email) {
        alert("No puedes chatear contigo mismo.");
        return;
    }

    try {
        const q = query(collection(db, "direct_chats"),
            where("participantEmails", "array-contains", currentUser.email)
        );
        const snaps = await getDocs(q);
        let existingId = null;

        snaps.forEach(d => {
            if (d.data().participantEmails.includes(email)) existingId = d.id;
        });

        if (existingId) {
            selectDirectChat(existingId, email);
            document.getElementById('new-chat-modal').classList.remove('active');
            return;
        }

        // Create new
        const newDoc = await addDoc(collection(db, "direct_chats"), {
            participantEmails: [currentUser.email, email],
            participants: [currentUser.uid], // We don't have other UID easily without querying users collection. 
            // Just use emails for now as ID.
            createdAt: new Date(),
            lastUpdated: new Date()
        });

        document.getElementById('new-chat-modal').classList.remove('active');
        document.getElementById('new-chat-email').value = '';
        selectDirectChat(newDoc.id, email);

    } catch (err) {
        alert("Error: " + err.message);
    }
});

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

    unsubscribeFrom('files');
    activeListeners['files'] = onSnapshot(q, async (snapshot) => {
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
                renderFileItem(item, isAdmin || isProf);
            });
        }
    });
}

function renderFileItem(item, canManageProtected) {
    const filesGrid = document.getElementById('files-grid');
    const div = document.createElement('div');
    div.className = item.type === 'folder' ? 'folder-item' : 'file-item';

    const isProtected = item.isProtected || false;

    if (isProtected) {
        div.classList.add('protected');
    }

    // Drag and Drop support
    // Students cannot drag protected items
    if (!isProtected || canManageProtected) {
        div.draggable = true;
        div.addEventListener('dragstart', (e) => {
            e.dataTransfer.setData('text/plain', item.id);
            e.dataTransfer.effectAllowed = 'move';
            div.classList.add('dragging');
        });
        div.addEventListener('dragend', () => {
            div.classList.remove('dragging');
        });
    }

    if (item.type === 'folder') {
        // Drop logic - Students cannot drop into protected folders
        if (!isProtected || canManageProtected) {
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
                    await moveFileToFolder(draggedId, item.id);
                }
            });
        }

        div.innerHTML = `
            <i class="fas fa-folder folder-icon ${isProtected ? 'protected-icon' : ''}"></i>
            <div class="folder-name">${item.name} ${isProtected ? '<i class="fas fa-lock" style="font-size:0.7rem; opacity:0.5;"></i>' : ''}</div>
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
        // Students cannot see context menu for protected items
        if (isProtected && !canManageProtected) {
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

// Drive Selector for Assignments
let currentDriveSelectorFolderId = null;

window.openDriveSelector = (parentId = null) => {
    currentDriveSelectorFolderId = parentId;
    document.getElementById('drive-selector-modal').classList.add('active');
    loadDriveForSelector(parentId);
};

async function loadDriveForSelector(parentId) {
    const list = document.getElementById('drive-selector-list');
    const backBtn = document.getElementById('drive-selector-back');
    list.innerHTML = '<div class="loader">Cargando Drive...</div>';

    try {
        const q = query(
            collection(db, "user_files"),
            where("userId", "==", currentUser.uid),
            where("parentId", "==", parentId)
        );

        const snap = await getDocs(q);
        list.innerHTML = '';

        if (parentId) {
            backBtn.style.display = 'block';
            backBtn.onclick = async () => {
                const parentDoc = await getDoc(doc(db, "user_files", parentId));
                loadDriveForSelector(parentDoc.data().parentId || null);
            };
        } else {
            backBtn.style.display = 'none';
        }

        if (snap.empty) {
            list.innerHTML = '<p style="text-align:center; color:var(--text-dim); padding:20px;">Esta carpeta está vacía.</p>';
            return;
        }

        snap.forEach(doc => {
            const data = doc.data();
            const id = doc.id;
            const div = document.createElement('div');
            div.style.cssText = 'display:flex; align-items:center; gap:12px; padding:12px; border-bottom:1px solid var(--border-color); cursor:pointer; transition:background 0.2s;';
            div.onmouseover = () => div.style.background = 'var(--bg-app)';
            div.onmouseout = () => div.style.background = 'transparent';

            if (data.type === 'folder') {
                div.innerHTML = `<i class="fas fa-folder" style="color:#fdba74; font-size:1.2rem;"></i> <span style="font-weight:500;">${data.name}</span>`;
                div.onclick = () => loadDriveForSelector(id);
            } else {
                div.innerHTML = `<i class="fas fa-file-alt" style="color:var(--primary); font-size:1.2rem;"></i> <span>${data.name}</span>`;
                div.onclick = () => handleDriveFileSelect(id, data);
            }
            list.appendChild(div);
        });
    } catch (err) {
        console.error("Error loading drive selector", err);
        list.innerHTML = '<p style="color:red; text-align:center;">Error al cargar el Drive.</p>';
    }
}

function handleDriveFileSelect(id, data) {
    const filenameLabel = document.getElementById('submission-filename');
    const driveUrlInput = document.getElementById('submission-drive-url');
    const preview = document.getElementById('submission-file-preview');
    const dropZone = document.getElementById('submission-drop-zone');
    const fileInput = document.getElementById('submission-file');

    filenameLabel.textContent = data.name;
    // For documents created in-app, use the doc.html link, otherwise just use the fileUrl if it exists
    if (data.type === 'document') {
        driveUrlInput.value = `doc.html?document=${id}`;
    } else {
        driveUrlInput.value = data.fileUrl;
    }

    if (fileInput) fileInput.value = ''; // Clear local file if any

    preview.style.display = 'flex';
    dropZone.style.display = 'none';

    document.getElementById('drive-selector-modal').classList.remove('active');
}