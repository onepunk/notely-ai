import { Button, Dropdown, Option } from '@fluentui/react-components';
import * as React from 'react';
import { useTranslation } from 'react-i18next';

import { AVAILABLE_LOCALES, type AvailableLocale, isLocaleAvailable } from '../../../app/i18n';
import { useSettingsStore } from '../../../shared/state/settings.store';

import dropdownStyles from './Dropdown.module.css';
import styles from './PreferencesSettings.module.css';
import { SettingsSection, SettingsTabLayout } from './SettingsTabLayout';

const THEME_KEY = 'system.theme';
const LANGUAGE_KEY = 'app.locale';

const DEFAULT_THEME = 'system';
const DEFAULT_LOCALE: AvailableLocale = 'en';

const LOCALE_LABEL_KEYS: Record<AvailableLocale, string> = {
  en: 'settings.profile.languages.english',
  de: 'settings.profile.languages.german',
  es: 'settings.profile.languages.spanish',
  fr: 'settings.profile.languages.french',
};

export const PreferencesSettings: React.FC = () => {
  const { t, i18n } = useTranslation();
  const values = useSettingsStore((s) => s.values);
  const setValue = useSettingsStore((s) => s.setValue);

  const THEME_OPTIONS: Array<{ value: string; label: string }> = [
    { value: 'system', label: t('settings.system.theme_option.system') },
    { value: 'light', label: t('settings.system.theme_option.light') },
    { value: 'dark', label: t('settings.system.theme_option.dark') },
  ];

  // Theme state
  const themeFromStore = values[THEME_KEY] ?? DEFAULT_THEME;
  const [themeSelection, setThemeSelection] = React.useState(themeFromStore);

  // Language state
  const storedLocale = values[LANGUAGE_KEY] ?? '';
  const languageFromStore: AvailableLocale = isLocaleAvailable(storedLocale)
    ? storedLocale
    : DEFAULT_LOCALE;
  const [languageSelection, setLanguageSelection] =
    React.useState<AvailableLocale>(languageFromStore);

  // Save state
  const [saving, setSaving] = React.useState(false);
  const [saveSuccess, setSaveSuccess] = React.useState(false);

  const isDirty = themeSelection !== themeFromStore || languageSelection !== languageFromStore;

  // Sync store values
  React.useEffect(() => {
    if (!isDirty) {
      setThemeSelection(themeFromStore);
      setLanguageSelection(languageFromStore);
    }
  }, [isDirty, themeFromStore, languageFromStore]);

  // Save handler
  const handleSave = React.useCallback(async () => {
    if (!isDirty) return;
    setSaving(true);
    setSaveSuccess(false);
    try {
      await setValue(THEME_KEY, themeSelection);
      if (languageSelection !== languageFromStore) {
        await setValue(LANGUAGE_KEY, languageSelection);
        await i18n.changeLanguage(languageSelection);
      }
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err) {
      console.error('Failed to save preferences', err);
    } finally {
      setSaving(false);
    }
  }, [isDirty, setValue, themeSelection, languageSelection, languageFromStore, i18n]);

  return (
    <SettingsTabLayout
      title={t('settings.preferences.title')}
      description={t('settings.preferences.description')}
      actions={
        <Button
          size="small"
          appearance="primary"
          onClick={() => void handleSave()}
          disabled={!isDirty || saving}
        >
          {saving ? t('common.saving') : saveSuccess ? t('common.saved') : t('common.save')}
        </Button>
      }
    >
      {/* Appearance */}
      <SettingsSection
        title={t('settings.preferences.appearance')}
        description={t('settings.preferences.appearance_desc')}
      >
        <div className={styles.themeSelector}>
          {THEME_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              className={`${styles.themeOption} ${themeSelection === option.value ? styles.themeSelected : ''}`}
              onClick={() => setThemeSelection(option.value)}
            >
              <span
                className={`${styles.themePreview} ${styles[`theme${option.value.charAt(0).toUpperCase() + option.value.slice(1)}`]}`}
              />
              <span className={styles.themeLabel}>{option.label}</span>
            </button>
          ))}
        </div>
      </SettingsSection>

      {/* Language */}
      <SettingsSection
        title={t('settings.preferences.language')}
        description={t('settings.preferences.language_desc')}
      >
        <Dropdown
          appearance="outline"
          className={`${dropdownStyles.dropdown} ${styles.languageDropdown}`}
          selectedOptions={[languageSelection]}
          onOptionSelect={(_, data) => {
            const val = data.optionValue ?? '';
            if (isLocaleAvailable(val)) {
              setLanguageSelection(val);
            }
          }}
          value={t(LOCALE_LABEL_KEYS[languageSelection])}
        >
          {AVAILABLE_LOCALES.map((locale) => (
            <Option key={locale} value={locale}>
              {t(LOCALE_LABEL_KEYS[locale])}
            </Option>
          ))}
        </Dropdown>
      </SettingsSection>
    </SettingsTabLayout>
  );
};
