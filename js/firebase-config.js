const firebaseConfig = {
    apiKey: "AIzaSyDcfMDq7YNehN7wVK5BGLiqWM7In_M4md4",
    authDomain: "relay-243eb.firebaseapp.com",
    projectId: "relay-243eb",
    storageBucket: "relay-243eb.firebasestorage.app",
    messagingSenderId: "1007825605094",
    appId: "1:1007825605094:web:ed5c7aa733338db2130627",
    measurementId: "G-5QP82WQG61"
};

// Initialize Firebase
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getFirestore, collection, addDoc, doc, getDoc, setDoc, query, where, getDocs, onSnapshot, orderBy, updateDoc, arrayUnion, arrayRemove, deleteDoc, limit } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { getStorage, ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);

export {
    app, auth, db, storage,
    signInWithEmailAndPassword, createUserWithEmailAndPassword, onAuthStateChanged, signOut,
    collection, addDoc, doc, getDoc, setDoc, query, where, getDocs, onSnapshot, orderBy, updateDoc, arrayUnion, arrayRemove, deleteDoc, limit,
    ref, uploadBytes, getDownloadURL
};
