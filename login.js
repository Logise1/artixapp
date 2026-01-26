import { auth, db, signInWithEmailAndPassword, createUserWithEmailAndPassword, setDoc, doc, getDoc } from "./firebase-config.js";

const form = document.getElementById('auth-form');
const emailInput = document.getElementById('email');
const passwordInput = document.getElementById('password');
const isProfessorInput = document.getElementById('is-professor');
const errorMsg = document.getElementById('error-message');
const submitBtn = document.getElementById('submit-btn');
const toggleBtn = document.getElementById('toggle-mode');

let isLogin = true;

// Check if already logged in
auth.onAuthStateChanged(user => {
    if (user) {
        window.location.href = 'dashboard.html';
    }
});

toggleBtn.addEventListener('click', (e) => {
    e.preventDefault();
    isLogin = !isLogin;

    if (isLogin) {
        document.querySelector('.subtitle').textContent = "Introduce tus credenciales para acceder.";
        submitBtn.textContent = "Entrar";
        toggleBtn.textContent = "Crea una";
        document.querySelector('.role-selector').style.display = 'none';
        document.querySelector('h1').textContent = "Bienvenido de nuevo";
    } else {
        document.querySelector('.subtitle').textContent = "Únete a tu comunidad escolar hoy.";
        submitBtn.textContent = "Crear Cuenta";
        toggleBtn.textContent = "Iniciar sesión en su lugar";
        document.querySelector('.role-selector').style.display = 'flex';
        document.querySelector('h1').textContent = "Empezar";
    }
    errorMsg.textContent = '';
});

form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = emailInput.value;
    const password = passwordInput.value;
    const isProfessor = isProfessorInput.checked;

    errorMsg.textContent = 'Cargando...';
    submitBtn.disabled = true;

    try {
        if (isLogin) {
            await signInWithEmailAndPassword(auth, email, password);
            // Redirect handled by onAuthStateChanged
        } else {
            const userCredential = await createUserWithEmailAndPassword(auth, email, password);
            const user = userCredential.user;

            // Store user role
            await setDoc(doc(db, "users", user.uid), {
                email: email,
                role: isProfessor ? 'professor' : 'student',
                createdAt: new Date()
            });
            // Redirect handled by onAuthStateChanged
        }
    } catch (error) {
        console.error(error);
        errorMsg.textContent = error.message.replace('Firebase: ', '');
        submitBtn.disabled = false;
    }
});
