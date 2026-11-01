import React, { useState, useEffect } from 'react';
import { RouteState, SimpleRouteName, SiteContent, Employee } from './types';
import { DEFAULTS, SAMPLE_EMPS } from './defaultData';
import {
  db,
  auth,
  onAuthStateChanged,
  testConnection,
  isAuthorizedAdmin,
  getStoredAdminSession,
  handleFirestoreError,
  OperationType
} from './firebase';
import { doc, onSnapshot, collection } from 'firebase/firestore';
import { User } from 'firebase/auth';

import { HeaderNav } from './components/HeaderNav';
import { HomeView } from './components/HomeView';
import { AboutView } from './components/AboutView';
import { TeamView } from './components/TeamView';
import { EmployeeView } from './components/EmployeeView';
import { ContactView } from './components/ContactView';
import { ApplyView } from './components/ApplyView';
import { AdminView } from './components/AdminView';
import { Footer } from './components/Footer';
import { Toast } from './components/Toast';

export default function App() {
  const [content, setContent] = useState<SiteContent>(DEFAULTS);
  const [employees, setEmployees] = useState<Employee[]>(SAMPLE_EMPS);
  const [media, setMedia] = useState<Record<string, string>>({});
  const [adminUser, setAdminUser] = useState<User | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Hash-based routing
  const parseHash = (): RouteState => {
    const hash = (window.location.hash || '#home').slice(1);
    const empMatch = /^e-([a-z0-9_-]+)-(about|contact)$/i.exec(hash);
    if (empMatch) {
      return {
        name: 'emp',
        id: empMatch[1],
        tab: empMatch[2] as 'about' | 'contact'
      };
    }
    const valid: SimpleRouteName[] = ['home', 'about', 'team', 'contact', 'apply', 'admin'];
    if (valid.includes(hash as SimpleRouteName)) {
      return { name: hash as SimpleRouteName };
    }
    return { name: 'home' };
  };

  const [currentRoute, setCurrentRoute] = useState<RouteState>(parseHash());

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage((prev: string | null) => (prev === msg ? null : prev));
    }, 2800);
  };

  // 1. Initial connection test
  useEffect(() => {
    testConnection().then(ok => {
      if (ok) {
        console.log('Firebase Firestore connection verified.');
      }
    });
  }, []);

  // 2. Auth State Listener with dual session support (Direct In-App key & Google Auth)
  useEffect(() => {
    const syncAdminState = () => {
      const stored = getStoredAdminSession();
      if (stored) {
        setAdminUser({
          email: stored.email,
          displayName: stored.displayName,
          uid: stored.uid
        } as any);
        return;
      }
      if (auth.currentUser && isAuthorizedAdmin(auth.currentUser.email)) {
        setAdminUser(auth.currentUser);
        return;
      }
      setAdminUser(null);
    };

    syncAdminState();
    const unsub = onAuthStateChanged(auth, () => {
      syncAdminState();
    });
    window.addEventListener('meadow_auth_change', syncAdminState);
    return () => {
      unsub();
      window.removeEventListener('meadow_auth_change', syncAdminState);
    };
  }, []);

  // 3. Real-time Firestore sync: site content
  useEffect(() => {
    const unsub = onSnapshot(
      doc(db, 'site', 'content'),
      snapshot => {
        if (snapshot.exists()) {
          const data = snapshot.data() as Partial<SiteContent>;
          setContent({
            site: { ...DEFAULTS.site, ...(data.site || {}) },
            home: { ...DEFAULTS.home, ...(data.home || {}) },
            about: { ...DEFAULTS.about, ...(data.about || {}) },
            team: { ...DEFAULTS.team, ...(data.team || {}) },
            contact: { ...DEFAULTS.contact, ...(data.contact || {}) },
            apply: { ...DEFAULTS.apply, ...(data.apply || {}) },
            updatedAt: data.updatedAt
          });
        }
      },
      error => {
        handleFirestoreError(error, OperationType.GET, 'site/content');
      }
    );
    return () => unsub();
  }, []);

  // 4. Real-time Firestore sync: employees
  useEffect(() => {
    const unsub = onSnapshot(
      collection(db, 'employees'),
      snapshot => {
        if (!snapshot.empty) {
          const emps = snapshot.docs.map(d => ({
            ...(d.data() as Employee),
            id: d.id
          }));
          emps.sort((a, b) => (a.order || 0) - (b.order || 0));
          setEmployees(emps);
        } else {
          setEmployees(SAMPLE_EMPS);
        }
      },
      error => {
        handleFirestoreError(error, OperationType.LIST, 'employees');
      }
    );
    return () => unsub();
  }, []);

  // 5. Real-time Firestore sync: media assets
  useEffect(() => {
    const unsub = onSnapshot(
      collection(db, 'media'),
      snapshot => {
        const assets: Record<string, string> = {};
        snapshot.docs.forEach(d => {
          const dt = d.data();
          if (dt && dt.data) {
            assets[d.id] = dt.data;
          }
        });
        setMedia(assets);
      },
      error => {
        handleFirestoreError(error, OperationType.LIST, 'media');
      }
    );
    return () => unsub();
  }, []);

  // 6. Window Hash Change Listener
  useEffect(() => {
    const handleHashChange = () => {
      const route = parseHash();
      setCurrentRoute(route);
    };
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  // 7. Sync body class names & scroll
  useEffect(() => {
    document.body.classList.remove('is-home', 'is-stage', 'is-inner');
    if (currentRoute.name === 'home') {
      document.body.classList.add('is-home');
    } else if (currentRoute.name === 'team') {
      document.body.classList.add('is-stage');
    } else {
      document.body.classList.add('is-inner');
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [currentRoute]);

  const handleNavigate = (route: RouteState) => {
    if (route.name === 'emp') {
      window.location.hash = `#e-${route.id}-${route.tab}`;
    } else {
      window.location.hash = `#${route.name}`;
    }
    setCurrentRoute(route);
  };

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header Navigation */}
      <HeaderNav
        currentRoute={currentRoute}
        onNavigate={handleNavigate}
        adminUser={adminUser}
        tagline={content.site.tagline}
      />

      {/* Main Views */}
      <main className="flex-1">
        {currentRoute.name === 'home' && (
          <HomeView content={content} onNavigate={handleNavigate} />
        )}

        {currentRoute.name === 'about' && (
          <AboutView
            content={content}
            media={media}
            onNavigate={handleNavigate}
          />
        )}

        {currentRoute.name === 'team' && (
          <TeamView employees={employees} onNavigate={handleNavigate} />
        )}

        {currentRoute.name === 'emp' && (
          <EmployeeView
            employeeId={currentRoute.id}
            initialTab={currentRoute.tab}
            employees={employees}
            onNavigate={handleNavigate}
            onToast={showToast}
          />
        )}

        {currentRoute.name === 'contact' && (
          <ContactView content={content} onToast={showToast} />
        )}

        {currentRoute.name === 'apply' && (
          <ApplyView content={content} onToast={showToast} />
        )}

        {currentRoute.name === 'admin' && (
          <AdminView
            content={content}
            employees={employees}
            media={media}
            adminUser={adminUser}
            onUpdateContent={setContent}
            onToast={showToast}
          />
        )}
      </main>

      {/* Footer */}
      {currentRoute.name !== 'team' && (
        <Footer
          content={content}
          onNavigate={handleNavigate}
        />
      )}

      {/* Toast Feedback */}
      <Toast message={toastMessage} />
    </div>
  );
}
