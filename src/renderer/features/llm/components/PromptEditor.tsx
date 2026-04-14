import { Button, Textarea, Text, Tab, TabList } from '@fluentui/react-components';
import { ArrowReset20Regular, Save20Regular } from '@fluentui/react-icons';
import * as React from 'react';
import { useTranslation } from 'react-i18next';

import { usePrompts, usePromptStructureValidator } from '../hooks/usePrompts';

import styles from './PromptEditor.module.css';

interface PromptEditorProps {
  onClose?: () => void;
}

/**
 * Editor for customizing LLM prompts and output structure.
 */
export const PromptEditor: React.FC<PromptEditorProps> = ({ onClose: _onClose }) => {
  const { t } = useTranslation();
  const {
    systemPrompt,
    structure,
    hasChanges,
    isSaving,
    isResetting,
    saveError,
    isLoading,
    setSystemPrompt,
    setStructure,
    save,
    reset,
    discard,
  } = usePrompts();

  const {
    isValid: isStructureValid,
    error: structureError,
    validate,
  } = usePromptStructureValidator();

  const [activeTab, setActiveTab] = React.useState<'system' | 'structure'>('system');
  const [structureText, setStructureText] = React.useState<string>('');

  // Initialize structure text
  React.useEffect(() => {
    if (structure && !structureText) {
      setStructureText(JSON.stringify(structure, null, 2));
    }
  }, [structure, structureText]);

  // Handle structure text changes
  const handleStructureChange = React.useCallback(
    (value: string) => {
      setStructureText(value);
      if (validate(value)) {
        try {
          const parsed = JSON.parse(value);
          setStructure(parsed);
        } catch {
          // Validation already handles this
        }
      }
    },
    [validate, setStructure]
  );

  const handleSave = React.useCallback(async () => {
    if (!isStructureValid) return;
    try {
      await save();
    } catch (error) {
      console.error('Failed to save prompts:', error);
    }
  }, [isStructureValid, save]);

  const handleReset = React.useCallback(async () => {
    if (
      !confirm(
        t('llm.prompts.reset_confirm', {
          defaultValue:
            'Are you sure you want to reset prompts to defaults? This cannot be undone.',
        })
      )
    ) {
      return;
    }

    try {
      await reset();
      setStructureText('');
    } catch (error) {
      console.error('Failed to reset prompts:', error);
    }
  }, [reset, t]);

  const handleDiscard = React.useCallback(() => {
    discard();
    if (structure) {
      setStructureText(JSON.stringify(structure, null, 2));
    }
  }, [discard, structure]);

  if (isLoading) {
    return (
      <div className={styles.loading}>
        <Text>{t('common.loading', { defaultValue: 'Loading...' })}</Text>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div className={styles.headerText}>
          <Text weight="semibold" size={400}>
            {t('llm.prompts.title', { defaultValue: 'Prompt Editor' })}
          </Text>
          <Text size={200} className={styles.description}>
            {t('llm.prompts.description', {
              defaultValue: 'Customize the system prompt and output structure for AI summaries.',
            })}
          </Text>
        </div>
        <div className={styles.headerActions}>
          <Button
            appearance="subtle"
            icon={<ArrowReset20Regular />}
            onClick={handleReset}
            disabled={isResetting}
          >
            {t('llm.prompts.reset', { defaultValue: 'Reset to Defaults' })}
          </Button>
        </div>
      </div>

      <TabList
        selectedValue={activeTab}
        onTabSelect={(_, data) => setActiveTab(data.value as 'system' | 'structure')}
        className={styles.tabs}
      >
        <Tab value="system">{t('llm.prompts.system_tab', { defaultValue: 'System Prompt' })}</Tab>
        <Tab value="structure">
          {t('llm.prompts.structure_tab', { defaultValue: 'Output Structure' })}
        </Tab>
      </TabList>

      <div className={styles.editor}>
        {activeTab === 'system' && (
          <div className={styles.editorPane}>
            <Text size={200} className={styles.hint}>
              {t('llm.prompts.system_hint', {
                defaultValue:
                  'This prompt is sent to the AI before your transcript to guide its behavior.',
              })}
            </Text>
            <Textarea
              value={systemPrompt}
              onChange={(_, data) => setSystemPrompt(data.value)}
              className={styles.textarea}
              resize="vertical"
              placeholder={t('llm.prompts.system_placeholder', {
                defaultValue: 'Enter system prompt...',
              })}
            />
          </div>
        )}

        {activeTab === 'structure' && (
          <div className={styles.editorPane}>
            <Text size={200} className={styles.hint}>
              {t('llm.prompts.structure_hint', {
                defaultValue: 'JSON schema that defines the output structure for summaries.',
              })}
            </Text>
            <Textarea
              value={structureText}
              onChange={(_, data) => handleStructureChange(data.value)}
              className={`${styles.textarea} ${styles.codeTextarea} ${!isStructureValid ? styles.invalid : ''}`}
              resize="vertical"
              placeholder="{}"
            />
            {structureError && (
              <Text size={100} className={styles.errorText}>
                {structureError}
              </Text>
            )}
          </div>
        )}
      </div>

      {saveError && (
        <Text size={200} className={styles.saveError}>
          {saveError}
        </Text>
      )}

      <div className={styles.footer}>
        <div className={styles.footerLeft}>
          {hasChanges && (
            <Text size={200} className={styles.unsavedText}>
              {t('llm.prompts.unsaved', { defaultValue: 'Unsaved changes' })}
            </Text>
          )}
        </div>
        <div className={styles.footerActions}>
          {hasChanges && (
            <Button appearance="subtle" onClick={handleDiscard}>
              {t('common.discard', { defaultValue: 'Discard' })}
            </Button>
          )}
          <Button
            appearance="primary"
            icon={<Save20Regular />}
            onClick={handleSave}
            disabled={!hasChanges || isSaving || !isStructureValid}
          >
            {isSaving
              ? t('common.saving', { defaultValue: 'Saving...' })
              : t('common.save', { defaultValue: 'Save' })}
          </Button>
        </div>
      </div>
    </div>
  );
};
