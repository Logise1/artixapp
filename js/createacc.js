import { auth, db, createUserWithEmailAndPassword, doc, setDoc } from "./firebase-config.js";

const form = document.getElementById('signup-form');
const firstNameInput = document.getElementById('first-name');
const lastNameInput = document.getElementById('last-name');
const emailInput = document.getElementById('email');
const passwordInput = document.getElementById('password');
const isProfessorCheckbox = document.getElementById('is-professor');
const errorMsg = document.getElementById('error-message');
const submitBtn = document.getElementById('submit-btn');

form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorMsg.textContent = '';
    submitBtn.textContent = 'Creando cuenta...';
    submitBtn.disabled = true;

    const firstName = firstNameInput.value.trim();
    const lastName = lastNameInput.value.trim();
    const email = emailInput.value.trim();
    const password = passwordInput.value;
    const isProfessor = isProfessorCheckbox.checked;

    if (!firstName || !lastName || !email || !password) {
        showError("Por favor completa todos los campos.");
        resetBtn();
        return;
    }

    try {
        // Create User Auth
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        const user = userCredential.user;

        // Create User Doc with Name
        await setDoc(doc(db, "users", user.uid), {
            email: email,
            firstName: firstName,
            lastName: lastName,
            displayName: `${firstName} ${lastName}`,
            role: isProfessor ? 'professor' : 'student',
            createdAt: new Date(),
            photoURL: null
        });

        // Redirect
        window.location.href = 'dashboard.html';

    } catch (error) {
        console.error(error);
        if (error.code === 'auth/email-already-in-use') {
            showError("Este correo ya está registrado.");
        } else if (error.code === 'auth/weak-password') {
            showError("La contraseña debe tener al menos 6 caracteres.");
        } else {
            showError("Error: " + error.message);
        }
        resetBtn();
    }
});

function showError(msg) {
    errorMsg.textContent = msg;
    errorMsg.style.display = 'block';
}

function resetBtn() {
    submitBtn.textContent = 'Registrarse';
    submitBtn.disabled = false;
}
