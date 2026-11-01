import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  getFirestore,
  doc,
  getDocFromServer
} from 'firebase/firestore';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
  User
} from 'firebase/auth';
import firebaseConfig from '../firebase-applet-config.json';
import { AUTHORIZED_ADMIN_EMAILS } from './defaultData';

export const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);

// CRITICAL: The app will break without specifying the firestoreDatabaseId
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData?.map(provider => ({
        providerId: provider.providerId,
        email: provider.email,
      })) || []
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// Validation connection on boot as required by Firebase skill
export async function testConnection(): Promise<boolean> {
  try {
    await getDocFromServer(doc(db, 'site', 'content'));
    return true;
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.warn("Please check your Firebase configuration or network status.");
    }
    return false;
  }
}

/**
 * Check if a given email is in the authorized admin list
 */
export function isAuthorizedAdmin(email: string | null | undefined): boolean {
  if (!email) return false;
  const normalized = email.trim().toLowerCase();
  return AUTHORIZED_ADMIN_EMAILS.some(e => e.toLowerCase() === normalized);
}

// Admin passkeys allowed for direct GitHub Pages login without showing firebase redirect popup
const VALID_PASSKEYS = ['meadow2026', 'meadow@admin2026', 'admin@meadow'];

export interface AdminSession {
  email: string;
  uid: string;
  displayName: string;
  role: 'superadmin';
}

const STORAGE_KEY = 'meadow_admin_session';

export function getStoredAdminSession(): AdminSession | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY) || localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AdminSession;
    if (parsed && parsed.email && isAuthorizedAdmin(parsed.email)) {
      return parsed;
    }
  } catch {
    // ignore parse error
  }
  return null;
}

/**
 * Direct In-App Admin Login:
 * Zero popups, no external URLs or firebaseapp.com domain shown.
 * Perfect for GitHub Pages and production embeds!
 */
export function signInAdminWithKey(email: string, passKey: string, remember = true): AdminSession {
  const normEmail = email.trim().toLowerCase();
  if (!isAuthorizedAdmin(normEmail)) {
    throw new Error('অননুমোদিত ইমেইল। শুধুমাত্র অনুমোদিত অ্যাডমিন আইডি দিয়ে লগইন করা সম্ভব।');
  }

  const trimmedKey = passKey.trim();
  if (!VALID_PASSKEYS.includes(trimmedKey)) {
    throw new Error('ভুল সিকিউরিটি পাসকি। সঠিক অ্যাডমিন অ্যাক্সেস কী প্রদান করুন।');
  }

  const session: AdminSession = {
    email: normEmail,
    uid: 'admin_' + normEmail.replace(/[^a-z0-9]/g, '_'),
    displayName: normEmail.includes('shekhor') ? 'Shekhor Sharma' : 'Durjoy Sharma',
    role: 'superadmin'
  };

  const payload = JSON.stringify(session);
  if (remember) {
    localStorage.setItem(STORAGE_KEY, payload);
  }
  sessionStorage.setItem(STORAGE_KEY, payload);
  window.dispatchEvent(new Event('meadow_auth_change'));

  return session;
}

/**
 * Google Sign-In with strict admin enforcement:
 */
export async function signInAdminWithGoogle(): Promise<User> {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({
    prompt: 'select_account'
  });

  const credential = await signInWithPopup(auth, provider);
  const user = credential.user;

  if (!user || !user.email || !isAuthorizedAdmin(user.email)) {
    await signOut(auth);
    throw new Error(
      'অননুমোদিত অ্যাক্সেস: শুধুমাত্র অনুমোদিত অ্যাডমিন লগইন করতে পারবেন। সাধারণ কোনো অ্যাকাউন্ট তৈরির সুযোগ নেই।'
    );
  }

  // Also save verified session
  const session: AdminSession = {
    email: user.email.toLowerCase(),
    uid: user.uid,
    displayName: user.displayName || user.email.split('@')[0],
    role: 'superadmin'
  };
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  window.dispatchEvent(new Event('meadow_auth_change'));

  return user;
}

export async function logOutAdmin(): Promise<void> {
  localStorage.removeItem(STORAGE_KEY);
  sessionStorage.removeItem(STORAGE_KEY);
  await signOut(auth).catch(() => {});
  window.dispatchEvent(new Event('meadow_auth_change'));
}

export { onAuthStateChanged };
