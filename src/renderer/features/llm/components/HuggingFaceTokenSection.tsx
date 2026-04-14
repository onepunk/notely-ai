import { Button, Input, Text } from '@fluentui/react-components';
import { Checkmark16Filled, Key20Regular } from '@fluentui/react-icons';
import * as React from 'react';
import { useTranslation } from 'react-i18next';

import { useLLMStore } from '../model/llm.store';

import styles from './HuggingFaceTokenSection.module.css';

export const HuggingFaceTokenSection: React.FC = () => {
  const { t } = useTranslation();
  const [hfToken, setHfToken] = React.useState('');
  const [showInput, setShowInput] = React.useState(false);
  const [saving, setSaving] = React.useState(false);

  const hasHuggingFaceToken = useLLMStore((state) => state.hasHuggingFaceToken);
  const huggingFaceUser = useLLMStore((state) => state.huggingFaceUser);
  const setHuggingFaceToken = useLLMStore((state) => state.setHuggingFaceToken);
  const clearHuggingFaceToken = useLLMStore((state) => state.clearHuggingFaceToken);

  const handleSave = React.useCallback(async () => {
    if (!hfToken.trim()) return;
    setSaving(true);
    try {
      await setHuggingFaceToken(hfToken.trim());
      setHfToken('');
      setShowInput(false);
    } catch (error) {
      console.error('Failed to save HuggingFace token:', error);
    } finally {
      setSaving(false);
    }
  }, [hfToken, setHuggingFaceToken]);

  const handleKeyDown = React.useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        handleSave();
      }
    },
    [handleSave]
  );

  if (hasHuggingFaceToken) {
    return (
      <div className={styles.connected}>
        <Checkmark16Filled className={styles.connectedIcon} />
        <Text>
          {huggingFaceUser?.name
            ? t('llm.settings.connected_as', {
                defaultValue: 'Connected as {{name}}',
                name: huggingFaceUser.name,
              })
            : t('llm.settings.token_set', { defaultValue: 'Token configured' })}
        </Text>
        <Button size="small" appearance="subtle" onClick={() => clearHuggingFaceToken()}>
          {t('llm.settings.clear_token', { defaultValue: 'Clear Token' })}
        </Button>
      </div>
    );
  }

  if (showInput) {
    return (
      <div className={styles.inputRow}>
        <Input
          type="password"
          value={hfToken}
          onChange={(_, data) => setHfToken(data.value)}
          onKeyDown={handleKeyDown}
          placeholder={t('llm.settings.token_placeholder', { defaultValue: 'hf_...' })}
          contentBefore={<Key20Regular />}
          className={styles.inputField}
        />
        <Button appearance="primary" onClick={handleSave} disabled={!hfToken.trim() || saving}>
          {saving
            ? t('common.saving', { defaultValue: 'Saving...' })
            : t('common.save', { defaultValue: 'Save' })}
        </Button>
        <Button appearance="subtle" onClick={() => setShowInput(false)}>
          {t('common.cancel', { defaultValue: 'Cancel' })}
        </Button>
      </div>
    );
  }

  return (
    <div>
      <Button appearance="primary" onClick={() => setShowInput(true)}>
        {t('llm.settings.add_token', { defaultValue: 'Add Token' })}
      </Button>
    </div>
  );
};
