/**
 * AppWithSetup - Wrapper component that handles component download setup
 *
 * Checks if required components (audio-engine, model) are downloaded.
 * Shows SetupScreen if components need to be downloaded before rendering the main app.
 */

import * as React from 'react';

import { SetupScreen } from '../features/setup';

interface AppWithSetupProps {
  children: React.ReactNode;
}

/**
 * AppWithSetup ensures required components are downloaded before showing the main app.
 * Renders a single unified SetupScreen that handles all startup phases (loading,
 * checking, downloading) without page transitions.
 */
export function AppWithSetup({ children }: AppWithSetupProps): JSX.Element {
  const [componentsReady, setComponentsReady] = React.useState(false);

  if (!componentsReady) {
    return <SetupScreen onReady={() => setComponentsReady(true)} />;
  }

  return <>{children}</>;
}

export default AppWithSetup;
