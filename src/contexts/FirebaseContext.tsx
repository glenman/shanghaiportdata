import React, { createContext, useContext, useEffect, useState } from 'react';
import { onAuthStateChanged, User } from 'firebase/auth';
import { auth, signInWithGoogle, signOutFirebase } from '../firebase.js';

export const ADMIN_GOOGLE_EMAIL = 'glenman@gmail.com';

interface FirebaseContextValue {
  user: User | null;
  authLoading: boolean;
  isAdminAuthorized: boolean;
  authError: string | null;
  loginWithGoogle: () => Promise<void>;
  logout: () => Promise<void>;
  clearAuthError: () => void;
}

const FirebaseContext = createContext<FirebaseContextValue | undefined>(undefined);

export const FirebaseProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
      setUser(firebaseUser);
      setAuthLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const isAdminAuthorized = Boolean(
    user && user.emailVerified && user.email === ADMIN_GOOGLE_EMAIL
  );

  const loginWithGoogle = async () => {
    setAuthError(null);
    try {
      await signInWithGoogle();
    } catch (err: any) {
      const code = err?.code || '';
      if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
        return;
      }
      if (code === 'auth/popup-blocked') {
        setAuthError('登录弹窗被浏览器拦截，请允许弹出窗口后重试。');
        return;
      }
      setAuthError('Google 授权登录失败，请稍后重试。');
      console.error('Google Sign-In error:', err);
    }
  };

  const logout = async () => {
    setAuthError(null);
    try {
      await signOutFirebase();
    } catch (err) {
      console.error('Sign out error:', err);
    }
  };

  return (
    <FirebaseContext.Provider
      value={{
        user,
        authLoading,
        isAdminAuthorized,
        authError,
        loginWithGoogle,
        logout,
        clearAuthError: () => setAuthError(null),
      }}
    >
      {children}
    </FirebaseContext.Provider>
  );
};

export function useFirebase(): FirebaseContextValue {
  const ctx = useContext(FirebaseContext);
  if (!ctx) {
    throw new Error('useFirebase must be used within a FirebaseProvider');
  }
  return ctx;
}
