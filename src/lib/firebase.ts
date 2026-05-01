import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';

// Singleton initialization
const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

// CRITICAL: The app will break without specifying the firestoreDatabaseId if it's not '(default)'
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);
export { app };
