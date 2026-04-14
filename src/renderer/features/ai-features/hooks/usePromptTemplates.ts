/**
 * Hook wrapping the prompt templates store for component use.
 */

import { useEffect } from 'react';

import { usePromptTemplatesStore } from '../model/promptTemplates.store';

export function usePromptTemplates() {
  const store = usePromptTemplatesStore();

  useEffect(() => {
    if (!store.isInitialized) {
      void store.initialize();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.isInitialized, store.initialize]);

  return store;
}
