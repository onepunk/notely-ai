import * as React from 'react';
import { Suspense, lazy, useEffect } from 'react';
import { Routes, Route, Navigate, useNavigate } from 'react-router-dom';

import { AIFeaturesModal } from '../features/ai-features/modal/AIFeaturesModal';
import { SettingsModal } from '../features/settings/modal/SettingsModal';
import { log } from '../shared/log';

import { AppLayout } from './layout/AppLayout';

const WorkspacePage = lazy(() => import('./pages/WorkspacePage'));
const CalendarPage = lazy(() => import('./pages/CalendarPage'));

export default function RoutesView() {
  const navigate = useNavigate();
  const navigateRef = React.useRef(navigate);
  navigateRef.current = navigate;
  const bridgeAvailable =
    typeof window !== 'undefined' && (window as Window & { api?: unknown }).api;
  useEffect(() => {
    if (!bridgeAvailable) return;
    log.info('Renderer bootstrap start');
    window.api.rendererReady();
    const deepLinkHandler = (route: string) => {
      log.info('Deep link received', { route });
      navigateRef.current(route);
    };
    const unsubscribeDeepLink = window.api.onDeepLink(deepLinkHandler);
    return () => {
      unsubscribeDeepLink();
    };
  }, [bridgeAvailable]);

  if (!bridgeAvailable) {
    return (
      <div style={{ padding: 24, fontFamily: 'system-ui, Segoe UI, Arial' }}>
        <h2>Notely (Renderer)</h2>
        <p>The Electron bridge is not available. For full functionality, run Electron:</p>
        <pre>npm run dev (dev server) and npm start (Electron)</pre>
      </div>
    );
  }

  return (
    <>
      <Routes>
        <Route element={<AppLayout />}>
          <Route
            index
            element={
              <Suspense fallback={null}>
                <WorkspacePage />
              </Suspense>
            }
          />
          <Route
            path="notes/:noteId"
            element={
              <Suspense fallback={null}>
                <WorkspacePage />
              </Suspense>
            }
          />
          <Route
            path="binders/:binderId"
            element={
              <Suspense fallback={null}>
                <WorkspacePage />
              </Suspense>
            }
          />
          <Route
            path="binders/:binderId/notes/:noteId"
            element={
              <Suspense fallback={null}>
                <WorkspacePage />
              </Suspense>
            }
          />
          <Route
            path="calendar"
            element={
              <Suspense fallback={null}>
                <CalendarPage />
              </Suspense>
            }
          />
          <Route path="settings/:section?" element={<SettingsModal />} />
          <Route path="ai-features/:section?" element={<AIFeaturesModal />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </>
  );
}
