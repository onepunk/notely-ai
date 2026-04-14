import {
  Dialog,
  DialogSurface,
  DialogBody,
  DialogContent,
  Button,
} from '@fluentui/react-components';
import { Dismiss20Regular } from '@fluentui/react-icons';
import * as React from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';

import { useSettingsStore } from '../../../shared/state/settings.store';
import { SystemTab } from '../../ai-features/components/SystemTab';
import { AboutSettings } from '../components/AboutSettings';
import { AudioSettings } from '../components/AudioSettings';
import { PreferencesSettings } from '../components/PreferencesSettings';
import { SecuritySettings } from '../components/SecuritySettings';

import styles from './SettingsModal.module.css';
import layoutStyles from './SystemSettingsLayout.module.css';

const NavItem: React.FC<{ active: boolean; onClick: () => void; children: React.ReactNode }> = ({
  active,
  onClick,
  children,
}) => (
  <button
    type="button"
    onClick={onClick}
    className={`${layoutStyles.navItem} ${active ? layoutStyles.navItemActive : ''}`}
  >
    {children}
  </button>
);

type SettingsSection = 'system' | 'preferences' | 'audio' | 'security' | 'about';

export const SettingsModal: React.FC = () => {
  const navigate = useNavigate();
  const { section } = useParams();
  const { t } = useTranslation();
  const close = () => navigate('/');
  const hydrated = useSettingsStore((s) => s.hydrated);
  const hydrate = useSettingsStore((s) => s.hydrate);
  const onRemoteChange = useSettingsStore((s) => s.onRemoteChange);

  const sections: Array<{ key: SettingsSection; label: string }> = React.useMemo(
    () => [
      { key: 'system', label: t('llm.tabs.system', { defaultValue: 'System' }) },
      { key: 'preferences', label: t('settings.tabs.preferences') },
      { key: 'audio', label: t('settings.tabs.audio') },
      { key: 'security', label: t('settings.tabs.security') },
      { key: 'about', label: t('common.about') },
    ],
    [t]
  );

  const activeSection: SettingsSection = React.useMemo(() => {
    const candidate = (section as SettingsSection | undefined) ?? 'system';
    const isValid = sections.some((entry) => entry.key === candidate);
    return isValid ? candidate : 'system';
  }, [section, sections]);

  React.useEffect(() => {
    if (!hydrated) void hydrate();
    const subscribe =
      typeof window.api?.onSettingsChanged === 'function' ? window.api.onSettingsChanged : null;
    const off = subscribe ? subscribe((key, value) => onRemoteChange(key, value)) : () => {};
    return () => {
      try {
        off();
      } catch (error) {
        console.warn('Failed to unsubscribe from settings changes:', error);
      }
    };
  }, [hydrate, hydrated, onRemoteChange]);

  return (
    <Dialog
      open
      onOpenChange={(_, d) => {
        if (!d.open) close();
      }}
    >
      <DialogSurface className={styles['wide-dialog']}>
        <DialogBody className={styles['dialog-body']}>
          <Button
            appearance="transparent"
            size="small"
            className={styles['close-button']}
            onClick={close}
            aria-label="Close"
          >
            <Dismiss20Regular />
          </Button>
          {/* Title removed for cleaner modal appearance */}
          <DialogContent className={styles['content-area']} style={{ overflow: 'hidden' }}>
            <div className={layoutStyles.layout}>
              <nav className={layoutStyles.navBar}>
                {sections.map((entry) => (
                  <NavItem
                    key={entry.key}
                    active={activeSection === entry.key}
                    onClick={() => navigate(`/settings/${entry.key}`)}
                  >
                    {entry.label}
                  </NavItem>
                ))}
              </nav>
              <div className={layoutStyles['content-shell']}>
                <div className={layoutStyles['content-scroll']}>
                  {activeSection === 'system' && (
                    <div>
                      <SystemTab />
                    </div>
                  )}
                  {activeSection === 'preferences' && (
                    <div>
                      <PreferencesSettings />
                    </div>
                  )}
                  {activeSection === 'audio' && (
                    <div>
                      <AudioSettings />
                    </div>
                  )}
                  {activeSection === 'security' && (
                    <div>
                      <SecuritySettings />
                    </div>
                  )}
                  {activeSection === 'about' && (
                    <div>
                      <AboutSettings />
                    </div>
                  )}
                </div>
              </div>
            </div>
          </DialogContent>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
};
