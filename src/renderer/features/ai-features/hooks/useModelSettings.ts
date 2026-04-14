/**
 * Hook managing model parameter state with dirty tracking, save, and reset.
 */

import { useCallback, useEffect, useState } from 'react';

import { DEFAULT_MODEL_PARAMETERS } from '../../../../common/config';
import type { ModelParameters } from '../../../../preload/index';

export function useModelSettings() {
  const [params, setParams] = useState<ModelParameters>(DEFAULT_MODEL_PARAMETERS);
  const [savedParams, setSavedParams] = useState<ModelParameters>(DEFAULT_MODEL_PARAMETERS);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  const isDirty =
    params.temperatureExtract !== savedParams.temperatureExtract ||
    params.temperatureRefine !== savedParams.temperatureRefine ||
    params.maxTokens !== savedParams.maxTokens ||
    params.topP !== savedParams.topP ||
    params.contextWindow !== savedParams.contextWindow ||
    params.nGpuLayers !== savedParams.nGpuLayers;

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const result = await window.api.llm.getModelParameters();
      setParams(result);
      setSavedParams(result);
    } catch (error) {
      console.error('Failed to load model parameters:', error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const cleanup = window.api.llm.onModelLoaded(() => {
      void load();
    });
    return cleanup;
  }, [load]);

  const save = useCallback(async () => {
    setIsSaving(true);
    try {
      const result = await window.api.llm.setModelParameters(params);
      if (result.success) {
        setSavedParams({ ...params });
      }
      return result.success;
    } catch (error) {
      console.error('Failed to save model parameters:', error);
      return false;
    } finally {
      setIsSaving(false);
    }
  }, [params]);

  const resetToDefaults = useCallback(() => {
    setParams(DEFAULT_MODEL_PARAMETERS);
  }, []);

  const discard = useCallback(() => {
    setParams({ ...savedParams });
  }, [savedParams]);

  const updateParam = useCallback(
    <K extends keyof ModelParameters>(key: K, value: ModelParameters[K]) => {
      setParams((prev) => ({ ...prev, [key]: value }));
    },
    []
  );

  return {
    params,
    savedParams,
    isDirty,
    isLoading,
    isSaving,
    save,
    resetToDefaults,
    discard,
    updateParam,
    defaults: DEFAULT_MODEL_PARAMETERS,
  };
}
