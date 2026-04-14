import { Button, Input, Text } from '@fluentui/react-components';
import { Add20Regular, Delete16Regular, LockClosed16Regular } from '@fluentui/react-icons';
import * as React from 'react';
import { useTranslation } from 'react-i18next';

import type { PromptTemplate } from '../../../../preload/index';

import styles from './AIFeatures.module.css';

interface TemplateListProps {
  templates: PromptTemplate[];
  activeTemplateId: string;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onCreate: (name: string) => void;
  onDelete: (id: string) => void;
}

export const TemplateList: React.FC<TemplateListProps> = ({
  templates,
  activeTemplateId,
  selectedId,
  onSelect,
  onCreate,
  onDelete,
}) => {
  const { t } = useTranslation();
  const [isCreating, setIsCreating] = React.useState(false);
  const [newName, setNewName] = React.useState('');
  const inputRef = React.useRef<HTMLInputElement>(null);

  const handleCreate = () => {
    if (newName.trim()) {
      onCreate(newName.trim());
      setNewName('');
      setIsCreating(false);
    }
  };

  React.useEffect(() => {
    if (isCreating && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isCreating]);

  return (
    <div className={styles.templateList}>
      {templates.map((template) => {
        const isActive =
          template.id === activeTemplateId || (activeTemplateId === '' && template.isDefault);
        const isSelected = template.id === selectedId;

        return (
          <button
            key={template.id}
            type="button"
            className={`${styles.templateItem} ${isSelected ? styles.templateItemActive : ''}`}
            onClick={() => onSelect(template.id)}
          >
            {template.isDefault && <LockClosed16Regular />}
            <span className={styles.templateItemName}>
              {template.name}
              {isActive && (
                <Text size={100} style={{ color: 'var(--brand-secondary)', marginLeft: 4 }}>
                  (active)
                </Text>
              )}
            </span>
            {!template.isDefault && (
              <span
                className={styles.templateItemDelete}
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(template.id);
                }}
                role="button"
                tabIndex={-1}
              >
                <Delete16Regular />
              </span>
            )}
          </button>
        );
      })}

      {isCreating ? (
        <div className={styles.newTemplateCreateRow}>
          <Input
            ref={inputRef}
            size="small"
            value={newName}
            onChange={(_, d) => setNewName(d.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleCreate();
              if (e.key === 'Escape') {
                setIsCreating(false);
                setNewName('');
              }
            }}
            placeholder="Template name..."
          />
          <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
            <Button
              size="small"
              appearance="subtle"
              onClick={() => {
                setIsCreating(false);
                setNewName('');
              }}
            >
              {t('common.cancel', { defaultValue: 'Cancel' })}
            </Button>
            <Button
              size="small"
              appearance="primary"
              onClick={handleCreate}
              disabled={!newName.trim()}
            >
              {t('common.create', { defaultValue: 'Create' })}
            </Button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          className={`${styles.templateItem} ${styles.newTemplateButton}`}
          onClick={() => setIsCreating(true)}
        >
          <Add20Regular />
          <span className={styles.templateItemName}>
            {t('llm.prompts.new_template', { defaultValue: 'New Template' })}
          </span>
        </button>
      )}
    </div>
  );
};
