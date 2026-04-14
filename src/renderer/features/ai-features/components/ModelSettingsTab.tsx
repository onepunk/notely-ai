import { Button, Slider, SpinButton, Text } from '@fluentui/react-components';
import { ArrowReset20Regular, Save20Regular } from '@fluentui/react-icons';
import * as React from 'react';
import { useTranslation } from 'react-i18next';

import { SettingsSection, SettingsTabLayout } from '../../settings/components/SettingsTabLayout';
import { useModelSettings } from '../hooks/useModelSettings';
import { useTranscriptionSettings } from '../hooks/useTranscriptionSettings';

import styles from './AIFeatures.module.css';
import { TranscriptionSettingsContent } from './TranscriptionSettingsContent';

type SubTab = 'llm' | 'transcription';

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

export const ModelSettingsTab: React.FC = () => {
  const { t } = useTranslation();
  const [subTab, setSubTab] = React.useState<SubTab>('llm');
  const {
    params,
    isDirty,
    isLoading,
    isSaving,
    save,
    resetToDefaults,
    updateParam,
    defaults: _defaults,
  } = useModelSettings();

  const transcriptionSettings = useTranscriptionSettings();

  if (isLoading) {
    return (
      <SettingsTabLayout title={t('llm.model_settings.title', { defaultValue: 'Model Settings' })}>
        <Text>{t('common.loading', { defaultValue: 'Loading...' })}</Text>
      </SettingsTabLayout>
    );
  }

  return (
    <SettingsTabLayout
      title={t('llm.model_settings.title', { defaultValue: 'Model Settings' })}
      description={t('llm.model_settings.description', {
        defaultValue: 'Configure inference parameters for the loaded AI model.',
      })}
      actions={
        <>
          <Button
            size="small"
            appearance="subtle"
            icon={<ArrowReset20Regular />}
            onClick={subTab === 'llm' ? resetToDefaults : transcriptionSettings.resetToDefaults}
            disabled={subTab === 'llm' ? isSaving : transcriptionSettings.isSaving}
          >
            {t('llm.model_settings.reset', { defaultValue: 'Reset' })}
          </Button>
          <Button
            size="small"
            appearance="primary"
            icon={<Save20Regular />}
            onClick={() => (subTab === 'llm' ? save() : transcriptionSettings.save())}
            disabled={
              subTab === 'llm'
                ? !isDirty || isSaving
                : !transcriptionSettings.isDirty || transcriptionSettings.isSaving
            }
          >
            {(subTab === 'llm' ? isSaving : transcriptionSettings.isSaving)
              ? t('common.saving', { defaultValue: 'Saving...' })
              : t('common.save', { defaultValue: 'Save' })}
          </Button>
        </>
      }
    >
      {/* Sub-tabs: LLM / Transcription */}
      <div className={styles.subTabs}>
        <button
          className={`${styles.subTab} ${subTab === 'llm' ? styles.subTabActive : ''}`}
          onClick={() => setSubTab('llm')}
        >
          LLM
        </button>
        <button
          className={`${styles.subTab} ${subTab === 'transcription' ? styles.subTabActive : ''}`}
          onClick={() => setSubTab('transcription')}
        >
          Transcription
        </button>
      </div>

      {subTab === 'transcription' && (
        <TranscriptionSettingsContent settings={transcriptionSettings} />
      )}

      {subTab === 'llm' && (
        <SettingsSection
          title={t('llm.model_settings.parameters', { defaultValue: 'Parameters' })}
          description={t('llm.model_settings.parameters_desc', {
            defaultValue: 'Adjust these values to control how the AI generates summaries.',
          })}
        >
          <ParameterRow
            label="Extraction Temperature"
            description="Controls randomness during data extraction from transcript chunks. Lower values produce more consistent structured output."
          >
            <Slider
              className={styles.parameterSlider}
              min={0}
              max={2}
              step={0.05}
              value={params.temperatureExtract}
              onChange={(_, data) => updateParam('temperatureExtract', data.value)}
            />
            <SpinButton
              className={styles.parameterSpinButton}
              min={0}
              max={2}
              step={0.05}
              value={params.temperatureExtract}
              onChange={(_, data) => {
                if (data.value !== undefined && data.value !== null) {
                  updateParam('temperatureExtract', data.value);
                }
              }}
            />
          </ParameterRow>

          <ParameterRow
            label="Refinement Temperature"
            description="Controls randomness during summary refinement. Higher values produce more creative narrative text."
          >
            <Slider
              className={styles.parameterSlider}
              min={0}
              max={2}
              step={0.05}
              value={params.temperatureRefine}
              onChange={(_, data) => updateParam('temperatureRefine', data.value)}
            />
            <SpinButton
              className={styles.parameterSpinButton}
              min={0}
              max={2}
              step={0.05}
              value={params.temperatureRefine}
              onChange={(_, data) => {
                if (data.value !== undefined && data.value !== null) {
                  updateParam('temperatureRefine', data.value);
                }
              }}
            />
          </ParameterRow>

          <ParameterRow
            label="Max Tokens"
            description="Maximum number of tokens in the generated response."
          >
            <SpinButton
              className={styles.parameterSpinButton}
              min={1}
              max={8192}
              step={50}
              value={params.maxTokens}
              onChange={(_, data) => {
                if (data.value !== undefined && data.value !== null) {
                  updateParam('maxTokens', Math.round(data.value));
                }
              }}
            />
          </ParameterRow>

          <ParameterRow
            label="Top P"
            description="Nucleus sampling threshold. Lower values make output more deterministic."
          >
            <Slider
              className={styles.parameterSlider}
              min={0}
              max={1}
              step={0.05}
              value={params.topP}
              onChange={(_, data) => updateParam('topP', data.value)}
            />
            <SpinButton
              className={styles.parameterSpinButton}
              min={0}
              max={1}
              step={0.05}
              value={params.topP}
              onChange={(_, data) => {
                if (data.value !== undefined && data.value !== null) {
                  updateParam('topP', data.value);
                }
              }}
            />
          </ParameterRow>

          <ParameterRow
            label="Context Window"
            description="Number of tokens the model can consider. Larger windows use more VRAM."
          >
            <SpinButton
              className={styles.parameterSpinButton}
              min={512}
              max={32768}
              step={256}
              value={params.contextWindow}
              onChange={(_, data) => {
                if (data.value !== undefined && data.value !== null) {
                  updateParam('contextWindow', Math.round(data.value));
                }
              }}
            />
          </ParameterRow>

          <ParameterRow
            label="GPU Layers"
            description="Number of model layers to offload to GPU. -1 means all layers."
          >
            <SpinButton
              className={styles.parameterSpinButton}
              min={-1}
              max={999}
              step={1}
              value={params.nGpuLayers}
              onChange={(_, data) => {
                if (data.value !== undefined && data.value !== null) {
                  updateParam('nGpuLayers', Math.round(data.value));
                }
              }}
            />
          </ParameterRow>
        </SettingsSection>
      )}
    </SettingsTabLayout>
  );
};
