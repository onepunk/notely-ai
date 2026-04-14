import { Dropdown, Option, Slider, SpinButton, Switch, Text } from '@fluentui/react-components';
import * as React from 'react';

import { SettingsSection } from '../../settings/components/SettingsTabLayout';
import { type useTranscriptionSettings } from '../hooks/useTranscriptionSettings';

import styles from './AIFeatures.module.css';

interface ParameterRowProps {
  label: string;
  description: string;
  children: React.ReactNode;
}

const ParameterRow: React.FC<ParameterRowProps> = ({ label, description, children }) => (
  <div className={styles.parameterRow}>
    <div className={styles.parameterLabel}>
      <Text size={300} className={styles.parameterLabelText}>
        {label}
      </Text>
      <Text size={200} className={styles.parameterDescription}>
        {description}
      </Text>
    </div>
    <div className={styles.parameterControl}>{children}</div>
  </div>
);

const LANGUAGE_OPTIONS = [
  { value: 'auto', label: 'Auto Detect' },
  { value: 'en', label: 'English' },
  { value: 'es', label: 'Spanish' },
  { value: 'fr', label: 'French' },
  { value: 'de', label: 'German' },
  { value: 'it', label: 'Italian' },
  { value: 'pt', label: 'Portuguese' },
  { value: 'nl', label: 'Dutch' },
  { value: 'ja', label: 'Japanese' },
  { value: 'ko', label: 'Korean' },
  { value: 'zh', label: 'Chinese' },
  { value: 'ru', label: 'Russian' },
  { value: 'ar', label: 'Arabic' },
  { value: 'hi', label: 'Hindi' },
  { value: 'pl', label: 'Polish' },
  { value: 'sv', label: 'Swedish' },
  { value: 'da', label: 'Danish' },
  { value: 'no', label: 'Norwegian' },
  { value: 'fi', label: 'Finnish' },
  { value: 'tr', label: 'Turkish' },
  { value: 'uk', label: 'Ukrainian' },
];

interface TranscriptionSettingsContentProps {
  settings: ReturnType<typeof useTranscriptionSettings>;
}

export const TranscriptionSettingsContent: React.FC<TranscriptionSettingsContentProps> = ({
  settings,
}) => {
  const { params, isLoading, updateParam } = settings;

  if (isLoading) {
    return <Text>Loading settings...</Text>;
  }

  return (
    <>
      {/* Inference */}
      <SettingsSection title="Inference" description="Core transcription parameters.">
        <ParameterRow
          label="Language"
          description="Language for transcription. Auto detect identifies the spoken language."
        >
          <Dropdown
            value={
              LANGUAGE_OPTIONS.find((o) => o.value === params.language)?.label ?? 'Auto Detect'
            }
            selectedOptions={[params.language]}
            onOptionSelect={(_, data) => {
              if (data.optionValue) {
                updateParam('language', data.optionValue);
              }
            }}
          >
            {LANGUAGE_OPTIONS.map((opt) => (
              <Option key={opt.value} value={opt.value}>
                {opt.label}
              </Option>
            ))}
          </Dropdown>
        </ParameterRow>

        <ParameterRow
          label="Beam Size"
          description="Higher values improve accuracy but increase processing time."
        >
          <SpinButton
            className={styles.parameterSpinButton}
            min={1}
            max={10}
            step={1}
            value={params.beamSize}
            onChange={(_, data) => {
              if (data.value !== undefined && data.value !== null) {
                updateParam('beamSize', Math.round(data.value));
              }
            }}
          />
        </ParameterRow>

        <ParameterRow
          label="Temperature"
          description="Controls randomness. 0 for deterministic output."
        >
          <Slider
            className={styles.parameterSlider}
            min={0}
            max={1}
            step={0.05}
            value={params.temperature}
            onChange={(_, data) => updateParam('temperature', data.value)}
          />
          <SpinButton
            className={styles.parameterSpinButton}
            min={0}
            max={1}
            step={0.05}
            value={params.temperature}
            onChange={(_, data) => {
              if (data.value !== undefined && data.value !== null) {
                updateParam('temperature', data.value);
              }
            }}
          />
        </ParameterRow>
      </SettingsSection>

      {/* Voice Activity Detection */}
      <SettingsSection
        title="Voice Activity Detection"
        description="Filter silence and non-speech audio."
      >
        <ParameterRow
          label="VAD Enabled"
          description="Use voice activity detection to filter silence."
        >
          <Switch
            checked={params.vadEnabled}
            onChange={(_, data) => updateParam('vadEnabled', data.checked)}
          />
        </ParameterRow>

        <ParameterRow
          label="VAD Threshold"
          description="Speech detection confidence threshold (0-1)."
        >
          <Slider
            className={styles.parameterSlider}
            min={0}
            max={1}
            step={0.05}
            value={params.vadThreshold}
            onChange={(_, data) => updateParam('vadThreshold', data.value)}
            disabled={!params.vadEnabled}
          />
          <SpinButton
            className={styles.parameterSpinButton}
            min={0}
            max={1}
            step={0.05}
            value={params.vadThreshold}
            onChange={(_, data) => {
              if (data.value !== undefined && data.value !== null) {
                updateParam('vadThreshold', data.value);
              }
            }}
            disabled={!params.vadEnabled}
          />
        </ParameterRow>

        <ParameterRow
          label="Min Speech Duration"
          description="Minimum speech segment length in milliseconds."
        >
          <SpinButton
            className={styles.parameterSpinButton}
            min={0}
            max={2000}
            step={50}
            value={params.vadMinSpeechDurationMs}
            onChange={(_, data) => {
              if (data.value !== undefined && data.value !== null) {
                updateParam('vadMinSpeechDurationMs', Math.round(data.value));
              }
            }}
            disabled={!params.vadEnabled}
          />
        </ParameterRow>

        <ParameterRow
          label="Min Silence Duration"
          description="Minimum silence between speech segments in milliseconds."
        >
          <SpinButton
            className={styles.parameterSpinButton}
            min={0}
            max={2000}
            step={50}
            value={params.vadMinSilenceDurationMs}
            onChange={(_, data) => {
              if (data.value !== undefined && data.value !== null) {
                updateParam('vadMinSilenceDurationMs', Math.round(data.value));
              }
            }}
            disabled={!params.vadEnabled}
          />
        </ParameterRow>

        <ParameterRow
          label="Speech Padding"
          description="Padding added around detected speech in milliseconds."
        >
          <SpinButton
            className={styles.parameterSpinButton}
            min={0}
            max={1000}
            step={50}
            value={params.vadSpeechPadMs}
            onChange={(_, data) => {
              if (data.value !== undefined && data.value !== null) {
                updateParam('vadSpeechPadMs', Math.round(data.value));
              }
            }}
            disabled={!params.vadEnabled}
          />
        </ParameterRow>
      </SettingsSection>

      {/* Streaming / Sliding Window */}
      <SettingsSection
        title="Streaming / Sliding Window"
        description="Control how audio is processed in real-time streaming mode."
      >
        <ParameterRow
          label="Sliding Window"
          description="Process audio in overlapping windows for real-time streaming."
        >
          <Switch
            checked={params.useSlidingWindow}
            onChange={(_, data) => updateParam('useSlidingWindow', data.checked)}
          />
        </ParameterRow>

        <ParameterRow
          label="Window Size"
          description="Size of each processing window in milliseconds."
        >
          <SpinButton
            className={styles.parameterSpinButton}
            min={5000}
            max={120000}
            step={5000}
            value={params.windowSizeMs}
            onChange={(_, data) => {
              if (data.value !== undefined && data.value !== null) {
                updateParam('windowSizeMs', Math.round(data.value));
              }
            }}
            disabled={!params.useSlidingWindow}
          />
        </ParameterRow>

        <ParameterRow
          label="Window Overlap"
          description="Overlap between consecutive windows in milliseconds."
        >
          <SpinButton
            className={styles.parameterSpinButton}
            min={0}
            max={30000}
            step={1000}
            value={params.windowOverlapMs}
            onChange={(_, data) => {
              if (data.value !== undefined && data.value !== null) {
                updateParam('windowOverlapMs', Math.round(data.value));
              }
            }}
            disabled={!params.useSlidingWindow}
          />
        </ParameterRow>

        <ParameterRow
          label="Max Segment Length"
          description="Maximum segment length before forced split in milliseconds."
        >
          <SpinButton
            className={styles.parameterSpinButton}
            min={10000}
            max={300000}
            step={10000}
            value={params.maxSegmentLengthMs}
            onChange={(_, data) => {
              if (data.value !== undefined && data.value !== null) {
                updateParam('maxSegmentLengthMs', Math.round(data.value));
              }
            }}
            disabled={!params.useSlidingWindow}
          />
        </ParameterRow>

        <ParameterRow
          label="Min Stable Iterations"
          description="LocalAgreement iterations required before committing text."
        >
          <SpinButton
            className={styles.parameterSpinButton}
            min={1}
            max={10}
            step={1}
            value={params.minStableIterations}
            onChange={(_, data) => {
              if (data.value !== undefined && data.value !== null) {
                updateParam('minStableIterations', Math.round(data.value));
              }
            }}
            disabled={!params.useSlidingWindow}
          />
        </ParameterRow>

        <ParameterRow
          label="Commit Delay"
          description="Wait time before committing stable text in milliseconds."
        >
          <SpinButton
            className={styles.parameterSpinButton}
            min={0}
            max={10000}
            step={250}
            value={params.commitDelayMs}
            onChange={(_, data) => {
              if (data.value !== undefined && data.value !== null) {
                updateParam('commitDelayMs', Math.round(data.value));
              }
            }}
            disabled={!params.useSlidingWindow}
          />
        </ParameterRow>

        <ParameterRow
          label="Max Pending Audio"
          description="Force commit threshold in milliseconds."
        >
          <SpinButton
            className={styles.parameterSpinButton}
            min={10000}
            max={120000}
            step={5000}
            value={params.maxPendingAudioMs}
            onChange={(_, data) => {
              if (data.value !== undefined && data.value !== null) {
                updateParam('maxPendingAudioMs', Math.round(data.value));
              }
            }}
            disabled={!params.useSlidingWindow}
          />
        </ParameterRow>

        <ParameterRow
          label="Context Prompt Chars"
          description="Max characters from committed text used as context prompt."
        >
          <SpinButton
            className={styles.parameterSpinButton}
            min={0}
            max={2000}
            step={100}
            value={params.contextPromptMaxChars}
            onChange={(_, data) => {
              if (data.value !== undefined && data.value !== null) {
                updateParam('contextPromptMaxChars', Math.round(data.value));
              }
            }}
            disabled={!params.useSlidingWindow}
          />
        </ParameterRow>
      </SettingsSection>

      {/* Refinement */}
      <SettingsSection
        title="Refinement"
        description="Second-pass transcription with higher quality settings."
      >
        <ParameterRow
          label="Refinement Enabled"
          description="Re-transcribe completed segments with higher beam size."
        >
          <Switch
            checked={params.refinementEnabled}
            onChange={(_, data) => updateParam('refinementEnabled', data.checked)}
          />
        </ParameterRow>

        <ParameterRow
          label="Refinement Delay"
          description="Wait time before starting refinement in milliseconds."
        >
          <SpinButton
            className={styles.parameterSpinButton}
            min={0}
            max={10000}
            step={500}
            value={params.refinementDelayMs}
            onChange={(_, data) => {
              if (data.value !== undefined && data.value !== null) {
                updateParam('refinementDelayMs', Math.round(data.value));
              }
            }}
            disabled={!params.refinementEnabled}
          />
        </ParameterRow>

        <ParameterRow label="Refinement Beam Size" description="Beam size for refinement pass.">
          <SpinButton
            className={styles.parameterSpinButton}
            min={1}
            max={10}
            step={1}
            value={params.refinementBeamSize}
            onChange={(_, data) => {
              if (data.value !== undefined && data.value !== null) {
                updateParam('refinementBeamSize', Math.round(data.value));
              }
            }}
            disabled={!params.refinementEnabled}
          />
        </ParameterRow>

        <ParameterRow
          label="Refinement Temperature"
          description="Temperature for refinement. 0 for deterministic."
        >
          <Slider
            className={styles.parameterSlider}
            min={0}
            max={1}
            step={0.05}
            value={params.refinementTemperature}
            onChange={(_, data) => updateParam('refinementTemperature', data.value)}
            disabled={!params.refinementEnabled}
          />
          <SpinButton
            className={styles.parameterSpinButton}
            min={0}
            max={1}
            step={0.05}
            value={params.refinementTemperature}
            onChange={(_, data) => {
              if (data.value !== undefined && data.value !== null) {
                updateParam('refinementTemperature', data.value);
              }
            }}
            disabled={!params.refinementEnabled}
          />
        </ParameterRow>

        <ParameterRow
          label="Refinement Workers"
          description="Number of worker threads for refinement."
        >
          <SpinButton
            className={styles.parameterSpinButton}
            min={1}
            max={4}
            step={1}
            value={params.refinementWorkers}
            onChange={(_, data) => {
              if (data.value !== undefined && data.value !== null) {
                updateParam('refinementWorkers', Math.round(data.value));
              }
            }}
            disabled={!params.refinementEnabled}
          />
        </ParameterRow>

        <ParameterRow label="Max Queue Size" description="Maximum queued refinement jobs.">
          <SpinButton
            className={styles.parameterSpinButton}
            min={1}
            max={500}
            step={10}
            value={params.refinementMaxQueueSize}
            onChange={(_, data) => {
              if (data.value !== undefined && data.value !== null) {
                updateParam('refinementMaxQueueSize', Math.round(data.value));
              }
            }}
            disabled={!params.refinementEnabled}
          />
        </ParameterRow>
      </SettingsSection>

      {/* Hallucination Prevention */}
      <SettingsSection
        title="Hallucination Prevention"
        description="Inference-level controls to reduce transcription hallucinations."
      >
        <ParameterRow
          label="Condition on Previous"
          description="Use previous text as context. Can reduce or increase hallucinations."
        >
          <Switch
            checked={params.conditionOnPreviousText}
            onChange={(_, data) => updateParam('conditionOnPreviousText', data.checked)}
          />
        </ParameterRow>

        <ParameterRow
          label="Repetition Penalty"
          description="Penalizes repeated tokens during beam search (1.0 = off)."
        >
          <Slider
            className={styles.parameterSlider}
            min={1}
            max={2}
            step={0.05}
            value={params.repetitionPenalty}
            onChange={(_, data) => updateParam('repetitionPenalty', data.value)}
          />
          <SpinButton
            className={styles.parameterSpinButton}
            min={1}
            max={2}
            step={0.05}
            value={params.repetitionPenalty}
            onChange={(_, data) => {
              if (data.value !== undefined && data.value !== null) {
                updateParam('repetitionPenalty', data.value);
              }
            }}
          />
        </ParameterRow>

        <ParameterRow
          label="No Repeat N-gram"
          description="Prevents any n-gram of this size from repeating (0 = off)."
        >
          <SpinButton
            className={styles.parameterSpinButton}
            min={0}
            max={10}
            step={1}
            value={params.noRepeatNgramSize}
            onChange={(_, data) => {
              if (data.value !== undefined && data.value !== null) {
                updateParam('noRepeatNgramSize', Math.round(data.value));
              }
            }}
          />
        </ParameterRow>
      </SettingsSection>
    </>
  );
};
