// Use the global firebase object from the CDN scripts in index.html
const firebase = (window as any).firebase;

const firebaseConfig = {
  apiKey: "AIzaSyDeGvMR650s8TPJ6Ur0kTzO7bAX2jQuWF8",
  authDomain: "ballot7.firebaseapp.com",
  projectId: "ballot7",
  storageBucket: "ballot7.firebasestorage.app",
  messagingSenderId: "93554006050",
  appId: "1:93554006050:web:80f1d8d5c14ddd91b0527b"
};

// Initialize Firebase if it's available and not already initialized
if (firebase && !firebase.apps.length) {
  firebase.initializeApp(firebaseConfig);
}

export const db = firebase ? firebase.firestore() : null;

// No Auth as requested
export const auth = null;
export const googleProvider = null;
