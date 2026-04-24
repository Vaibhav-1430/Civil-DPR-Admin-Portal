import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-storage.js";

// Replace these values with the same Firebase project config used by the mobile app.
export const firebaseConfig = {
 apiKey: "AIzaSyCznnH2VYfMFQo8uG9Yghtw8bKyLgaWNEo",
  authDomain: "civildpr-5972c.firebaseapp.com",
  projectId: "civildpr-5972c",
  storageBucket: "civildpr-5972c.firebasestorage.app",
  messagingSenderId: "602206536180",
  appId: "1:602206536180:web:11bcf42cd5f8d0816139a1",
  measurementId: "G-19378JJYXV"
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);
