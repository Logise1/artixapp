import { auth, db, storage, signOut, collection, addDoc, getDoc, getDocs, doc, query, where, onSnapshot, orderBy, updateDoc, setDoc, arrayUnion, arrayRemove, deleteDoc, ref, uploadBytes, getDownloadURL } from "./firebase-config.js";

let currentUser = null;
let currentRole = null;
let currentClassId = null;
let currentChannelId = null;
let currentChannelType = 'chat';

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
const messageForm = document.getElementById('message-form');
const tasksView = document.getElementById('tasks-view');
const messagesView = document.getElementById('messages-view');
const settingsView = document.getElementById('settings-view');
const tasksContainer = document.getElementById('tasks-container');

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
    if (currentRole === 'professor') {
        createClassBtn.style.display = 'block';
        joinClassBtn.style.display = 'none';
        document.querySelectorAll('.prof-only').forEach(el => el.style.display = 'block');
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

    onSnapshot(q, (snapshot) => {
        classesGrid.innerHTML = '';
        if (snapshot.empty) {
            classesGrid.innerHTML = `
                <div style="text-align:center; grid-column: 1/-1; padding: 40px; color: var(--text-dim);">
                    <i class="fas fa-school" style="font-size: 3rem; margin-bottom: 20px; opacity: 0.5;"></i>
                    <p style="font-size:1.1rem; margin-bottom:10px;">No se encontraron clases.</p>
                    ${currentRole === 'professor'
                    ? '<p>¡Crea tu primera clase para empezar!</p>'
                    : `<p>Haz clic en "Unirse con Código" para entrar a una clase.</p>
                           <p style="margin-top:20px; font-size:0.8rem;">
                             ¿Eres Profesor? <a href="#" onclick="switchRole('professor')" style="color:var(--primary)">Cambiar Rol</a>
                           </p>`
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
            <div class="class-title">${data.name}</div>
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
            studentEmails: []
        });

        await addDoc(collection(db, "channels"), {
            classId: classRef.id,
            name: "general",
            type: "chat",
            createdAt: new Date()
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
    const q = query(collection(db, "channels"), where("classId", "==", classId), orderBy("createdAt"));

    onSnapshot(q, (snapshot) => {
        channelsContainer.innerHTML = '';
        let firstChannel = null;
        snapshot.forEach((doc) => {
            if (!firstChannel) firstChannel = { id: doc.id, ...doc.data() };
            renderChannelItem(doc.id, doc.data());
        });

        // Add Separator and Settings Item
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
    div.className = `channel-item ${currentChannelId === id ? 'active' : ''}`;
    div.innerHTML = `
        <span class="channel-icon"><i class="fas ${data.type === 'tasks' ? 'fa-clipboard-list' : 'fa-hashtag'}"></i></span>
        <span>${data.name}</span>
    `;
    div.addEventListener('click', () => selectChannel(id, data));
    channelsContainer.appendChild(div);
}

function selectChannel(id, data) {
    currentChannelId = id;
    currentChannelType = data.type;
    document.getElementById('current-channel-name').textContent = data.name;

    document.querySelectorAll('.channel-item').forEach(el => el.classList.remove('active'));
    // Re-rendering happens on snapshot, this is visual feedback for instant click

    if (data.type === 'tasks') {
        messagesView.style.display = 'none';
        tasksView.style.display = 'flex';
        settingsView.style.display = 'none';
        loadTasks(id);
    } else {
        tasksView.style.display = 'none';
        settingsView.style.display = 'none';
        messagesView.style.display = 'flex';
        loadMessages(id);
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
        createdAt: new Date()
    });
    createChannelModal.classList.remove('active');
});

// ----------------------
// FILE UPLOAD HELPER (YeetYourFiles)
// ----------------------
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

function loadMessages(channelId) {
    const q = query(collection(db, "messages"), where("channelId", "==", channelId), orderBy("createdAt", "asc"));

    onSnapshot(q, (snapshot) => {
        messagesContainer.innerHTML = '';
        snapshot.forEach((doc) => {
            renderMessage(doc.data());
        });
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    });
}

// ... ensured above via large replacement ...
// Just verifying the previous replace covers renderMessage correctly.
// Since the previous ReplaceContent covered from "Auth State Listener" (line 35) but ended before "loadClasses", it missed "renderMessage".
// My previous tool call REPLACED "Auth State Listener" block essentially with "updateProfileUI" and the new auth listener.
// BUT I also need to replace "renderMessage". The previous tool call target text was mostly the Auth block. It also included renderMessage in replacement content but it might have been cut off or misplaced if the target text didn't span that far.
// Actually, looking at the previous tool call, I targeted the Auth Block primarily.
// I need to explicitly replace the old renderMessage and messageForm listener now.

function renderMessage(data) {
    const div = document.createElement('div');
    div.className = 'message';

    // Determine Avatar (Use stored photoURL if available, else letter)
    let avatarHtml = `<div class="avatar">${data.userName[0].toUpperCase()}</div>`;
    if (data.userPhoto) {
        avatarHtml = `<div class="avatar"><img src="${data.userPhoto}"></div>`;
    }

    // Determine Content
    let content = `<p>${data.text}</p>`;

    if (data.type === 'file') {
        const isImg = data.contentType && data.contentType.startsWith('image');
        const isPdf = data.fileName.toLowerCase().endsWith('.pdf');

        if (isImg) {
            // Image Card
            content += `
                <div class="teams-attachment-card" onclick="window.open('${data.fileUrl}')">
                    <div class="card-preview">
                        <img src="${data.fileUrl}">
                        <div class="preview-overlay">
                            <div class="preview-btn"><i class="fas fa-expand"></i> Vista previa</div>
                        </div>
                    </div>
                     <div class="card-metadata">
                        <div class="file-icon-large file-icon-img"><i class="fas fa-image"></i></div>
                        <div class="file-info">
                            <div class="filename">${data.fileName}</div>
                        </div>
                        <div class="card-actions"><i class="fas fa-ellipsis-h"></i></div>
                    </div>
                </div>
            `;
        } else {
            // Generic/PDF Card
            const iconClass = isPdf ? 'file-icon-pdf' : 'file-icon-large';
            const iconIcon = isPdf ? 'fa-file-pdf' : 'fa-file-alt';

            content += `
                 <div class="teams-attachment-card" onclick="window.open('${data.fileUrl}')">
                    <div class="card-preview ${isPdf ? 'pdf-preview' : ''}">
                         ${isPdf ? `
                            <div class="fake-doc">
                                <div class="fake-doc-header"><i class="fas fa-file-pdf"></i></div>
                                <div class="fake-doc-line"></div>
                                <div class="fake-doc-line"></div>
                                <div class="fake-doc-line short"></div>
                                <div class="fake-doc-line"></div>
                                <div class="fake-doc-line"></div>
                                <div class="fake-doc-line short"></div>
                            </div>
                         ` : '<i class="fas fa-file" style="font-size:3rem; color:#cbd5e1;"></i>'}
                         
                         <div class="preview-overlay">
                            <div class="preview-btn"><i class="fas fa-eye"></i> Vista previa</div>
                        </div>
                    </div>
                    <div class="card-metadata">
                        <div class="file-icon-large ${iconClass}"><i class="fas ${iconIcon}"></i></div>
                        <div class="file-info">
                            <div class="filename">${data.fileName}</div>
                        </div>
                        <div class="card-actions"><i class="fas fa-ellipsis-h"></i></div>
                    </div>
                </div>
            `;
        }
    }

    div.innerHTML = `
        ${avatarHtml}
        <div class="msg-content">
            <h4>${data.userName} <span style="font-size:0.75rem; color:var(--text-dim); font-weight:400; margin-left:8px;">${new Date(data.createdAt.toDate()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span></h4>
            ${content}
        </div>
    `;
    messagesContainer.appendChild(div);
}

messageForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = document.getElementById('message-input');
    const text = input.value;

    if (!text.trim() && !currentChatFile) return;

    let fileData = null;
    let msgType = 'text';

    if (currentChatFile) {
        chatPreview.innerHTML = 'Uploading... <i class="fas fa-spinner fa-spin"></i>';
        try {
            const uploaded = await uploadToYeet(currentChatFile);
            fileData = {
                fileUrl: uploaded.url,
                fileName: uploaded.filename,
                contentType: currentChatFile.type
            };
            msgType = 'file';
        } catch (err) {
            alert(err.message);
            chatPreview.style.display = 'none';
            currentChatFile = null;
            return;
        }
    }

    // Get current user photo to bake into message (optimization)
    let userPhoto = null;
    try {
        const userDoc = await getDoc(doc(db, "users", currentUser.uid));
        userPhoto = userDoc.exists() ? userDoc.data().photoURL : null;
    } catch (e) { }

    await addDoc(collection(db, "messages"), {
        channelId: currentChannelId,
        text: text,
        userId: currentUser.uid,
        userName: currentUser.email.split('@')[0],
        userPhoto: userPhoto,
        createdAt: new Date(),
        type: msgType,
        ...fileData
    });

    input.value = '';
    currentChatFile = null;
    chatPreview.style.display = 'none';
    chatFileInput.value = '';
});

// ----------------------
// TASKS & SUBMISSIONS (Updated Logic)
// ----------------------

const taskDetailsView = document.getElementById('task-details-view');
let currentTaskId = null;

function loadTasks(channelId) {
    const q = query(collection(db, "tasks"), where("channelId", "==", channelId), orderBy("createdAt", "desc"));

    onSnapshot(q, (snapshot) => {
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
            <h4 style="font-size:1.1rem; font-weight:700;">${data.title}</h4>
            <span style="font-size:0.8rem; color:var(--text-dim);">${new Date(data.createdAt.toDate()).toLocaleDateString()}</span>
        </div>
        <p style="color:var(--text-main); margin-bottom:10px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${data.description}</p>
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
    // Get the current input from DOM as the innerHTML is replaced dynamically
    const currentFileInput = document.getElementById('submission-file');
    const file = currentFileInput.files[0];

    if (!file) return alert("Por favor selecciona un archivo.");

    // Visual feedback
    const btn = submissionForm.querySelector('button[type="submit"]');
    const originalText = btn.textContent;
    btn.textContent = "Subiendo...";
    btn.disabled = true;

    try {
        const uploaded = await uploadToYeet(file);

        await addDoc(collection(db, "submissions"), {
            taskId: currentTaskId,
            studentId: currentUser.uid,
            studentEmail: currentUser.email,
            link: uploaded.url,
            fileName: uploaded.filename,
            type: 'file',
            createdAt: new Date()
        });

        alert("¡Entregado!");
        // Update view to "Submitted" state
        submissionForm.innerHTML = `
            <div style="text-align:center; padding:30px; color:green;">
                <i class="fas fa-check-circle" style="font-size:3rem; margin-bottom:15px;"></i>
                <h3>¡Entregado!</h3>
                <p>Archivo: <a href="${uploaded.url}" target="_blank">${uploaded.filename}</a></p>
            </div>
        `;

    } catch (err) {
        alert(err.message);
        btn.textContent = originalText;
        btn.disabled = false;
    }
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
            </div>
        `;
    } else {
        // Reset form
        submissionForm.innerHTML = `
             <div class="file-upload-box" id="submission-drop-zone" onclick="document.getElementById('submission-file').click()" style="border: 2px dashed var(--border-color); padding: 30px; text-align: center; border-radius: 12px; background: white; cursor: pointer; transition: all 0.2s;">
                <i class="fas fa-cloud-upload-alt" style="font-size: 2rem; color: var(--text-dim); margin-bottom: 10px;"></i>
                <p style="color: var(--text-dim); margin-bottom: 0;">Click to upload or drag and drop</p>
                <input type="file" id="submission-file" style="display:none;" onchange="handleSubFileSelect(this)">
            </div>
            <div id="submission-file-preview" style="margin-top: 15px; display: none; align-items: center; gap: 10px; background: white; padding: 10px; border-radius: 8px; border: 1px solid var(--border-color);">
                <i class="fas fa-file-alt" style="color: var(--primary);"></i>
                <span id="submission-filename">file.txt</span>
                <button type="button" onclick="clearSubmissionFile()" style="margin-left: auto; width: auto; padding: 5px; color: #ef4444; background: transparent;"><i class="fas fa-times"></i></button>
            </div>
            <button type="submit" style="width: 100%; margin-top: 20px;">Mark as Done</button>
         `;
    }
}

// Global handler for the dynamically re-inserted input
window.handleSubFileSelect = (input) => {
    if (input.files[0]) {
        document.getElementById('submission-filename').textContent = input.files[0].name;
        document.getElementById('submission-drop-zone').style.display = 'none';
        document.getElementById('submission-file-preview').style.display = 'flex';
    }
};

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
        div.style.cssText = "background:white; padding:15px; border-radius:12px; border:1px solid var(--border-color); box-shadow:var(--shadow-soft);";

        div.innerHTML = `
             <div style="font-weight:600; margin-bottom:5px;">${d.studentEmail}</div>
             <div style="font-size:0.8rem; color:var(--text-dim); margin-bottom:10px;">${new Date(d.createdAt.toDate()).toLocaleString()}</div>
             <a href="${d.link}" target="_blank" style="display:block; padding:8px; background:var(--bg-app); border-radius:6px; text-decoration:none; color:var(--primary); text-align:center; font-size:0.9rem;">
                 <i class="fas fa-download"></i> Descargar Archivo
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

    // Update visuals
    document.querySelectorAll('.channel-item').forEach(el => el.classList.remove('active'));
    // Find the settings item to make it active (last child)
    const items = channelsContainer.querySelectorAll('.channel-item');
    if (items.length > 0) items[items.length - 1].classList.add('active');

    document.getElementById('current-channel-name').textContent = "Configuración";

    messagesView.style.display = 'none';
    tasksView.style.display = 'none';
    settingsView.style.display = 'flex';

    // Load Settings Data
    const classDoc = await getDoc(doc(db, "classes", currentClassId));
    if (!classDoc.exists()) return;
    const classData = classDoc.data();

    document.getElementById('settings-class-name').textContent = classData.name;
    document.getElementById('settings-class-code').textContent = classData.code || 'N/A';

    // Members List
    const membersList = document.getElementById('settings-members-list');
    membersList.innerHTML = '<div class="loader" style="padding:20px;"></div>';

    const students = classData.studentEmails || [];

    if (students.length === 0) {
        membersList.innerHTML = '<div style="padding:20px; text-align:center; color:var(--text-dim);">No hay estudiantes todavía.</div>';
    } else {
        let html = '';
        students.forEach(email => {
            html += `
                <div style="padding: 12px 20px; border-bottom: 1px solid var(--border-color); display: flex; align-items: center; gap: 12px;">
                    <div class="avatar" style="width: 32px; height: 32px; font-size: 0.9rem;">${email[0].toUpperCase()}</div>
                    <span>${email}</span>
                </div>
            `;
        });
        membersList.innerHTML = html;
    }

    // Show/Hide Role specific sections
    const profOnly = settingsView.querySelectorAll('.prof-only');
    const studentOnly = settingsView.querySelectorAll('.student-only');

    if (currentRole === 'professor') {
        profOnly.forEach(el => el.style.display = 'block');
        studentOnly.forEach(el => el.style.display = 'none');
    } else {
        profOnly.forEach(el => el.style.display = 'none');
        studentOnly.forEach(el => el.style.display = 'block');
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
            studentEmails: arrayRemove(currentUser.email)
        });
        alert("Saliste de la clase.");
        document.getElementById('back-to-dash').click();
    }
};