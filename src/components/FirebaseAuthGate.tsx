import React, { useState, useEffect } from 'react';
import { auth, db } from '../firebase';
import { onAuthStateChanged, signInWithPopup, GoogleAuthProvider, signOut } from 'firebase/auth';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { Loader2 } from 'lucide-react';

export function FirebaseAuthGate({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<any>(null);
  const [isApproved, setIsApproved] = useState<boolean>(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      if (currentUser) {
        try {
          const userDocRef = doc(db, 'users', currentUser.uid);
          const userDoc = await getDoc(userDocRef);
          
          if (userDoc.exists()) {
            setIsApproved(userDoc.data().isApproved === true);
          } else {
            // Create the user document with isApproved: false
            await setDoc(userDocRef, {
              email: currentUser.email,
              isApproved: false,
              createdAt: serverTimestamp()
            });
            setIsApproved(false);
          }
        } catch (error) {
          console.error("Error checking approval status:", error);
          setIsApproved(false);
        }
      } else {
        setIsApproved(false);
      }
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  const handleLogin = async () => {
    const provider = new GoogleAuthProvider();
    try {
      await signInWithPopup(auth, provider);
    } catch (error) {
      console.error("Error signing in:", error);
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
    } catch (error) {
      console.error("Error signing out:", error);
    }
  };

  if (loading) {
    return (
      <div className="py-24 bg-[#050505] text-[#E4E3E0] flex items-center justify-center font-mono">
        <Loader2 className="w-6 h-6 animate-spin text-neon-green" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="py-24 bg-[#050505] text-[#E4E3E0] flex flex-col items-center justify-center font-mono p-4">
        <div className="max-w-md w-full border border-[#333] p-8 bg-[#0a0a0a]">
          <h1 className="text-2xl font-bold mb-4 text-neon-red uppercase tracking-wider">Authentication Required</h1>
          <p className="text-[#888] mb-6 text-sm leading-relaxed">
            The Protocol requires pilot verification to access advanced Gemini analysis features. 
            Identify yourself to proceed.
          </p>
          <button 
            onClick={handleLogin}
            className="w-full bg-neon-green text-brutal-black font-bold py-3 px-4 uppercase tracking-widest text-sm transition-colors hover:bg-white"
          >
            Verify Identity (Login)
          </button>
        </div>
      </div>
    );
  }

  if (!isApproved) {
    return (
      <div className="py-24 bg-[#050505] text-[#E4E3E0] flex flex-col items-center justify-center font-mono p-4">
        <div className="max-w-md w-full border border-[#333] p-8 bg-[#0a0a0a]">
          <h1 className="text-2xl font-bold mb-4 text-yellow-500 uppercase tracking-wider">Clearance Pending</h1>
          <p className="text-[#888] mb-6 text-sm leading-relaxed">
            Your identity ({user.email}) has been verified, but your clearance level is insufficient. 
            Access to The Protocol's advanced features requires manual approval from the Architect.
          </p>
          <button 
            onClick={handleLogout}
            className="w-full border border-[#333] text-[#888] font-bold py-3 px-4 uppercase tracking-widest text-sm transition-colors hover:bg-[#111] hover:text-white"
          >
            Sign Out
          </button>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
