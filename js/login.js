import { auth, db, signInWithEmailAndPassword, createUserWithEmailAndPassword, setDoc, doc, getDoc } from "./firebase-config.js";
import { studentWhitelist } from "./student_whitelist.js";

const form = document.getElementById('auth-form');
const emailInput = document.getElementById('email');
const passwordInput = document.getElementById('password');
const errorMsg = document.getElementById('error-message');
const submitBtn = document.getElementById('submit-btn');

// Toast Function
function showToast(message, type = 'error') {
    // Remove existing toast if any
    const existing = document.querySelector('.toast-notification');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = `toast-notification ${type}`;

    // Icon
    let icon = '';
    if (type === 'error') {
        icon = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>`;
    } else {
        icon = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
    }

    toast.innerHTML = `<div class="toast-icon">${icon}</div> <span>${message}</span>`;
    document.body.appendChild(toast);

    // Trigger animation
    requestAnimationFrame(() => {
        toast.classList.add('show');
    });

    // Hide after 3s
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => {
            if (toast && toast.parentNode) toast.parentNode.removeChild(toast);
        }, 400);
    }, 3000);
}

// Check if already logged in
auth.onAuthStateChanged(user => {
    if (user) {
        window.location.href = 'dashboard.html';
    }
});

form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = emailInput.value.trim().toLowerCase();
    const password = passwordInput.value;

    if (errorMsg) errorMsg.textContent = '';
    submitBtn.disabled = true;
    const originalBtnText = submitBtn.textContent;
    submitBtn.textContent = 'Cargando...';

    try {
        await signInWithEmailAndPassword(auth, email, password);
        // Redirect handled by onAuthStateChanged
    } catch (error) {
        console.log("Login failed, checking whitelist...", error.code);

        // AUTO-REGISTRATION LOGIC
        // If user not found (or invalid credential which masks it), check whitelist
        const studentInfo = studentWhitelist.find(s => s.email.toLowerCase() === email);

        if (studentInfo) {
            try {
                // Attempt to create the user
                const userCredential = await createUserWithEmailAndPassword(auth, email, password);

                // Create user profile in Firestore
                await setDoc(doc(db, "users", userCredential.user.uid), {
                    email: email,
                    displayName: studentInfo.name,
                    role: 'student',
                    createdAt: new Date(),
                    photoURL: null
                });

                showToast(`Bienvenido ${studentInfo.name}. Cuenta creada.`, 'success');
                // Redirect will happen via onAuthStateChanged automatically
                return;

            } catch (createError) {
                console.error("Auto-creation failed:", createError);

                if (createError.code === 'auth/email-already-in-use') {
                    // User DOES exist, so the original login failure was due to WRONG PASSWORD
                    showToast("Contraseña incorrecta", 'error');
                } else if (createError.code === 'auth/weak-password') {
                    showToast("Contraseña muy débil (mínimo 6 caracteres)", 'error');
                } else {
                    showToast("Error al crear cuenta: " + createError.message, 'error');
                }
            }
        } else {
            // Not in whitelist, handle as normal login failure
            submitBtn.disabled = false;
            submitBtn.textContent = originalBtnText;
            console.error("Login Check:", error);

            if (error.code === 'auth/wrong-password' || error.code === 'auth/invalid-credential') { /* often generic */
                showToast("Usuario o contraseña incorrectas", 'error');
            } else if (error.code === 'auth/user-not-found') {
                showToast("Usuario no encontrado", 'error');
            } else if (error.code === 'auth/too-many-requests') {
                showToast("Demasiados intentos. Inténtalo más tarde.", 'error');
            } else {
                showToast("Error al iniciar sesión", 'error');
            }
        }

        submitBtn.disabled = false;
        submitBtn.textContent = originalBtnText;
    }
});
