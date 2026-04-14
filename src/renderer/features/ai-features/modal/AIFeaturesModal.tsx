import {
  Dialog,
  DialogSurface,
  DialogBody,
  DialogContent,
  Button,
  Text,
} from '@fluentui/react-components';
import { Dismiss20Regular } from '@fluentui/react-icons';
import * as React from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';

import { useFeature } from '../../../shared/components/FeatureGate';
import { LicenseActivationFlow } from '../../license/components/LicenseActivationFlow';
import { SettingsSection, SettingsTabLayout } from '../../settings/components/SettingsTabLayout';
import layoutStyles from '../../settings/modal/SystemSettingsLayout.module.css';
import { ModelManagementTab } from '../components/ModelManagementTab';
import { ModelSettingsTab } from '../components/ModelSettingsTab';
import { PromptsTab } from '../components/PromptsTab';

import modalStyles from './AIFeaturesModal.module.css';

type AIFeaturesSection = 'model-management' | 'model-settings' | 'prompts';

const LOCAL_AI_FEATURE = 'local-ai';

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

export const AIFeaturesModal: React.FC = () => {
  const navigate = useNavigate();
  const { section } = useParams();
  const { t } = useTranslation();
  const close = () => navigate('/');

  const hasLocalAIFeature = useFeature(LOCAL_AI_FEATURE);

  const sections: Array<{ key: AIFeaturesSection; label: string }> = React.useMemo(
    () => [
      {
        key: 'model-management',
        label: t('llm.tabs.model_management', { defaultValue: 'Model Management' }),
      },
      {
        key: 'model-settings',
        label: t('llm.tabs.model_settings', { defaultValue: 'Model Settings' }),
      },
      { key: 'prompts', label: t('llm.tabs.prompts', { defaultValue: 'Prompts' }) },
    ],
    [t]
  );

  const activeSection: AIFeaturesSection = React.useMemo(() => {
    const candidate = (section as AIFeaturesSection | undefined) ?? 'model-management';
    const isValid = sections.some((entry) => entry.key === candidate);
    return isValid ? candidate : 'model-management';
  }, [section, sections]);

  const [showActivationFlow, setShowActivationFlow] = React.useState(false);

  // License gate check
  if (!hasLocalAIFeature) {
    return (
      <Dialog
        open
        onOpenChange={(_, d) => {
          if (!d.open) close();
        }}
      >
        <DialogSurface className={modalStyles['wide-dialog']}>
          <DialogBody className={modalStyles['dialog-body']}>
            <Button
              appearance="transparent"
              size="small"
              className={modalStyles['close-button']}
              onClick={close}
              aria-label="Close"
            >
              <Dismiss20Regular />
            </Button>
            <DialogContent className={modalStyles['content-area']}>
              <div style={{ padding: 24 }}>
                <SettingsTabLayout title={t('llm.settings.title', { defaultValue: 'AI Features' })}>
                  <SettingsSection
                    title={t('llm.license.required_title', {
                      defaultValue: 'License Required',
                    })}
                  >
                    <div
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        gap: 4,
                        padding: 16,
                        background: 'var(--bg-subtle)',
                        border: '1px solid var(--stroke)',
                        borderRadius: 8,
                        textAlign: 'center',
                      }}
                    >
                      <Text weight="semibold">
                        {t('llm.license.activate_title', {
                          defaultValue: 'Activate Your License',
                        })}
                      </Text>
                      <Text
                        size={200}
                        style={{
                          color: 'var(--text-secondary)',
                          lineHeight: 1.5,
                        }}
                      >
                        {t('llm.license.activate_desc', {
                          defaultValue:
                            'To access AI features, please activate your Notely AI license.',
                        })}
                      </Text>
                      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                        <Button appearance="primary" onClick={() => setShowActivationFlow(true)}>
                          {t('settings.activation.activate', { defaultValue: 'Activate' })}
                        </Button>
                        <Button
                          appearance="secondary"
                          onClick={() =>
                            window.api.window.openExternal('https://yourdomain.com/ai/purchase')
                          }
                        >
                          {t('settings.activation.purchase', { defaultValue: 'Purchase' })}
                        </Button>
                      </div>
                    </div>
                  </SettingsSection>
                </SettingsTabLayout>
              </div>
            </DialogContent>

            <LicenseActivationFlow open={showActivationFlow} onOpenChange={setShowActivationFlow} />
          </DialogBody>
        </DialogSurface>
      </Dialog>
    );
  }

  return (
    <Dialog
      open
      onOpenChange={(_, d) => {
        if (!d.open) close();
      }}
    >
      <DialogSurface className={modalStyles['wide-dialog']}>
        <DialogBody className={modalStyles['dialog-body']}>
          <Button
            appearance="transparent"
            size="small"
            className={modalStyles['close-button']}
            onClick={close}
            aria-label="Close"
          >
            <Dismiss20Regular />
          </Button>
          <DialogContent className={modalStyles['content-area']}>
            <div className={layoutStyles.layout}>
              <nav className={layoutStyles.navBar}>
                {sections.map((entry) => (
                  <NavItem
                    key={entry.key}
                    active={activeSection === entry.key}
                    onClick={() => navigate(`/ai-features/${entry.key}`)}
                  >
                    {entry.label}
                  </NavItem>
                ))}
              </nav>
              <div className={layoutStyles['content-shell']}>
                <div className={layoutStyles['content-scroll']}>
                  {activeSection === 'model-management' && <ModelManagementTab />}
                  {activeSection === 'model-settings' && <ModelSettingsTab />}
                  {activeSection === 'prompts' && <PromptsTab />}
                </div>
              </div>
            </div>
          </DialogContent>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
};
