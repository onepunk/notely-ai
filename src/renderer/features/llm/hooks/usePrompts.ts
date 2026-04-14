import * as React from 'react';

import type { PromptsConfig } from '../../../../preload/index';
import { useLLMStore } from '../model/llm.store';

/**
 * Hook for managing prompt configuration.
 */
export function usePrompts() {
  const prompts = useLLMStore((state) => state.prompts);
  const setPrompts = useLLMStore((state) => state.setPrompts);
  const resetPrompts = useLLMStore((state) => state.resetPrompts);
  const isInitialized = useLLMStore((state) => state.isInitialized);
  const initialize = useLLMStore((state) => state.initialize);

  // Local state for editing
  const [localPrompts, setLocalPrompts] = React.useState<PromptsConfig | null>(null);
  const [isSaving, setIsSaving] = React.useState(false);
  const [isResetting, setIsResetting] = React.useState(false);
  const [saveError, setSaveError] = React.useState<string | null>(null);

  // Initialize store if needed
  React.useEffect(() => {
    if (!isInitialized) {
      void initialize();
    }
  }, [isInitialized, initialize]);

  // Sync local state with store
  React.useEffect(() => {
    if (prompts && !localPrompts) {
      setLocalPrompts(prompts);
    }
  }, [prompts, localPrompts]);

  // Check if there are unsaved changes
  const hasChanges = React.useMemo(() => {
    if (!localPrompts || !prompts) return false;
    return (
      localPrompts.systemPrompt !== prompts.systemPrompt ||
      JSON.stringify(localPrompts.structure) !== JSON.stringify(prompts.structure)
    );
  }, [localPrompts, prompts]);

  // Update local system prompt
  const setSystemPrompt = React.useCallback((systemPrompt: string) => {
    setLocalPrompts((prev) => (prev ? { ...prev, systemPrompt } : null));
    setSaveError(null);
  }, []);

  // Update local structure
  const setStructure = React.useCallback((structure: Record<string, unknown>) => {
    setLocalPrompts((prev) => (prev ? { ...prev, structure } : null));
    setSaveError(null);
  }, []);

  // Save changes to main process
  const save = React.useCallback(async () => {
    if (!localPrompts || !hasChanges) return;

    setIsSaving(true);
    setSaveError(null);

    try {
      await setPrompts(localPrompts);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Failed to save prompts');
      throw error;
    } finally {
      setIsSaving(false);
    }
  }, [localPrompts, hasChanges, setPrompts]);

  // Reset to defaults
  const reset = React.useCallback(async () => {
    setIsResetting(true);
    setSaveError(null);

    try {
      await resetPrompts();
      // Local state will be updated via store sync
      setLocalPrompts(null);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Failed to reset prompts');
      throw error;
    } finally {
      setIsResetting(false);
    }
  }, [resetPrompts]);

  // Discard local changes
  const discard = React.useCallback(() => {
    setLocalPrompts(prompts);
    setSaveError(null);
  }, [prompts]);

  return {
    // Current prompts (local edits)
    prompts: localPrompts,
    systemPrompt: localPrompts?.systemPrompt ?? '',
    structure: localPrompts?.structure ?? {},

    // Saved prompts (from store)
    savedPrompts: prompts,

    // Edit actions
    setSystemPrompt,
    setStructure,

    // State
    hasChanges,
    isSaving,
    isResetting,
    saveError,
    isLoading: !isInitialized || !prompts,

    // Actions
    save,
    reset,
    discard,
  };
}

/**
 * Hook for validating prompt structure JSON.
 */
export function usePromptStructureValidator() {
  const [isValid, setIsValid] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const validate = React.useCallback((jsonString: string): boolean => {
    try {
      const parsed = JSON.parse(jsonString);

      // Basic structure validation
      if (typeof parsed !== 'object' || parsed === null) {
        setError('Structure must be a JSON object');
        setIsValid(false);
        return false;
      }

      setError(null);
      setIsValid(true);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Invalid JSON');
      setIsValid(false);
      return false;
    }
  }, []);

  return {
    isValid,
    error,
    validate,
  };
}
