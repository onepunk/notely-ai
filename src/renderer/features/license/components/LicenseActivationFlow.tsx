/**
 * License Activation Flow
 *
 * Multi-step dialog for activating na- (Notely AI) licenses with email binding.
 * Steps: License Key Entry → Email Entry → Success
 */

import {
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  DialogTrigger,
  Field,
  Input,
  MessageBar,
  Spinner,
  Text,
} from '@fluentui/react-components';
import { Checkmark24Regular, Dismiss24Regular, Mail24Regular } from '@fluentui/react-icons';
import * as React from 'react';

import styles from './LicenseActivationFlow.module.css';

type ActivationStep = 'key' | 'email' | 'success';

interface ActivationResult {
  success: true;
  activationId: string;
  email: string;
  tierKey: string;
  tierName: string;
  features: Record<string, boolean>;
  offlineToken: string;
  offlineGraceDeadline: string;
  nextRequiredValidation: string | null;
}

interface ActivationError {
  success: false;
  error: {
    code: string;
    message: string;
    existingEmail?: string;
  };
}

export interface LicenseActivationFlowProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onActivationComplete?: () => void;
}

const LICENSE_KEY_REGEX =
  /^NA-[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}$/i;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const LicenseActivationFlow: React.FC<LicenseActivationFlowProps> = ({
  open,
  onOpenChange,
  onActivationComplete,
}) => {
  const [step, setStep] = React.useState<ActivationStep>('key');
  const [licenseKey, setLicenseKey] = React.useState('');
  const [email, setEmail] = React.useState('');
  const [activating, setActivating] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [activationResult, setActivationResult] = React.useState<ActivationResult | null>(null);

  // Reset state when dialog opens/closes
  React.useEffect(() => {
    if (!open) {
      // Delay reset to allow close animation
      const timeout = setTimeout(() => {
        setStep('key');
        setLicenseKey('');
        setEmail('');
        setError(null);
        setActivationResult(null);
      }, 300);
      return () => clearTimeout(timeout);
    }
  }, [open]);

  const validateLicenseKey = (key: string): string | null => {
    const trimmed = key.trim();
    if (!trimmed) {
      return 'Please enter your license key.';
    }
    if (!trimmed.toUpperCase().startsWith('NA-')) {
      return 'Only Notely AI (NA-) license keys are supported for this application.';
    }
    if (!LICENSE_KEY_REGEX.test(trimmed)) {
      return 'Invalid license key format. Please check and try again.';
    }
    return null;
  };

  const validateEmail = (emailInput: string): string | null => {
    const trimmed = emailInput.trim();
    if (!trimmed) {
      return 'Please enter your email address.';
    }
    if (!EMAIL_REGEX.test(trimmed)) {
      return 'Please enter a valid email address.';
    }
    return null;
  };

  const handleKeySubmit = () => {
    const validationError = validateLicenseKey(licenseKey);
    if (validationError) {
      setError(validationError);
      return;
    }
    setError(null);
    setStep('email');
  };

  const handleEmailSubmit = async () => {
    const validationError = validateEmail(email);
    if (validationError) {
      setError(validationError);
      return;
    }

    setError(null);
    setActivating(true);

    try {
      const result = await window.api.license.activate(licenseKey.trim(), email.trim());

      if (result.success === true) {
        setActivationResult(result as ActivationResult);
        setStep('success');
        onActivationComplete?.();
      } else {
        const errorResult = result as ActivationError;
        // Handle specific error codes
        if (errorResult.error.code === 'ACTIVATION_LIMIT') {
          setError(
            errorResult.error.existingEmail
              ? `This license is already activated with ${errorResult.error.existingEmail}. To use a different email, deactivate from the original device first.`
              : errorResult.error.message
          );
        } else {
          setError(errorResult.error.message);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An unexpected error occurred');
    } finally {
      setActivating(false);
    }
  };

  const handleBack = () => {
    setError(null);
    if (step === 'email') {
      setStep('key');
    }
  };

  const handleClose = () => {
    onOpenChange(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent, onSubmit: () => void) => {
    if (e.key === 'Enter' && !activating) {
      e.preventDefault();
      onSubmit();
    }
  };

  return (
    <Dialog open={open} onOpenChange={(_, data) => onOpenChange(data.open)}>
      <DialogSurface className={styles.surface}>
        <DialogBody>
          <DialogTitle
            action={
              <DialogTrigger action="close">
                <Button appearance="subtle" icon={<Dismiss24Regular />} aria-label="Close" />
              </DialogTrigger>
            }
          >
            {step === 'key' && 'Activate License'}
            {step === 'email' && 'Enter Your Email'}
            {step === 'success' && 'Activation Complete'}
          </DialogTitle>

          <DialogContent className={styles.content}>
            {error && (
              <MessageBar intent="error" className={styles.messageBar}>
                {error}
              </MessageBar>
            )}

            {/* Step 1: License Key Entry */}
            {step === 'key' && (
              <div className={styles.stepContainer}>
                <Text className={styles.stepDescription}>
                  Enter your Notely AI license key to activate this device. Your license key was
                  provided in your purchase confirmation email.
                </Text>
                <Field label="License Key" className={styles.field}>
                  <Input
                    value={licenseKey}
                    onChange={(_, data) => setLicenseKey(data.value)}
                    onKeyDown={(e) => handleKeyDown(e, handleKeySubmit)}
                    placeholder="NA-XXXXX-XXXXX-XXXXX-XXXXX"
                    autoFocus
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                  />
                </Field>
              </div>
            )}

            {/* Step 2: Email Entry */}
            {step === 'email' && (
              <div className={styles.stepContainer}>
                <div className={styles.stepIcon}>
                  <Mail24Regular />
                </div>
                <Text className={styles.stepDescription}>
                  Enter the email address associated with your license purchase. This email will be
                  bound to this activation and used for license verification.
                </Text>
                <Field label="Email Address" className={styles.field}>
                  <Input
                    type="email"
                    value={email}
                    onChange={(_, data) => setEmail(data.value)}
                    onKeyDown={(e) => handleKeyDown(e, handleEmailSubmit)}
                    placeholder="you@example.com"
                    autoFocus
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    disabled={activating}
                  />
                </Field>
                {activating && (
                  <div className={styles.activatingIndicator}>
                    <Spinner size="tiny" />
                    <Text size={200}>Activating license...</Text>
                  </div>
                )}
              </div>
            )}

            {/* Step 3: Success */}
            {step === 'success' && activationResult && (
              <div className={styles.stepContainer}>
                <div className={`${styles.stepIcon} ${styles.successIcon}`}>
                  <Checkmark24Regular />
                </div>
                <Text className={styles.successTitle}>License Activated Successfully!</Text>
                <div className={styles.successDetails}>
                  <div className={styles.detailRow}>
                    <Text size={200} className={styles.detailLabel}>
                      Email
                    </Text>
                    <Text>{activationResult.email}</Text>
                  </div>
                  <div className={styles.detailRow}>
                    <Text size={200} className={styles.detailLabel}>
                      Tier
                    </Text>
                    <Text>{activationResult.tierName}</Text>
                  </div>
                  {/* Always show "All" for notely-ai licenses (single license unlocks everything) */}
                  <div className={styles.featuresRow}>
                    <Text size={200} className={styles.detailLabel}>
                      Features
                    </Text>
                    <div className={styles.featureList}>
                      <span className={styles.featureTag}>All</span>
                    </div>
                  </div>
                </div>
                <Text size={200} className={styles.offlineNote}>
                  Your license is now activated. You can use Notely AI both online and offline.
                </Text>
              </div>
            )}
          </DialogContent>

          <DialogActions>
            {step === 'key' && (
              <>
                <DialogTrigger disableButtonEnhancement>
                  <Button appearance="secondary">Cancel</Button>
                </DialogTrigger>
                <Button appearance="primary" onClick={handleKeySubmit}>
                  Continue
                </Button>
              </>
            )}

            {step === 'email' && (
              <>
                <Button appearance="secondary" onClick={handleBack} disabled={activating}>
                  Back
                </Button>
                <Button appearance="primary" onClick={handleEmailSubmit} disabled={activating}>
                  {activating ? 'Activating...' : 'Activate'}
                </Button>
              </>
            )}

            {step === 'success' && (
              <Button appearance="primary" onClick={handleClose}>
                Done
              </Button>
            )}
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
};

LicenseActivationFlow.displayName = 'LicenseActivationFlow';
