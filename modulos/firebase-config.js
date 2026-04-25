import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { getFunctions } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-functions.js";

const firebaseConfig = {
    apiKey: "AIzaSyArXS-nRFGb7MRQ30BsPM4vYdqXWfxNdg4",
    authDomain: "super-m-growshop.firebaseapp.com",
    projectId: "super-m-growshop",
    storageBucket: "super-m-growshop.firebasestorage.app",
    messagingSenderId: "851787326044",
    appId: "1:851787326044:web:727818a787e52d9a19fc99",
    measurementId: "G-KEPKJYST55"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const functions = getFunctions(app, 'us-central1');

// Constantes Globales del Alquimista
export const ADMIN_UID = 'uYs87x57iGQPwR9WRilXf7dCYx62';
export const MI_NUMERO = '5492966637000';

export { auth, db, functions, app };

// Exponemos a window para compatibilidad temporal con scripts antiguos si es necesario
window.auth = auth;
window.db = db;
window.firebaseApp = app;