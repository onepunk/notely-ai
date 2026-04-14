import { Button, Text } from '@fluentui/react-components';
import {
  Save20Regular,
  Copy20Regular,
  CheckmarkCircle20Regular,
  ArrowReset20Regular,
} from '@fluentui/react-icons';
import * as React from 'react';
import { useTranslation } from 'react-i18next';

import { SettingsTabLayout } from '../../settings/components/SettingsTabLayout';
import { usePromptTemplates } from '../hooks/usePromptTemplates';

import styles from './AIFeatures.module.css';
import { TemplateList } from './TemplateList';

type SubTab = 'system_prompt' | 'output_structure';

/** Parse outputStructure JSON into extraction and refinement fields. */
const parseOutputStructureFields = (raw: string): { extraction: string; refinement: string } => {
  try {
    const parsed = JSON.parse(raw);
    return {
      extraction: parsed.chunk_extraction ?? '',
      refinement: parsed.refinement ?? '',
    };
  } catch {
    return { extraction: '', refinement: '' };
  }
};

export const PromptsTab: React.FC = () => {
  const { t } = useTranslation();
  const {
    templates,
    activeTemplateId,
    isInitialized,
    createTemplate,
    updateTemplate,
    deleteTemplate,
    setActiveTemplate,
  } = usePromptTemplates();

  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [editedPrompt, setEditedPrompt] = React.useState('');
  const [editedExtraction, setEditedExtraction] = React.useState('');
  const [editedRefinement, setEditedRefinement] = React.useState('');
  const [subTab, setSubTab] = React.useState<SubTab>('system_prompt');
  const [isDirty, setIsDirty] = React.useState(false);

  // Select first template on load
  React.useEffect(() => {
    if (isInitialized && templates.length > 0 && !selectedId) {
      setSelectedId(templates[0].id);
    }
  }, [isInitialized, templates, selectedId]);

  // Load selected template content
  const selectedTemplate = React.useMemo(
    () => templates.find((t) => t.id === selectedId) ?? null,
    [templates, selectedId]
  );

  React.useEffect(() => {
    if (selectedTemplate) {
      setEditedPrompt(selectedTemplate.systemPrompt);
      const fields = parseOutputStructureFields(selectedTemplate.outputStructure);
      setEditedExtraction(fields.extraction);
      setEditedRefinement(fields.refinement);
      setIsDirty(false);
    }
  }, [selectedTemplate?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const isReadOnly = selectedTemplate?.isDefault ?? false;
  const isActive =
    selectedTemplate?.id === activeTemplateId ||
    (activeTemplateId === '' && selectedTemplate?.isDefault);

  const handleSave = async () => {
    if (!selectedId || isReadOnly) return;
    const success = await updateTemplate({
      id: selectedId,
      systemPrompt: editedPrompt,
      outputStructure: JSON.stringify({
        chunk_extraction: editedExtraction,
        refinement: editedRefinement,
      }),
    });
    if (success) {
      setIsDirty(false);
    }
  };

  const handleDiscard = () => {
    if (selectedTemplate) {
      setEditedPrompt(selectedTemplate.systemPrompt);
      const fields = parseOutputStructureFields(selectedTemplate.outputStructure);
      setEditedExtraction(fields.extraction);
      setEditedRefinement(fields.refinement);
      setIsDirty(false);
    }
  };

  const handleClone = async () => {
    if (!selectedId) return;
    const created = await createTemplate({
      name: `${selectedTemplate?.name ?? 'Template'} (Copy)`,
      cloneFromId: selectedId,
    });
    if (created) {
      setSelectedId(created.id);
    }
  };

  const handleCreate = async (name: string) => {
    const created = await createTemplate({ name });
    if (created) {
      setSelectedId(created.id);
    }
  };

  const handleDelete = async (id: string) => {
    await deleteTemplate(id);
    if (selectedId === id) {
      const remaining = templates.filter((t) => t.id !== id);
      setSelectedId(remaining.length > 0 ? remaining[0].id : null);
    }
  };

  const handleSetActive = async () => {
    if (!selectedId) return;
    // If selecting default, set to empty string
    const idToSet = selectedTemplate?.isDefault ? '' : selectedId;
    await setActiveTemplate(idToSet);
  };

  return (
    <SettingsTabLayout
      title={t('llm.prompts.title', { defaultValue: 'Prompts' })}
      description={t('llm.prompts.description', {
        defaultValue: 'Manage prompt templates for AI summary generation.',
      })}
    >
      <div className={styles.promptsLayout}>
        {/* Left sidebar: Template list */}
        <TemplateList
          templates={templates}
          activeTemplateId={activeTemplateId}
          selectedId={selectedId}
          onSelect={(id) => {
            if (isDirty) {
              // Could add a confirm dialog here, but for now just switch
            }
            setSelectedId(id);
          }}
          onCreate={handleCreate}
          onDelete={handleDelete}
        />

        {/* Right content: Template editor */}
        <div className={styles.templateEditor}>
          {selectedTemplate ? (
            <>
              <div className={styles.templateEditorHeader}>
                <Text weight="semibold" size={400}>
                  {selectedTemplate.name}
                </Text>
                <div className={styles.templateEditorActions}>
                  {!isActive && (
                    <Button
                      size="small"
                      appearance="primary"
                      icon={<CheckmarkCircle20Regular />}
                      onClick={handleSetActive}
                    >
                      {t('llm.prompts.set_active', { defaultValue: 'Set as Active' })}
                    </Button>
                  )}
                  {isActive && (
                    <Text size={200} style={{ color: 'var(--brand-secondary)', fontWeight: 600 }}>
                      Active Template
                    </Text>
                  )}
                  <Button
                    size="small"
                    appearance="subtle"
                    icon={<Copy20Regular />}
                    onClick={handleClone}
                  >
                    {t('llm.prompts.clone', { defaultValue: 'Clone' })}
                  </Button>
                </div>
              </div>

              {/* Sub-tabs for System Prompt / Output Structure */}
              <div className={styles.promptSubTabs}>
                <button
                  type="button"
                  className={`${styles.promptSubTab} ${subTab === 'system_prompt' ? styles.promptSubTabActive : ''}`}
                  onClick={() => setSubTab('system_prompt')}
                >
                  {t('llm.prompts.system_prompt', { defaultValue: 'System Prompt' })}
                </button>
                <button
                  type="button"
                  className={`${styles.promptSubTab} ${subTab === 'output_structure' ? styles.promptSubTabActive : ''}`}
                  onClick={() => setSubTab('output_structure')}
                >
                  {t('llm.prompts.output_structure', { defaultValue: 'Output Structure' })}
                </button>
              </div>

              {subTab === 'system_prompt' && (
                <div className={styles.promptFieldGroup}>
                  <Text size={200} className={styles.promptTextareaLabel}>
                    {t('llm.prompts.system_prompt_label', {
                      defaultValue:
                        'Instructions sent to the AI before the transcript. Leave empty to use defaults.',
                    })}
                  </Text>
                  <textarea
                    className={styles.promptTextarea}
                    value={editedPrompt}
                    onChange={(e) => {
                      setEditedPrompt(e.target.value);
                      setIsDirty(true);
                    }}
                    disabled={isReadOnly}
                    placeholder={
                      isReadOnly
                        ? 'Default system prompt (managed by the AI backend)'
                        : 'Enter your custom system prompt...'
                    }
                    rows={8}
                  />
                </div>
              )}

              {subTab === 'output_structure' && (
                <div className={styles.promptSectionsContainer}>
                  <div className={styles.promptSection}>
                    <Text weight="semibold" size={300} className={styles.promptSectionHeader}>
                      {t('llm.prompts.step1_heading', {
                        defaultValue: 'Step 1: Data Extraction',
                      })}
                    </Text>
                    <Text size={200} className={styles.promptSectionDescription}>
                      {t('llm.prompts.step1_description', {
                        defaultValue:
                          'Instructions for extracting structured data from each transcript chunk.',
                      })}
                    </Text>
                    <textarea
                      className={styles.promptTextarea}
                      value={editedExtraction}
                      onChange={(e) => {
                        setEditedExtraction(e.target.value);
                        setIsDirty(true);
                      }}
                      disabled={isReadOnly}
                      placeholder={
                        isReadOnly
                          ? 'Default extraction prompt (managed by the AI backend)'
                          : 'Enter instructions for extracting data from transcript chunks...'
                      }
                      rows={8}
                    />
                  </div>

                  <div className={styles.promptSection}>
                    <Text weight="semibold" size={300} className={styles.promptSectionHeader}>
                      {t('llm.prompts.step2_heading', {
                        defaultValue: 'Step 2: Final Summary',
                      })}
                    </Text>
                    <Text size={200} className={styles.promptSectionDescription}>
                      {t('llm.prompts.step2_description', {
                        defaultValue:
                          'Instructions for producing the final polished summary from extracted data.',
                      })}
                    </Text>
                    <textarea
                      className={styles.promptTextarea}
                      value={editedRefinement}
                      onChange={(e) => {
                        setEditedRefinement(e.target.value);
                        setIsDirty(true);
                      }}
                      disabled={isReadOnly}
                      placeholder={
                        isReadOnly
                          ? 'Default refinement prompt (managed by the AI backend)'
                          : 'Enter instructions for producing the final summary...'
                      }
                      rows={8}
                    />
                  </div>

                  <Text size={200} className={styles.promptPlaceholderHint}>
                    {t('llm.prompts.placeholder_hint', {
                      defaultValue:
                        'Placeholders: {base_prompt} inserts your system prompt. {text} is replaced with the transcript or extracted data.',
                    })}
                  </Text>
                </div>
              )}

              {/* Save / Discard buttons for custom templates */}
              {!isReadOnly && (
                <div className={styles.settingsActions}>
                  <Button
                    appearance="primary"
                    icon={<Save20Regular />}
                    onClick={handleSave}
                    disabled={!isDirty}
                  >
                    {t('common.save', { defaultValue: 'Save' })}
                  </Button>
                  {isDirty && (
                    <Button
                      appearance="subtle"
                      icon={<ArrowReset20Regular />}
                      onClick={handleDiscard}
                    >
                      {t('common.discard', { defaultValue: 'Discard' })}
                    </Button>
                  )}
                </div>
              )}
            </>
          ) : (
            <div style={{ padding: 24, textAlign: 'center' }}>
              <Text className={styles.noModel}>
                {t('llm.prompts.no_selection', {
                  defaultValue: 'Select a template from the list or create a new one.',
                })}
              </Text>
            </div>
          )}
        </div>
      </div>
    </SettingsTabLayout>
  );
};
