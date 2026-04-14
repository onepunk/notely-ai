/**
 * Hook managing transcription parameter state with dirty tracking, save, and reset.
 * Mirrors the useModelSettings pattern for LLM settings.
 */

import { useCallback, useEffect, useState } from 'react';

import { TRANSCRIPTION_CONFIG } from '../../../../common/config';

export interface TranscriptionParams {
  // Inference
  language: string;
  beamSize: number;
  temperature: number;
  // VAD
  vadEnabled: boolean;
  vadThreshold: number;
  vadMinSpeechDurationMs: number;
  vadMinSilenceDurationMs: number;
  vadSpeechPadMs: number;
  // Sliding Window
  useSlidingWindow: boolean;
  windowSizeMs: number;
  windowOverlapMs: number;
  maxSegmentLengthMs: number;
  minStableIterations: number;
  commitDelayMs: number;
  maxPendingAudioMs: number;
  contextPromptMaxChars: number;
  // Refinement
  refinementEnabled: boolean;
  refinementDelayMs: number;
  refinementBeamSize: number;
  refinementTemperature: number;
  refinementWorkers: number;
  refinementMaxQueueSize: number;
  // Hallucination Prevention
  conditionOnPreviousText: boolean;
  repetitionPenalty: number;
  noRepeatNgramSize: number;
}

const DEFAULT_PARAMS: TranscriptionParams = {
  language: TRANSCRIPTION_CONFIG.language,
  beamSize: TRANSCRIPTION_CONFIG.beamSize,
  temperature: TRANSCRIPTION_CONFIG.temperature,
  vadEnabled: TRANSCRIPTION_CONFIG.vadEnabled,
  vadThreshold: TRANSCRIPTION_CONFIG.vadThreshold,
  vadMinSpeechDurationMs: TRANSCRIPTION_CONFIG.vadMinSpeechDurationMs,
  vadMinSilenceDurationMs: TRANSCRIPTION_CONFIG.vadMinSilenceDurationMs,
  vadSpeechPadMs: TRANSCRIPTION_CONFIG.vadSpeechPadMs,
  useSlidingWindow: TRANSCRIPTION_CONFIG.useSlidingWindow,
  windowSizeMs: TRANSCRIPTION_CONFIG.windowSizeMs,
  windowOverlapMs: TRANSCRIPTION_CONFIG.windowOverlapMs,
  maxSegmentLengthMs: TRANSCRIPTION_CONFIG.maxSegmentLengthMs,
  minStableIterations: TRANSCRIPTION_CONFIG.minStableIterations,
  commitDelayMs: TRANSCRIPTION_CONFIG.commitDelayMs,
  maxPendingAudioMs: TRANSCRIPTION_CONFIG.maxPendingAudioMs,
  contextPromptMaxChars: TRANSCRIPTION_CONFIG.contextPromptMaxChars,
  refinementEnabled: TRANSCRIPTION_CONFIG.refinementEnabled,
  refinementDelayMs: TRANSCRIPTION_CONFIG.refinementDelayMs,
  refinementBeamSize: TRANSCRIPTION_CONFIG.refinementBeamSize,
  refinementTemperature: TRANSCRIPTION_CONFIG.refinementTemperature,
  refinementWorkers: TRANSCRIPTION_CONFIG.refinementWorkers,
  refinementMaxQueueSize: TRANSCRIPTION_CONFIG.refinementMaxQueueSize,
  conditionOnPreviousText: TRANSCRIPTION_CONFIG.conditionOnPreviousText,
  repetitionPenalty: TRANSCRIPTION_CONFIG.repetitionPenalty,
  noRepeatNgramSize: TRANSCRIPTION_CONFIG.noRepeatNgramSize,
};

function parseValue(value: string, defaultValue: unknown): unknown {
  if (typeof defaultValue === 'boolean') {
    return value === 'true';
  }
  if (typeof defaultValue === 'number') {
    const num = Number(value);
    return Number.isNaN(num) ? defaultValue : num;
  }
  return value;
}

function settingsToParams(
  settings: Record<string, string>,
  defaults: TranscriptionParams
): TranscriptionParams {
  const result = { ...defaults };
  for (const [key, value] of Object.entries(settings)) {
    if (key in defaults) {
      (result as Record<string, unknown>)[key] = parseValue(
        value,
        defaults[key as keyof TranscriptionParams]
      );
    }
  }
  return result;
}

export function useTranscriptionSettings() {
  const [params, setParams] = useState<TranscriptionParams>(DEFAULT_PARAMS);
  const [savedParams, setSavedParams] = useState<TranscriptionParams>(DEFAULT_PARAMS);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  const isDirty = JSON.stringify(params) !== JSON.stringify(savedParams);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const settings = await window.api.transcription.getTranscriptionSettings();
      const loaded = settingsToParams(settings, DEFAULT_PARAMS);
      setParams(loaded);
      setSavedParams(loaded);
    } catch (error) {
      console.error('Failed to load transcription settings:', error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = useCallback(async () => {
    setIsSaving(true);
    try {
      const result = await window.api.transcription.setTranscriptionSettings(
        params as unknown as Record<string, unknown>
      );
      if (result.success) {
        setSavedParams({ ...params });
      }
      return result.success;
    } catch (error) {
      console.error('Failed to save transcription settings:', error);
      return false;
    } finally {
      setIsSaving(false);
    }
  }, [params]);

  const resetToDefaults = useCallback(() => {
    setParams(DEFAULT_PARAMS);
  }, []);

  const discard = useCallback(() => {
    setParams({ ...savedParams });
  }, [savedParams]);

  const updateParam = useCallback(
    <K extends keyof TranscriptionParams>(key: K, value: TranscriptionParams[K]) => {
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
    defaults: DEFAULT_PARAMS,
  };
}
