/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect } from 'react';
import { onAuthStateChanged, User as FirebaseUser } from 'firebase/auth';
import { collection, query, orderBy, onSnapshot } from 'firebase/firestore';
import { motion } from 'motion/react';
import { Shield, Layers, Sparkles } from 'lucide-react';

import { auth, db, handleFirestoreError, OperationType } from './firebase';
import { Project } from './types';
import AdminView from './components/AdminView';

export default function App() {
  // Database core states
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [dbError, setDbError] = useState<string | null>(null);

  // Auth User Session State
  const [currentUser, setCurrentUser] = useState<FirebaseUser | null>(null);
  const [userLoading, setUserLoading] = useState<boolean>(true);

  // Monitor Auth Session Status
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setCurrentUser(user);
      setUserLoading(false);
    });
    return () => unsubscribe();
  }, []);

  // Monitor Firestore realtime project streams
  useEffect(() => {
    const projectsRef = collection(db, 'projects');
    // Sort projects by newest published
    const q = query(projectsRef, orderBy('createdAt', 'desc'));

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const fetchedProjects: Project[] = [];
        snapshot.forEach((doc) => {
          fetchedProjects.push({
            id: doc.id,
            ...doc.data(),
          } as Project);
        });
        setProjects(fetchedProjects);
        setLoading(false);
        setDbError(null);
      },
      (error) => {
        console.error("Firestore Snapshot Sync Error:", error);
        setDbError("A database authorization trigger occurred. Verify your config or connection rules.");
        setLoading(false);
        // Invoke compliant Firestore error reporter per instructions
        handleFirestoreError(error, OperationType.LIST, 'projects');
      }
    );

    return () => unsubscribe();
  }, []);

  // Manual Trigger to refresh project array from database
  const triggerRefresh = () => {
    setLoading(true);
    // onSnapshot updates on its own, but we can set loading temporarily to give visual feedback
    setTimeout(() => {
      setLoading(false);
    }, 400);
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-300 flex flex-col selection:bg-amber-600 selection:text-white antialiased font-sans">
      {/* Exquisite Top Bar Header */}
      <header className="sticky top-0 z-40 bg-zinc-950/80 backdrop-blur-md border-b border-zinc-900" id="main-header">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-5 flex items-center justify-between gap-4">
          
          {/* Logo & Slogan */}
          <div className="flex items-center gap-3 sm:flex-1 justify-start">
            <div className="w-10 h-10 bg-zinc-900 border border-zinc-800 rounded-xl flex items-center justify-center text-amber-500 shadow-sm" id="app-logo">
              <Layers className="w-5 h-5" />
            </div>
            <div>
              <h1 className="font-serif italic text-xl text-white tracking-tight flex items-center gap-2 block">
                MaintenanceMasters
                <Sparkles className="w-4 h-4 text-amber-500 fill-amber-500/20 shrink-0" />
              </h1>
              <p className="font-mono text-[9px] text-zinc-550 text-zinc-500 font-semibold uppercase tracking-widest leading-none mt-0.5">Contractor Database</p>
            </div>
          </div>

          {/* Realtime database count metadata pill */}
          {!loading && (
            <div className="hidden sm:flex sm:flex-1 justify-center">
              <div className="inline-flex items-center gap-2 bg-zinc-900/50 border border-zinc-800 px-3.5 py-1.5 rounded-full text-xs text-zinc-400 font-medium font-sans animate-fade-in">
                <span className="w-2 h-2 bg-amber-500 rounded-full animate-pulse shrink-0"></span>
                {projects.length} active custom {projects.length === 1 ? 'project' : 'projects'} listed
              </div>
            </div>
          )}

          {/* Controller Mode Badge */}
          <div className="flex items-center sm:flex-1 justify-end">
            <div className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-900 border border-zinc-800 rounded-xl">
              <Shield className="w-3.5 h-3.5 text-amber-500" />
              <span className="text-[10px] uppercase font-mono font-bold tracking-wider text-zinc-400">ADMIN</span>
            </div>
          </div>

        </div>
      </header>

      {/* Main Container Stage */}
      <main className="flex-1 w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 md:py-16" id="main-frame">
        {dbError && (
          <div className="mb-8 p-5 bg-amber-950/20 border border-amber-500/30 rounded-2xl flex items-start gap-3 text-left font-sans text-xs">
            <Shield className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
            <div>
              <span className="font-semibold text-white block">Database Sync Mode Constraint</span>
              <span className="text-zinc-400 leading-normal mt-1 block">{dbError}</span>
            </div>
          </div>
        )}

        <motion.div
          key="admin-view"
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
        >
          {/* Admin Panel Headers */}
          <div className="space-y-3 mb-12 max-w-xl">
            <h2 className="font-serif italic text-3xl md:text-4xl text-white tracking-tight">
              Contractor Project Control
            </h2>
            <p className="font-sans text-sm text-zinc-400 leading-relaxed text-balance">
              Manage, update, and track service restorations, structural repairs, and facility maintenance records directly through the centralized contractor archival system.
            </p>
          </div>

          {/* Admin Control Board */}
          {userLoading ? (
            <div className="flex flex-col items-center justify-center py-24 space-y-4">
              <div className="w-10 h-10 border-4 border-zinc-800 border-t-amber-500 rounded-full animate-spin"></div>
              <span className="text-xs text-zinc-500 font-sans font-medium">Verifying authorization profile...</span>
            </div>
          ) : (
            <AdminView 
              user={currentUser} 
              projects={projects} 
              loading={loading} 
              onRefresh={triggerRefresh} 
            />
          )}
        </motion.div>
      </main>

      {/* Footer Design */}
      <footer className="bg-zinc-950 border-t border-zinc-900 py-10 text-center text-xs font-sans text-zinc-500 shrink-0" id="developer-footer">
        <div className="max-w-7xl mx-auto px-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-6">
          <p>© 2026 MaintenanceMasters. Under Zero-Trust Firestore ABAC Guards.</p>
          <div className="flex items-center justify-center gap-5 text-zinc-500 font-medium">
            <span className="flex items-center gap-1.5">
              <Shield className="w-4 h-4 text-zinc-600" />
              Secure Sync
            </span>
          </div>
        </div>
      </footer>
    </div>
  );
}
