/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, FormEvent } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Plus, Edit2, Trash2, Shield, User, LogOut, CheckCircle2, 
  Image as ImageIcon, RefreshCcw, Save, AlertTriangle, HelpCircle, Eye, Upload, Star, X, LayoutTemplate
} from 'lucide-react';
import { 
  collection, doc, setDoc, deleteDoc 
} from 'firebase/firestore';
import { 
  GoogleAuthProvider, signInWithPopup, signOut, User as FirebaseUser 
} from 'firebase/auth';
import { auth, db, handleFirestoreError, OperationType } from '../firebase';
import { Project, CATEGORIES, CategoryType, ProjectFormData } from '../types';

const convertUrlToHtml = (url: string) => {
  if (!url) return '';
  if (url.includes('<a') || url.includes('<img')) return url;
  return `<a href="${url}"><img src="${url}" border="0"></a>`;
};

const extractUrlFromHtml = (html: string) => {
  if (!html) return '';
  if (html.includes('<img') && html.includes('src=')) {
    const match = html.match(/src=["'](.*?)["']/);
    if (match && match[1]) return match[1];
  }
  return html;
};

const handleImageFileUpload = (
  file: File,
  onSuccess: (base64: string) => void,
  onFailure: (err: string) => void
) => {
  if (!file.type.startsWith('image/')) {
    onFailure('Please select a valid image file from your device.');
    return;
  }
  
  const reader = new FileReader();
  reader.onload = (event) => {
    const img = new Image();
    img.onload = () => {
      // Create canvas for smart compression
      const canvas = document.createElement('canvas');
      let width = img.width;
      let height = img.height;
      const MAX_SIZE = 1200; // Limit max dimension to fit within Firestore limit safely
      if (width > height) {
        if (width > MAX_SIZE) {
          height = Math.round((height * MAX_SIZE) / width);
          width = MAX_SIZE;
        }
      } else {
        if (height > MAX_SIZE) {
          width = Math.round((width * MAX_SIZE) / height);
          height = MAX_SIZE;
        }
      }
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(img, 0, 0, width, height);
        // Use quality of 0.75 for jpeg
        const compressedBase64 = canvas.toDataURL('image/jpeg', 0.80);
        onSuccess(compressedBase64);
      } else {
        onSuccess(event.target?.result as string);
      }
    };
    img.onerror = () => {
      onFailure('Failed to load image file.');
    };
    img.src = event.target?.result as string;
  };
  reader.onerror = () => {
    onFailure('Failed to read image file.');
  };
  reader.readAsDataURL(file);
};

interface AdminViewProps {
  user: FirebaseUser | null;
  projects: Project[];
  loading: boolean;
  onRefresh: () => void;
}

export default function AdminView({ user, projects, loading, onRefresh }: AdminViewProps) {
  // Authentication states
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  // Form states
  const [isEditing, setIsEditing] = useState<boolean>(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState<ProjectFormData>({
    name: '',
    subtitle: '',
    category: 'Residential',
    imageUrl: '',
    detail: '',
    location: '',
    year: '',
    galleryImages: [],
    isFeatured: false,
    showInCarousel: false
  });

  // Action messages
  const [statusMsg, setStatusMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [submitLoading, setSubmitLoading] = useState(false);

  // Automatically clear status message after 5 seconds
  useEffect(() => {
    if (statusMsg) {
      const timer = setTimeout(() => {
        setStatusMsg(null);
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [statusMsg]);

  // Filtering & Selected Preview states
  const [selectedLocFilter, setSelectedLocFilter] = useState<string>('All');
  const [selectedYearFilter, setSelectedYearFilter] = useState<string>('All');
  const [previewProject, setPreviewProject] = useState<Project | null>(null);
  const [activePreviewImage, setActivePreviewImage] = useState<string | null>(null);

  // Confirmation modal states
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [pendingConfirmAction, setPendingConfirmAction] = useState<(() => void) | null>(null);
  const [confirmModalText, setConfirmModalText] = useState({ title: '', description: '', isDelete: false });

  // Switch preview project and set active image
  const handleSetPreviewProject = (project: Project | null) => {
    setPreviewProject(project);
    setActivePreviewImage(project ? extractUrlFromHtml(project.image) : null);
  };

  // Since individual ownerId matching is removed from the portfolio, all logged-in admins can preview and maintain projects
  const userProjects = projects;

  // Dynamic unique values extracted for filtering
  const uniqueLocations = Array.from(new Set(userProjects.map(p => p.location || '').filter(Boolean)));
  const uniqueYears = Array.from(new Set(userProjects.map(p => p.year || '').filter(Boolean)));

  const filteredProjects = userProjects.filter(p => {
    const locMatch = selectedLocFilter === 'All' || (p.location || '') === selectedLocFilter;
    const yearMatch = selectedYearFilter === 'All' || (p.year || '') === selectedYearFilter;
    return locMatch && yearMatch;
  });

  // Sign In using Google Single Sign-on Popup
  const handleGoogleSignIn = async () => {
    setAuthLoading(true);
    setAuthError(null);
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    try {
      await signInWithPopup(auth, provider);
      onRefresh();
    } catch (err: any) {
      console.error("Sign in failed:", err);
      setAuthError(err.message || "Could not complete authentication. Please try again.");
    } finally {
      setAuthLoading(false);
    }
  };

  // Sign Out function
  const handleSignOut = async () => {
    try {
      await signOut(auth);
      resetForm();
    } catch (err: any) {
      console.error("Sign out error", err);
    }
  };

  // Form Reset
  const resetForm = () => {
    setFormData({
      name: '',
      subtitle: '',
      category: 'Residential',
      imageUrl: '',
      detail: '',
      location: '',
      year: '',
      galleryImages: [],
      isFeatured: false,
      showInCarousel: false
    });
    setIsEditing(false);
    setEditingId(null);
    setStatusMsg(null);
    setShowConfirmModal(false);
    setPendingConfirmAction(null);
  };

  const isFormDirty = () => {
    // Basic dirty check: is anything non-default?
    const isNewFormEmpty = (
      formData.name.trim() === '' &&
      formData.subtitle.trim() === '' &&
      formData.imageUrl.trim() === '' &&
      (formData.detail || '').trim() === '' &&
      formData.location.trim() === '' &&
      formData.year.trim() === '' &&
      (formData.galleryImages || []).every(img => img.trim() === '') &&
      formData.isFeatured === false &&
      formData.showInCarousel === false &&
      formData.category === 'Residential'
    );
    
    return !isNewFormEmpty;
  };

  const handleClearFormClick = () => {
    if (isFormDirty()) {
      setConfirmModalText({
        title: 'Clear Form Content',
        description: 'You have entered data in this form. Are you sure you want to clear everything? This action cannot be undone.',
        isDelete: false
      });
      setPendingConfirmAction(() => resetForm);
      setShowConfirmModal(true);
    } else {
      resetForm();
    }
  };

  const handleCancelEditClick = () => {
    // When editing, we always confirm if they want to discard changes, 
    // but we can be smarter if they actually haven't touched anything.
    // For now, consistent with user request: prevent accidental loss of 'Edit' session.
    setConfirmModalText({
      title: 'Discard Revisions',
      description: 'You are currently in an active edit session. Are you sure you want to cancel and discard any unsaved changes?',
      isDelete: false
    });
    setPendingConfirmAction(() => resetForm);
    setShowConfirmModal(true);
  };

  // Safe Image URL Validator
  const isValidImageUrl = (url: string) => {
    if (!url) return false;
    // Ensure it starts with http://, https:// or data:image/ (representing local base64 upload)
    return url.startsWith('http://') || url.startsWith('https://') || url.startsWith('data:image/');
  };

  // Quick Toggle Featured property directly from list or form state
  const handleToggleFeatured = async (projectId: string, currentFeatured: boolean) => {
    if (!user) return;
    const writePath = `projects/${projectId}`;
    try {
      await setDoc(doc(db, 'projects', projectId), {
        isFeatured: !currentFeatured
      }, { merge: true });
      setStatusMsg({
        type: 'success',
        text: `Featured status successfully updated in cloud database.`
      });
      onRefresh();
    } catch (error: any) {
      console.error("Failed to toggle featured state", error);
      setStatusMsg({
        type: 'error',
        text: 'Failed to change featured setting. Authentication rights or verified account ownership required.'
      });
      handleFirestoreError(error, OperationType.UPDATE, writePath);
    }
  };

  // Quick Toggle Carousel property directly from list
  const handleToggleCarousel = async (projectId: string, currentCarousel: boolean) => {
    if (!user) return;
    const writePath = `projects/${projectId}`;
    try {
      await setDoc(doc(db, 'projects', projectId), {
        showInCarousel: !currentCarousel
      }, { merge: true });
      setStatusMsg({
        type: 'success',
        text: `Carousel status successfully updated for this project.`
      });
      onRefresh();
    } catch (error: any) {
      console.error("Failed to toggle carousel state", error);
      setStatusMsg({
        type: 'error',
        text: 'Failed to change carousel setting.'
      });
      handleFirestoreError(error, OperationType.UPDATE, writePath);
    }
  };

  // Form Submit (Creates or Updates Firestore document)
  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!user) return;

    // Strict validation check of inputs
    if (!formData.name.trim() || formData.name.length > 200) {
      setStatusMsg({ type: 'error', text: 'Name of project is required, limit is 200 characters.' });
      return;
    }
    if (!formData.subtitle.trim() || formData.subtitle.length > 500) {
      setStatusMsg({ type: 'error', text: 'Subtitle is required, limit is 500 characters.' });
      return;
    }
    if (!formData.location.trim() || formData.location.length > 150) {
      setStatusMsg({ type: 'error', text: 'Location is required, limit is 150 characters.' });
      return;
    }
    if (!formData.year.trim() || formData.year.length > 20) {
      setStatusMsg({ type: 'error', text: 'Year is required (e.g. 2026), limit is 120 characters.' });
      return;
    }
    if (!isValidImageUrl(formData.imageUrl)) {
      setStatusMsg({ type: 'error', text: 'Please select a valid image file or insert a valid image URL (http/https).' });
      return;
    }
    
    // Check all optional galleryImages
    const activeGalleryImages = (formData.galleryImages || []).filter(u => u.trim() !== '');
    for (const url of activeGalleryImages) {
      if (!isValidImageUrl(url)) {
        setStatusMsg({ type: 'error', text: 'One of your Gallery Image URLs is invalid. Choose a file or ensure it starts with http:// or https://' });
        return;
      }
    }

    if (formData.detail && formData.detail.length > 50000) {
      setStatusMsg({ type: 'error', text: 'Detail limit is 50,000 characters.' });
      return;
    }

    setSubmitLoading(true);
    setStatusMsg(null);

    const docRef = isEditing && editingId ? doc(db, 'projects', editingId) : doc(collection(db, 'projects'));
    const docId = docRef.id;
    const writePath = `projects/${docId}`;

    try {
      if (isEditing && editingId) {
        // Look up state of the current existing record
        const oldRecord = projects.find(p => p.id === editingId);
        if (!oldRecord) throw new Error('Existing project details not found to perform update.');

        const updatePayload = {
          id: docId,
          title: formData.name.trim(),
          name: formData.name.trim(),
          subtitle: formData.subtitle.trim(),
          category: formData.category.toLowerCase(),
          image: formData.imageUrl.trim(),
          imageUrl: formData.imageUrl.trim(),
          description: (formData.detail || '').trim(),
          detail: (formData.detail || '').trim(),
          location: formData.location.trim(),
          year: formData.year.trim(),
          aspectRatio: (oldRecord as any).aspectRatio || 'aspect-square',
          isFeatured: formData.isFeatured,
          showInCarousel: formData.showInCarousel,
          createdAt: oldRecord.createdAt,
          galleryImages: formData.galleryImages.filter(url => url.trim() !== '')
        };

        // Write to DB
        await setDoc(doc(db, 'projects', docId), updatePayload);
        setStatusMsg({ type: 'success', text: `Project "${formData.name}" successfully updated in cloud database.` });
      } else {
        // Document create payload
        const createPayload = {
          id: docId,
          title: formData.name.trim(),
          name: formData.name.trim(),
          subtitle: formData.subtitle.trim(),
          category: formData.category.toLowerCase(),
          image: formData.imageUrl.trim(),
          imageUrl: formData.imageUrl.trim(),
          description: (formData.detail || '').trim(),
          detail: (formData.detail || '').trim(),
          location: formData.location.trim(),
          year: formData.year.trim(),
          aspectRatio: 'aspect-square',
          isFeatured: formData.isFeatured,
          showInCarousel: formData.showInCarousel,
          createdAt: Date.now(),
          galleryImages: formData.galleryImages.filter(url => url.trim() !== '')
        };

        await setDoc(doc(db, 'projects', docId), createPayload);
        setStatusMsg({ type: 'success', text: `New Project "${formData.name}" successfully created and saved.` });
      }

      resetForm();
      onRefresh();
    } catch (error: any) {
      console.error("Operation failed", error);
      setStatusMsg({ 
        type: 'error', 
        text: `Write permission rejected: Your Google account email must be verified, and ownership criteria matched. Error details can be inspected in logs.` 
      });
      // Fire compliant standard exception
      handleFirestoreError(error, isEditing ? OperationType.UPDATE : OperationType.CREATE, writePath);
    } finally {
      setSubmitLoading(false);
    }
  };

  // Edit Action - Pulls database item back into form
  const handleEditClick = (project: Project) => {
    setFormData({
      name: project.title || '',
      subtitle: project.subtitle || '',
      category: (project.category as CategoryType) || 'Residential',
      imageUrl: extractUrlFromHtml(project.image) || '',
      detail: project.description || (project as any).detail || '',
      location: project.location || '',
      year: project.year || '',
      galleryImages: project.galleryImages || (project as any).moreImages || [],
      isFeatured: project.isFeatured ?? false,
      showInCarousel: project.showInCarousel ?? false
    });
    setEditingId(project.id);
    setIsEditing(true);
    setStatusMsg(null);
    document.getElementById('admin-form-container')?.scrollIntoView({ behavior: 'smooth' });
  };

  const addMoreImageField = () => {
    setFormData(prev => ({
      ...prev,
      galleryImages: [...(prev.galleryImages || []), '']
    }));
  };

  const handleMoreImageChange = (index: number, value: string) => {
    setFormData(prev => {
      const updated = [...(prev.galleryImages || [])];
      updated[index] = value;
      return { ...prev, galleryImages: updated };
    });
  };

  const removeMoreImageField = (index: number) => {
    setFormData(prev => {
      const updated = [...(prev.galleryImages || [])];
      updated.splice(index, 1);
      return { ...prev, galleryImages: updated };
    });
  };

  const setGalleryImageAsMain = (index: number) => {
    const prevMain = formData.imageUrl;
    const selectedGalleryImg = formData.galleryImages[index];
    if (!selectedGalleryImg) return;
    
    setFormData(prev => {
      const updatedGallery = [...(prev.galleryImages || [])];
      if (prevMain) {
        updatedGallery[index] = prevMain;
      } else {
        updatedGallery.splice(index, 1);
      }
      return {
        ...prev,
        imageUrl: selectedGalleryImg,
        galleryImages: updatedGallery
      };
    });
    
    setStatusMsg({ type: 'success', text: 'Gallery image promoted to primary display image successfully.' });
  };

  // Delete Action - Prompts secure deletion on Firestore
  const handleDeleteClick = (projectId: string, name: string) => {
    if (!user) return;
    
    setConfirmModalText({
      title: 'Permanently Delete Project',
      description: `Are you sure you want to permanently delete the project "${name}"? This action is irreversible and the record will be removed from Firestore immediately.`,
      isDelete: true
    });
    
    setPendingConfirmAction(() => async () => {
      const deletePath = `projects/${projectId}`;
      try {
        await deleteDoc(doc(db, 'projects', projectId));
        setStatusMsg({ type: 'success', text: `Successfully deleted project "${name}" from the database.` });
        setShowConfirmModal(false);
        onRefresh();
      } catch (error: any) {
        console.error("Delete failed", error);
        setStatusMsg({ type: 'error', text: 'Error: Unauthorized deletion or permission mismatch.' });
        handleFirestoreError(error, OperationType.DELETE, deletePath);
        setShowConfirmModal(false);
      }
    });

    setShowConfirmModal(true);
  };

  // Render Login state if not logged in
  if (!user) {
    return (
      <div className="max-w-md mx-auto text-center py-16 px-6 bg-zinc-900 border border-zinc-800 rounded-3xl shadow-2xl space-y-6" id="admin-login-panel">
        <div className="w-16 h-16 bg-zinc-950 flex items-center justify-center rounded-2xl mx-auto border border-zinc-800 text-amber-500 shadow-sm animate-pulse">
          <Shield className="w-8 h-8" />
        </div>
        <div className="space-y-2">
          <h2 className="font-serif italic text-2xl text-white tracking-tight">Admin Control Panel</h2>
          <p className="font-sans text-xs text-zinc-400 leading-relaxed">
            Please log in with your Google account to access your contractor project dashboard, where you can safely create, publish, and update spatial transformations and design portfolios.
          </p>
        </div>

        {authError && (
          <div className="p-3 bg-rose-950/25 border border-rose-500/30 rounded-xl flex items-start gap-2 text-left">
            <AlertTriangle className="w-4.5 h-4.5 text-rose-400 shrink-0 mt-0.5" />
            <span className="font-sans text-[11px] font-medium text-rose-200 leading-tight">{authError}</span>
          </div>
        )}

        <button
          id="google-signin-btn"
          onClick={handleGoogleSignIn}
          disabled={authLoading}
          className="w-full flex items-center justify-center gap-3 bg-amber-600 hover:bg-amber-700 text-white font-sans font-semibold text-xs py-3.5 px-4 rounded-xl border border-amber-650 shadow-md hover:shadow-xl transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {authLoading ? (
            <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></span>
          ) : (
            <svg className="w-4 h-4 shrink-0" fill="currentColor" viewBox="0 0 24 24">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#FFFFFF"/>
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#FAFAFA" opacity="0.85"/>
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" fill="#FAFAFA" opacity="0.85"/>
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" fill="#FAFAFA" opacity="0.85"/>
            </svg>
          )}
          Continue with Google Auth
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-10" id="admin-workspace">
      <motion.div 
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: "easeOut" }}
        className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between bg-zinc-900 border border-zinc-800 p-5 rounded-2xl shadow-xl"
      >
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-zinc-950 border border-zinc-800 rounded-xl flex items-center justify-center overflow-hidden shrink-0">
            <Shield className="w-5 h-5 text-amber-500" />
          </div>
          <div>
            <h3 className="font-sans font-bold text-sm text-white flex items-center gap-2 leading-tight">
              {user.displayName || 'Authorized Admin'}
              <span className="text-[10px] bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded-md py-0.5 px-2 font-mono">
                Active Session
              </span>
            </h3>
            <p className="font-mono text-[10px] text-zinc-550 text-zinc-500 mt-0.5">{user.email}</p>
          </div>
        </div>

        <button
          id="admin-logout-btn"
          onClick={handleSignOut}
          className="inline-flex items-center justify-center gap-1.5 font-sans font-medium text-xs text-zinc-400 hover:text-white border border-zinc-800 hover:border-zinc-700 px-4 py-2 rounded-xl transition-all hover:bg-zinc-850 cursor-pointer shrink-0"
        >
          Sign Out
          <LogOut className="w-4 h-4" />
        </button>
      </motion.div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Left Side: Create / Edit Form panel */}
        <motion.div 
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.5, delay: 0.1 }}
          className="lg:col-span-7 space-y-6" 
          id="admin-form-container"
        >
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl shadow-xl p-6 sm:p-8 space-y-6">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-4">
              <div className="space-y-0.5">
                <h2 className="font-serif italic text-lg text-white tracking-tight flex items-center gap-2">
                  <Shield className="w-4.5 h-4.5 text-amber-500" />
                  {isEditing ? 'Modify Refurbishment Record' : 'Record New Project'}
                </h2>
                <p className="font-sans text-[11px] text-zinc-500">
                  {isEditing ? 'Revise details and materials of an existing interior design fit-out' : 'Complete fields below to publish a space transformation to the live portfolio database'}
                </p>
              </div>
              {isEditing && (
                <button
                  type="button"
                  onClick={handleCancelEditClick}
                  className="font-sans font-semibold text-xs text-rose-400 hover:text-rose-300 border border-rose-950 hover:border-rose-900 bg-rose-950/25 px-3 py-1 rounded-lg cursor-pointer transition-colors"
                >
                  Cancel Edit
                </button>
              )}
            </div>

            {/* Notification message banner */}
            <AnimatePresence mode="wait">
              {statusMsg && (
                <motion.div
                  initial={{ opacity: 0, y: -12, height: 0 }}
                  animate={{ opacity: 1, y: 0, height: 'auto' }}
                  exit={{ opacity: 0, y: -12, height: 0 }}
                  transition={{ duration: 0.3, ease: 'easeOut' }}
                  className="overflow-hidden"
                >
                  <div className={`p-4 rounded-xl flex items-start justify-between gap-2.5 font-sans text-xs border mb-2 ${
                    statusMsg.type === 'success' 
                      ? 'bg-emerald-950/20 text-emerald-400 border-emerald-500/20' 
                      : 'bg-rose-950/25 text-rose-450 text-rose-400 border-rose-500/25'
                  }`}>
                    <div className="flex items-start gap-2.5">
                      {statusMsg.type === 'success' ? (
                        <CheckCircle2 className="w-4.5 h-4.5 text-emerald-400 shrink-0 mt-0.5 animate-pulse" />
                      ) : (
                        <AlertTriangle className="w-4.5 h-4.5 text-rose-400 shrink-0 mt-0.5 animate-bounce" />
                      )}
                      <span className="font-semibold leading-normal">{statusMsg.text}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setStatusMsg(null)}
                      className="p-1 rounded-md text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-all cursor-pointer"
                      title="Dismiss notification"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Project Entry Form */}
            <form id="project-admin-form" onSubmit={handleSubmit} className="space-y-5">
              <div className="space-y-1.5">
                <label className="block text-xs font-semibold text-zinc-400 font-sans" htmlFor="proj-name">
                  Project Title *
                </label>
                <input
                  id="proj-name"
                  type="text"
                  required
                  placeholder="e.g. Mid-Century Modern Living Room Renovation"
                  maxLength={200}
                  className="w-full px-4 py-2.5 bg-zinc-950 border border-zinc-800 rounded-xl text-xs font-sans text-zinc-100 placeholder-zinc-600 focus:outline-hidden focus:ring-1.5 focus:ring-amber-500/50 focus:border-zinc-700 transition-all"
                  value={formData.name || ''}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                />
              </div>

              <div className="space-y-1.5">
                <label className="block text-xs font-semibold text-zinc-400 font-sans" htmlFor="proj-subtitle">
                  Subtitle / Brief Pitch *
                </label>
                <input
                  id="proj-subtitle"
                  type="text"
                  required
                  placeholder="e.g. Full-scale remodel focusing on custom timber woodwork, open layout, and warm ambient lighting"
                  maxLength={500}
                  className="w-full px-4 py-2.5 bg-zinc-950 border border-zinc-800 rounded-xl text-xs font-sans text-zinc-100 placeholder-zinc-600 focus:outline-hidden focus:ring-1.5 focus:ring-amber-500/50 focus:border-zinc-700 transition-all"
                  value={formData.subtitle || ''}
                  onChange={(e) => setFormData({ ...formData, subtitle: e.target.value })}
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="block text-xs font-semibold text-zinc-400 font-sans" htmlFor="proj-category">
                    Category *
                  </label>
                  <select
                    id="proj-category"
                    className="w-full px-4 py-2.5 bg-zinc-950 border border-zinc-800 rounded-xl text-xs font-sans text-zinc-300 focus:outline-hidden focus:ring-1.5 focus:ring-amber-500/50 focus:border-zinc-700 transition-all cursor-pointer"
                    value={formData.category || 'Residential'}
                    onChange={(e) => setFormData({ ...formData, category: e.target.value as CategoryType })}
                  >
                    {CATEGORIES.map((cat) => (
                      <option key={cat} value={cat} className="bg-zinc-950 text-zinc-200">
                        {cat}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label className="block text-xs font-semibold text-zinc-400 font-sans" htmlFor="proj-image">
                    Display Image for Main Web (Primary) *
                  </label>
                  <div className="flex gap-2 items-center">
                    <div className="relative flex-1">
                      <input
                        id="proj-image"
                        type="text"
                        required
                        placeholder="https://... or choose a local file"
                        maxLength={200000}
                        className="w-full pl-4 pr-10 py-2.5 bg-zinc-950 border border-zinc-800 rounded-xl text-xs font-sans text-zinc-100 placeholder-zinc-600 focus:outline-hidden focus:ring-1.5 focus:ring-amber-500/50 focus:border-zinc-700 transition-all text-ellipsis"
                        value={((formData.imageUrl || '').startsWith('data:image/')) ? '[Uploaded Local Image file]' : (formData.imageUrl || '')}
                        onChange={(e) => {
                          const val = e.target.value;
                          setFormData({ ...formData, imageUrl: val === '[Uploaded Local Image file]' ? (formData.imageUrl || '') : val });
                        }}
                        disabled={!!(formData.imageUrl && formData.imageUrl.startsWith('data:image/'))}
                      />
                      {(formData.imageUrl && formData.imageUrl.startsWith('data:image/')) ? (
                        <button
                          type="button"
                          onClick={() => setFormData({ ...formData, imageUrl: '' })}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-rose-500 hover:text-rose-450 text-[10px] uppercase tracking-wider font-semibold font-sans cursor-pointer transition-colors bg-zinc-950 px-2"
                        >
                          Clear
                        </button>
                      ) : (
                        <ImageIcon className="absolute right-3.5 top-1/2 -translate-y-1/2 text-zinc-500 w-4 h-4" />
                      )}
                    </div>
                    {/* Native file chooser */}
                    <label className="flex items-center gap-1.5 px-3 py-2.5 bg-zinc-900 hover:bg-zinc-850 hover:text-white text-zinc-300 border border-zinc-800 hover:border-zinc-700 text-xs font-semibold rounded-xl cursor-pointer transition-all shrink-0">
                      <Upload className="w-4 h-4 text-amber-500" />
                      <span>Choose File</span>
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) {
                            handleImageFileUpload(
                              file,
                              (base64) => setFormData({ ...formData, imageUrl: base64 }),
                              (err) => setStatusMsg({ type: 'error', text: err })
                            );
                          }
                        }}
                      />
                    </label>
                  </div>
                  {formData.imageUrl && (
                    <div className="flex gap-2 items-center p-2 bg-zinc-950 border border-zinc-900 rounded-xl mt-1.5">
                      <div className="w-12 h-9 bg-zinc-900 rounded-md overflow-hidden border border-zinc-800 shrink-0">
                        <img 
                          src={extractUrlFromHtml(formData.imageUrl)} 
                          alt="Primary Thumbnail View" 
                          referrerPolicy="no-referrer"
                          onError={(e) => (e.currentTarget.src = 'https://via.placeholder.com/150')}
                          className="w-full h-full object-cover"
                        />
                      </div>
                      <span className="text-[10px] text-zinc-550 text-zinc-500 font-mono truncate max-w-[240px]">
                        {formData.imageUrl && formData.imageUrl.startsWith('data:image/') 
                          ? `Local Document Image (~${Math.round(formData.imageUrl.length/1024)} KB)` 
                          : 'External URL Resource Asset'}
                      </span>
                    </div>
                  )}
                </div>
              </div>

              {/* Additional Gallery Images Section */}
              <div className="space-y-3 p-4 bg-zinc-950/40 border border-zinc-800 rounded-2xl">
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <label className="block text-xs font-semibold text-zinc-400 font-sans">
                      Project Gallery (Extra Images Stream)
                    </label>
                    <span className="block text-[10px] text-zinc-500 font-sans">
                      Add extra images for this project's photo stream. Supports direct image file upload or URLs.
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={addMoreImageField}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold text-amber-500 hover:text-white border border-zinc-800 hover:border-amber-600 hover:bg-amber-650 bg-zinc-950 rounded-lg cursor-pointer transition-all shrink-0"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Add Image Slot
                  </button>
                </div>

                {formData.galleryImages && formData.galleryImages.length > 0 ? (
                  <div className="space-y-3 max-h-72 overflow-y-auto pr-1">
                    {formData.galleryImages.map((imgUrl, index) => (
                      <div key={index} className="p-3 bg-zinc-950/60 border border-zinc-900 rounded-xl space-y-2">
                        {/* Clear tag/label marking Project Gallery under that field */}
                        <div className="flex items-center justify-between pb-1 select-none">
                          <span className="text-[10px] font-mono text-zinc-400 font-semibold uppercase tracking-wider">
                            Gallery Slot #{index + 1}
                          </span>
                          <span className="inline-flex items-center gap-1 text-[8px] font-mono px-2 py-0.5 rounded bg-amber-500/10 text-amber-550 text-amber-500 border border-amber-500/20 uppercase font-bold tracking-wider">
                            <span className="w-1 h-1 rounded-full bg-amber-500 animate-pulse"></span>
                            Project Gallery Image
                          </span>
                        </div>

                        <div className="flex gap-2 items-center">
                          <div className="relative flex-1">
                            <input
                              type="text"
                              placeholder="https://... or choose a local file"
                              maxLength={200000}
                              className="w-full pl-4 pr-10 py-2 bg-zinc-950 border border-zinc-800 rounded-xl text-xs font-sans text-zinc-100 placeholder-zinc-600 focus:outline-hidden focus:ring-1.5 focus:ring-amber-500/50 focus:border-zinc-700 transition-all text-ellipsis"
                              value={((imgUrl || '').startsWith('data:image/')) ? '[Uploaded Local Image file]' : (imgUrl || '')}
                              onChange={(e) => {
                                const val = e.target.value;
                                handleMoreImageChange(index, val === '[Uploaded Local Image file]' ? (imgUrl || '') : val);
                              }}
                              disabled={!!(imgUrl && imgUrl.startsWith('data:image/'))}
                            />
                            {(imgUrl && imgUrl.startsWith('data:image/')) ? (
                              <button
                                type="button"
                                onClick={() => handleMoreImageChange(index, '')}
                                className="absolute right-3 top-1/2 -translate-y-1/2 text-rose-500 hover:text-rose-450 text-[10px] uppercase tracking-wider font-semibold font-sans cursor-pointer transition-colors bg-zinc-950 px-2"
                              >
                                Clear
                              </button>
                            ) : (
                              <ImageIcon className="absolute right-3.5 top-1/2 -translate-y-1/2 text-zinc-500 w-3.5 h-3.5" />
                            )}
                          </div>
                          
                          {/* Choose File for Gallery Slot */}
                          <label className="flex items-center gap-1.5 px-3 py-2 bg-zinc-900 hover:bg-zinc-850 hover:text-white text-zinc-300 border border-zinc-800 hover:border-zinc-700 text-xs font-semibold rounded-xl cursor-pointer transition-all shrink-0">
                            <Upload className="w-3.5 h-3.5 text-amber-500" />
                            <span>File</span>
                            <input
                              type="file"
                              accept="image/*"
                              className="hidden"
                              onChange={(e) => {
                                const file = e.target.files?.[0];
                                if (file) {
                                  handleImageFileUpload(
                                    file,
                                    (base64) => handleMoreImageChange(index, base64),
                                    (err) => setStatusMsg({ type: 'error', text: err })
                                  );
                                }
                              }}
                            />
                          </label>

                          <button
                            type="button"
                            onClick={() => removeMoreImageField(index)}
                            className="p-2 text-zinc-400 hover:text-rose-450 hover:bg-rose-950/20 border border-zinc-800 hover:border-rose-950 rounded-xl cursor-pointer transition-all"
                            title="Remove Slot"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                        
                        {imgUrl && (
                          <div className="flex gap-2 items-center pl-2 pt-0.5 justify-between">
                            <div className="flex items-center gap-2">
                              <div className="w-10 h-7 bg-zinc-900 rounded-md overflow-hidden border border-zinc-800 shrink-0">
                                <img 
                                  src={extractUrlFromHtml(imgUrl)} 
                                  alt="Gallery Thumbnail View" 
                                  referrerPolicy="no-referrer"
                                  onError={(e) => (e.currentTarget.src = 'https://via.placeholder.com/150')}
                                  className="w-full h-full object-cover"
                                />
                              </div>
                              <span className="text-[9px] text-zinc-500 font-mono truncate max-w-[140px] sm:max-w-[200px]">
                                {imgUrl && imgUrl.startsWith('data:image/') 
                                  ? `Gallery Photo Payload (~${Math.round(imgUrl.length/1024)} KB)` 
                                  : 'External Resource Link'}
                              </span>
                            </div>

                            <button
                              type="button"
                              onClick={() => setGalleryImageAsMain(index)}
                              className="inline-flex items-center gap-1 px-2.5 py-1 text-[10px] font-semibold text-amber-500 hover:text-white border border-amber-500/30 hover:border-amber-500 bg-amber-500/5 hover:bg-amber-600 rounded-md cursor-pointer transition-all shrink-0"
                              title="Promote to Primary Display Image"
                            >
                              <Eye className="w-3 h-3" />
                              Swap with Main Display
                            </button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-4 border border-dashed border-zinc-800 rounded-xl">
                    <p className="font-sans text-[10px] text-zinc-500">No extra images. One display image only.</p>
                  </div>
                )}
              </div>

              {/* Location and Year Fields with Quick-Select Buttons */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="block text-xs font-semibold text-zinc-400 font-sans" htmlFor="proj-location">
                    Project Location / Region *
                  </label>
                  <input
                    id="proj-location"
                    type="text"
                    required
                    placeholder="e.g. London, UK"
                    maxLength={150}
                    className="w-full px-4 py-2.5 bg-zinc-950 border border-zinc-800 rounded-xl text-xs font-sans text-zinc-100 placeholder-zinc-600 focus:outline-hidden focus:ring-1.5 focus:ring-amber-500/50 focus:border-zinc-700 transition-all"
                    value={formData.location || ''}
                    onChange={(e) => setFormData({ ...formData, location: e.target.value })}
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="block text-xs font-semibold text-zinc-400 font-sans" htmlFor="proj-year">
                    Completion Year *
                  </label>
                  <input
                    id="proj-year"
                    type="text"
                    required
                    placeholder="e.g. 2026"
                    maxLength={20}
                    className="w-full px-4 py-2.5 bg-zinc-950 border border-zinc-800 rounded-xl text-xs font-sans text-zinc-100 placeholder-zinc-600 focus:outline-hidden focus:ring-1.5 focus:ring-amber-500/50 focus:border-zinc-700 transition-all"
                    value={formData.year || ''}
                    onChange={(e) => setFormData({ ...formData, year: e.target.value })}
                  />

                </div>
              </div>

              {/* Toggles for Featured and Carousel */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="p-4 bg-zinc-950/40 border border-zinc-800 rounded-xl flex items-center justify-between gap-4">
                  <div className="space-y-0.5">
                    <label className="block text-xs font-semibold text-zinc-300 font-sans">
                      Featured Project Showcase
                    </label>
                    <p className="text-[10px] text-zinc-500 font-sans leading-tight">
                      Highlight this project in the main gallery and layouts.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setFormData(p => ({ ...p, isFeatured: !p.isFeatured }))}
                    className={`relative inline-flex h-5.5 w-10 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-hidden focus:ring-1.5 focus:ring-amber-500/50 ${
                      formData.isFeatured ? 'bg-amber-600' : 'bg-zinc-800'
                    }`}
                    aria-label="Toggle Featured Project"
                  >
                    <span
                      className={`pointer-events-none inline-block h-4.5 w-4.5 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out ${
                        formData.isFeatured ? 'translate-x-[18px]' : 'translate-x-0'
                      }`}
                    />
                  </button>
                </div>

                <div className="p-4 bg-zinc-950/40 border border-zinc-800 rounded-xl flex items-center justify-between gap-4">
                  <div className="space-y-0.5">
                    <label className="block text-xs font-semibold text-zinc-300 font-sans">
                      Display in Carousel
                    </label>
                    <p className="text-[10px] text-zinc-500 font-sans leading-tight">
                      Add this project to the main homepage hero carousel.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setFormData(p => ({ ...p, showInCarousel: !p.showInCarousel }))}
                    className={`relative inline-flex h-5.5 w-10 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-hidden focus:ring-1.5 focus:ring-amber-500/50 ${
                      formData.showInCarousel ? 'bg-amber-600' : 'bg-zinc-800'
                    }`}
                    aria-label="Toggle Carousel Project"
                  >
                    <span
                      className={`pointer-events-none inline-block h-4.5 w-4.5 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out ${
                        formData.showInCarousel ? 'translate-x-[18px]' : 'translate-x-0'
                      }`}
                    />
                  </button>
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="block text-xs font-semibold text-zinc-400 font-sans" htmlFor="proj-description">
                  Detailed Explanation & Markdown Description (Optional)
                </label>
                <textarea
                  id="proj-detail"
                  rows={8}
                  maxLength={50000}
                  placeholder="Provide precise details of the spatial transformation, material specifications (e.g. White Oak cabinetry, Calacatta marble, brushed brass), and construction scope..."
                  className="w-full px-4 py-3 bg-zinc-950 border border-zinc-800 rounded-xl text-xs font-sans text-zinc-100 placeholder-zinc-600 focus:outline-hidden focus:ring-1.5 focus:ring-amber-500/50 focus:border-zinc-700 transition-all"
                  value={formData.detail || ''}
                  onChange={(e) => setFormData({ ...formData, detail: e.target.value })}
                />
              </div>

              {/* Trigger Button with status */}
              <div className="flex flex-col sm:flex-row gap-3">
                <button
                  id="submit-project-btn"
                  type="submit"
                  disabled={submitLoading}
                  className="flex-1 flex items-center justify-center gap-2 bg-amber-600 hover:bg-amber-750 text-white font-sans font-semibold text-xs py-3.5 px-4 rounded-xl shadow-lg border border-amber-650 cursor-pointer transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {submitLoading ? (
                    <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></span>
                  ) : (
                    <>
                      <Save className="w-4 h-4" />
                      {isEditing ? 'Save Revisions to Firestore' : 'Publish Project to Database'}
                    </>
                  )}
                </button>
                
                {!isEditing && isFormDirty() && (
                  <button
                    type="button"
                    onClick={handleClearFormClick}
                    className="flex items-center justify-center gap-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-sans font-semibold text-xs py-3.5 px-6 rounded-xl border border-zinc-700 cursor-pointer transition-all"
                  >
                    <RefreshCcw className="w-3.5 h-3.5" />
                    Clear Form
                  </button>
                )}
              </div>
            </form>
          </div>
        </motion.div>

        {/* Right Side: Active Admin's Portfolio lists */}
        <motion.div 
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.5, delay: 0.2 }}
          className="lg:col-span-5 space-y-6" 
          id="admin-list-container"
        >
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl shadow-xl py-6 px-5 space-y-4">
            <h3 className="font-sans font-bold text-sm text-zinc-300 flex items-center justify-between border-b border-zinc-800/80 pb-3">
              <span>Your Registered Projects ({userProjects.length})</span>
              <button
                id="refresh-btn"
                onClick={onRefresh}
                className="text-zinc-500 hover:text-white transition-colors p-1.5 rounded-full hover:bg-zinc-800 cursor-pointer"
                title="Refresh from DB"
              >
                <RefreshCcw className="w-4 h-4" />
              </button>
            </h3>

            {/* Quick Location and Year Filters Buttons */}
            {userProjects.length > 0 && (
              <div className="p-3 bg-zinc-950/60 border border-zinc-850 rounded-xl space-y-3">
                {/* Location Filter Row Buttons */}
                <div className="space-y-1.5">
                  <span className="block text-[9px] font-mono font-bold text-zinc-500 uppercase tracking-wider">
                    Quick Filter Location Button
                  </span>
                  <div className="flex flex-wrap gap-1">
                    <button
                      type="button"
                      onClick={() => setSelectedLocFilter('All')}
                      className={`px-2 py-0.5 text-[9px] font-sans font-semibold rounded-md transition-all cursor-pointer ${
                        selectedLocFilter === 'All'
                          ? 'bg-amber-600 text-white'
                          : 'bg-zinc-900 text-zinc-400 hover:bg-zinc-805 hover:text-zinc-200 border border-zinc-800'
                      }`}
                    >
                      All Locations
                    </button>
                    {uniqueLocations.map(loc => (
                      <button
                        type="button"
                        key={loc}
                        onClick={() => setSelectedLocFilter(loc)}
                        className={`px-2 py-0.5 text-[9px] font-sans font-semibold rounded-md transition-all cursor-pointer ${
                          selectedLocFilter === loc
                            ? 'bg-amber-600 text-white'
                            : 'bg-zinc-900 text-zinc-400 hover:bg-zinc-805 hover:text-zinc-200 border border-zinc-800'
                        }`}
                      >
                        📍 {loc.split(',')[0]}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Year Filter Row Buttons */}
                <div className="space-y-1.5">
                  <span className="block text-[9px] font-mono font-bold text-zinc-500 uppercase tracking-wider">
                    Quick Filter Year Button
                  </span>
                  <div className="flex flex-wrap gap-1">
                    <button
                      type="button"
                      onClick={() => setSelectedYearFilter('All')}
                      className={`px-2 py-0.5 text-[9px] font-sans font-semibold rounded-md transition-all cursor-pointer ${
                        selectedYearFilter === 'All'
                          ? 'bg-amber-600 text-white'
                          : 'bg-zinc-900 text-zinc-400 hover:bg-zinc-805 hover:text-zinc-200 border border-zinc-800'
                      }`}
                    >
                      All Years
                    </button>
                    {uniqueYears.map(yr => (
                      <button
                        type="button"
                        key={yr}
                        onClick={() => setSelectedYearFilter(yr)}
                        className={`px-2 py-0.5 text-[9px] font-sans font-semibold rounded-md transition-all cursor-pointer ${
                          selectedYearFilter === yr
                            ? 'bg-amber-600 text-white'
                            : 'bg-zinc-900 text-zinc-400 hover:bg-zinc-805 hover:text-zinc-200 border border-zinc-800'
                        }`}
                      >
                        🗓️ {yr}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {loading ? (
              <div className="flex flex-col items-center justify-center py-10 space-y-2">
                <div className="w-8 h-8 border-3 border-zinc-800 border-t-amber-500 rounded-full animate-spin"></div>
                <span className="text-[11px] text-zinc-550 text-zinc-500 font-sans">Connecting...</span>
              </div>
            ) : filteredProjects.length === 0 ? (
              <div className="text-center py-12 border border-dashed border-zinc-800 rounded-xl bg-zinc-950/35">
                <HelpCircle className="mx-auto w-8 h-8 text-zinc-600 mb-2" />
                <p className="font-sans text-xs font-semibold text-zinc-400">No matching projects found</p>
                <p className="font-sans text-[10px] text-zinc-500 mt-1">Try resetting your active Location and Year filters above.</p>
              </div>
            ) : (
              <motion.div 
                initial="hidden"
                animate="visible"
                variants={{
                  visible: {
                    transition: {
                      staggerChildren: 0.05
                    }
                  }
                }}
                className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-2 gap-5 max-h-[800px] overflow-y-auto pr-1"
              >
                {filteredProjects.map((project, idx) => (
                  <motion.div
                    key={project.id}
                    variants={{
                      hidden: { opacity: 0, y: 10 },
                      visible: { opacity: 1, y: 0 }
                    }}
                    id={`admin-item-${project.id}`}
                    className="group flex flex-col bg-zinc-950/40 border border-zinc-800/80 rounded-xl hover:bg-zinc-950 hover:border-zinc-700 hover:shadow-lg transition-all relative overflow-hidden"
                  >
                    {/* Thumbnail preview on top */}
                    <div className="w-full h-48 bg-zinc-950 overflow-hidden border-b border-zinc-800 shrink-0 relative">
                      {project.image ? (
                        <img 
                          src={extractUrlFromHtml(project.image)} 
                          alt={project.title} 
                          referrerPolicy="no-referrer"
                          onError={(e) => (e.currentTarget.src = 'https://via.placeholder.com/400x300')} 
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" 
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center bg-zinc-900">
                          <ImageIcon className="w-8 h-8 text-zinc-700" />
                        </div>
                      )}
                      
                      {/* Badge Overlays */}
                      <div className="absolute top-2 left-2 flex flex-col gap-1">
                        {project.isFeatured && (
                          <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 bg-amber-500 text-black text-[8px] font-bold rounded uppercase tracking-wider shadow-lg">
                            ★ Featured
                          </span>
                        )}
                        {project.showInCarousel && (
                          <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 bg-zinc-100 text-zinc-900 text-[8px] font-bold rounded uppercase tracking-wider shadow-lg">
                            <LayoutTemplate className="w-2 h-2" />
                            Hero
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="p-3 flex-1 flex flex-col">
                      <h4 className="font-sans font-bold text-xs text-white truncate line-clamp-1">
                        {project.title}
                      </h4>
                      <p className="font-sans text-[10px] text-zinc-450 text-zinc-500 truncate mt-0.5 mb-2">
                        {project.subtitle}
                      </p>
                      
                      <div className="mt-auto flex flex-wrap items-center gap-1">
                        <span className="inline-block font-mono text-[8px] font-semibold text-zinc-400 bg-zinc-800/50 border-zinc-750 border border-zinc-800 rounded px-1 py-0.5">
                          {project.category}
                        </span>
                        {project.year && (
                          <span className="inline-block font-mono text-[8px] text-zinc-500 bg-zinc-900 border border-zinc-800 rounded px-1 py-0.5">
                            {project.year}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Modification icons positioned at the bottom bar */}
                    <div className="px-3 py-2 bg-black/40 border-t border-zinc-900 flex items-center justify-between gap-1">
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => handleToggleCarousel(project.id, project.showInCarousel ?? false)}
                          className={`p-1.5 rounded-md transition-all cursor-pointer ${
                            project.showInCarousel 
                              ? 'text-amber-500 bg-amber-500/10 border border-amber-500/20 hover:text-amber-400' 
                              : 'text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800'
                          }`}
                          title={project.showInCarousel ? "Remove from Hero Carousel" : "Add to Hero Carousel"}
                        >
                          <LayoutTemplate className={`w-3.5 h-3.5 ${project.showInCarousel ? "fill-amber-500" : ""}`} />
                        </button>
                        <button
                          onClick={() => handleToggleFeatured(project.id, project.isFeatured ?? false)}
                          className={`p-1.5 rounded-md transition-all cursor-pointer ${
                            project.isFeatured 
                              ? 'text-amber-500 bg-amber-500/10 border border-amber-500/20 hover:text-amber-400' 
                              : 'text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800'
                          }`}
                          title={project.isFeatured ? "Remove from Featured Projects" : "Promote to Featured Projects"}
                        >
                          <Star className={`w-3.5 h-3.5 ${project.isFeatured ? "fill-amber-500" : ""}`} />
                        </button>
                      </div>

                      <div className="flex items-center gap-1">
                        <button
                          id={`preview-item-${project.id}`}
                          onClick={() => handleSetPreviewProject(project)}
                          className="p-1.5 text-zinc-400 hover:text-amber-400 hover:bg-zinc-800 rounded-md transition-all cursor-pointer"
                          title="Preview Project"
                        >
                          <Eye className="w-3.5 h-3.5" />
                        </button>
                        <button
                          id={`edit-item-${project.id}`}
                          onClick={() => handleEditClick(project)}
                          className="p-1.5 text-zinc-400 hover:text-white hover:bg-zinc-800 rounded-md transition-all cursor-pointer"
                          title="Edit Project"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          id={`delete-item-${project.id}`}
                          onClick={() => handleDeleteClick(project.id, project.title)}
                          className="p-1.5 text-zinc-400 hover:text-rose-400 hover:bg-rose-950/50 rounded-md transition-all cursor-pointer"
                          title="Delete Project"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  </motion.div>
                ))}
              </motion.div>
            )}
          </div>
        </motion.div>
      </div>

      {/* Stunning Detail Sheet Popup Overlay Modal */}
      <AnimatePresence>
        {previewProject && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 overflow-y-auto"
            onClick={() => handleSetPreviewProject(null)}
          >
            <motion.div
              initial={{ scale: 0.95, y: 15 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 15 }}
              className="w-full max-w-xl bg-zinc-900 border border-zinc-800 rounded-3xl overflow-hidden shadow-2xl text-left"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Media Image Banner */}
              <div className="w-full h-56 bg-zinc-950 relative overflow-hidden border-b border-zinc-800">
                <a href={extractUrlFromHtml(activePreviewImage || '')} target="_blank" rel="noreferrer">
                  <img
                    src={extractUrlFromHtml(activePreviewImage || 'https://via.placeholder.com/150')}
                    alt={previewProject.title}
                    referrerPolicy="no-referrer"
                    onError={(e) => (e.currentTarget.src = 'https://via.placeholder.com/150')}
                    className="w-full h-full object-cover"
                    border="0"
                  />
                </a>
                <button
                  onClick={() => handleSetPreviewProject(null)}
                  className="absolute top-4 right-4 bg-black/60 hover:bg-black/80 border border-zinc-800 text-zinc-300 hover:text-white w-8 h-8 rounded-full cursor-pointer flex items-center justify-center font-sans text-sm transition-colors"
                >
                  ✕
                </button>
              </div>

              {/* Interactive Thumbnail Gallery Strip */}
              {(((previewProject.galleryImages || (previewProject as any).moreImages) && (previewProject.galleryImages || (previewProject as any).moreImages).filter((u: string) => u.trim() !== '').length > 0) || previewProject.image) && (
                <div className="px-6 pt-4 flex gap-2.5 overflow-x-auto pb-3 border-b border-zinc-800/60 scrollbar-thin scrollbar-thumb-zinc-850 scrollbar-track-transparent">
                  {/* Primary Display image button icon */}
                  {previewProject.image && (
                    <button
                      onClick={() => setActivePreviewImage(extractUrlFromHtml(previewProject.image))}
                      className={`w-11 h-11 rounded-lg overflow-hidden border-2 shrink-0 transition-all cursor-pointer relative ${
                        extractUrlFromHtml(activePreviewImage) === extractUrlFromHtml(previewProject.image)
                          ? 'border-amber-500 scale-105 shadow-sm shadow-amber-500/20'
                          : 'border-zinc-800 hover:border-zinc-700'
                      }`}
                      title="Main Show Option"
                    >
                      <img 
                        src={extractUrlFromHtml(previewProject.image)} 
                        alt="Display Option" 
                        className="w-full h-full object-cover" 
                        referrerPolicy="no-referrer"
                      />
                    </button>
                  )}
                  {/* More images lists option */}
                  {(previewProject.galleryImages || (previewProject as any).moreImages)?.filter((u: string) => u.trim() !== '').map((imgUrl: string, idx: number) => (
                    <button
                      key={idx}
                      onClick={() => setActivePreviewImage(extractUrlFromHtml(imgUrl))}
                      className={`w-11 h-11 rounded-lg overflow-hidden border-2 shrink-0 transition-all cursor-pointer relative ${
                        extractUrlFromHtml(activePreviewImage) === extractUrlFromHtml(imgUrl)
                          ? 'border-amber-500 scale-105 shadow-sm shadow-amber-500/20'
                          : 'border-zinc-800 hover:border-zinc-700'
                      }`}
                      title={`[Project Gallery] Option ${idx + 1}`}
                    >
                      <img 
                        src={extractUrlFromHtml(imgUrl)} 
                        alt={`Additional Option ${idx + 1}`} 
                        className="w-full h-full object-cover" 
                        referrerPolicy="no-referrer"
                        onError={(e) => (e.currentTarget.src = 'https://via.placeholder.com/150')}
                      />
                      {/* Subtle gold indicator dot marking this thumbnail as a project gallery option */}
                      <span className="absolute top-1 right-1 w-1.5 h-1.5 bg-amber-500 rounded-full border border-zinc-900" title="Project Gallery Image"></span>
                    </button>
                  ))}
                </div>
              )}

              {/* Core Details */}
              <div className="p-6 space-y-4">
                <div className="space-y-2">
                  <div className="flex flex-wrap gap-1.5 items-center">
                    <span className="font-mono text-[9px] font-bold text-amber-500 uppercase tracking-widest bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/20">
                      {previewProject.category}
                    </span>
                    {previewProject.location && (
                      <span className="font-sans text-[10px] font-semibold text-zinc-300 bg-zinc-950 border border-zinc-800/80 rounded px-2 py-0.5" title="Location">
                        📍 {previewProject.location}
                      </span>
                    )}
                    {previewProject.year && (
                      <span className="font-sans text-[10px] font-semibold text-zinc-300 bg-zinc-950 border border-zinc-800/80 rounded px-2 py-0.5" title="Completion Year">
                        🗓️ {previewProject.year}
                      </span>
                    )}
                  </div>
                  <h3 className="font-serif italic text-xl text-white tracking-tight leading-snug">
                    {previewProject.title}
                  </h3>
                  <p className="font-sans text-xs text-zinc-400 leading-relaxed">
                    {previewProject.subtitle}
                  </p>
                </div>

                <div className="border-t border-zinc-800 pt-3.5 space-y-2">
                  <h4 className="font-sans text-[10px] uppercase font-bold text-zinc-500 tracking-wider">
                    Specifications & Material Register
                  </h4>
                  <div className="font-sans text-xs text-zinc-300 leading-relaxed bg-zinc-950 border border-zinc-800/60 p-4 rounded-xl min-h-[80px] max-h-[180px] overflow-y-auto whitespace-pre-wrap">
                    {previewProject.description}
                  </div>
                </div>

                <div className="border-t border-zinc-800 pt-3.5 flex items-center justify-end">
                  <button
                    onClick={() => handleSetPreviewProject(null)}
                    className="font-sans font-semibold text-xs text-zinc-400 hover:text-white border border-zinc-800 hover:border-zinc-700 bg-zinc-950 px-4 py-2 rounded-xl transition-all cursor-pointer"
                  >
                    Close Preview
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
      {/* Confirmation Modal Component */}
      <AnimatePresence>
        {showConfirmModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6" id="confirmation-modal-overlay">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowConfirmModal(false)}
              className="absolute inset-0 bg-zinc-950/80 backdrop-blur-sm cursor-pointer"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              className="relative w-full max-w-md bg-zinc-900 border border-zinc-800 rounded-2xl shadow-2xl overflow-hidden"
              id="confirmation-modal-content"
            >
              <div className="p-6 sm:p-8 space-y-4">
                <div className="flex items-center gap-3 text-amber-500">
                  <div className="w-10 h-10 bg-amber-500/10 rounded-xl flex items-center justify-center border border-amber-500/20">
                    <AlertTriangle className="w-5 h-5" />
                  </div>
                  <h3 className="font-serif italic text-xl text-white tracking-tight">
                    {confirmModalText.title}
                  </h3>
                </div>
                
                <p className="font-sans text-xs text-zinc-400 leading-relaxed">
                  {confirmModalText.description}
                </p>

                <div className="flex flex-col sm:flex-row gap-3 pt-2">
                  <button
                    onClick={() => {
                      if (pendingConfirmAction) pendingConfirmAction();
                    }}
                    className={`flex-1 text-white font-sans font-bold text-[11px] py-3 rounded-xl transition-all cursor-pointer shadow-lg active:scale-95 ${
                      confirmModalText.isDelete ? 'bg-rose-600 hover:bg-rose-700' : 'bg-amber-600 hover:bg-amber-700'
                    }`}
                  >
                    {confirmModalText.isDelete ? 'Confirm & Delete' : 'Confirm & Proceed'}
                  </button>
                  <button
                    onClick={() => setShowConfirmModal(false)}
                    className="flex-1 bg-zinc-800 hover:bg-zinc-705 text-zinc-300 font-sans font-bold text-[11px] py-3 rounded-xl border border-zinc-700 transition-all cursor-pointer active:scale-95"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
