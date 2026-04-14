/**
 * Offline Grace Warning
 *
 * Shows a warning banner when the user's offline grace period is approaching
 * or has expired. Prompts user to reconnect to revalidate their license.
 */

import { Button, MessageBar, MessageBarBody, MessageBarActions } from '@fluentui/react-components';
import { Warning24Regular } from '@fluentui/react-icons';
import * as React from 'react';

export interface OfflineGraceWarningProps {
  offlineGraceDeadline: string | null;
  onRevalidate: () => void;
  revalidating?: boolean;
  className?: string;
}

export const OfflineGraceWarning: React.FC<OfflineGraceWarningProps> = ({
  offlineGraceDeadline,
  onRevalidate,
  revalidating = false,
  className,
}) => {
  const [daysRemaining, setDaysRemaining] = React.useState<number | null>(null);
  const [isExpired, setIsExpired] = React.useState(false);

  React.useEffect(() => {
    if (!offlineGraceDeadline) {
      setDaysRemaining(null);
      setIsExpired(false);
      return;
    }

    const deadline = new Date(offlineGraceDeadline);
    const now = new Date();
    const diffMs = deadline.getTime() - now.getTime();
    const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays <= 0) {
      setIsExpired(true);
      setDaysRemaining(0);
    } else {
      setIsExpired(false);
      setDaysRemaining(diffDays);
    }
  }, [offlineGraceDeadline]);

  // Don't show warning if grace period is null or more than 7 days remaining
  if (daysRemaining === null || (daysRemaining > 7 && !isExpired)) {
    return null;
  }

  const intent = isExpired ? 'error' : daysRemaining <= 3 ? 'warning' : 'info';

  const getMessage = () => {
    if (isExpired) {
      return 'Your offline grace period has expired. Please connect to the internet to continue using Notely AI.';
    }
    if (daysRemaining === 1) {
      return 'Your offline grace period expires tomorrow. Please connect to the internet to revalidate your license.';
    }
    return `Your offline grace period expires in ${daysRemaining} days. Please connect to revalidate your license.`;
  };

  return (
    <MessageBar intent={intent} icon={<Warning24Regular />} className={className}>
      <MessageBarBody>{getMessage()}</MessageBarBody>
      <MessageBarActions>
        <Button size="small" onClick={onRevalidate} disabled={revalidating}>
          {revalidating ? 'Checking...' : 'Check Now'}
        </Button>
      </MessageBarActions>
    </MessageBar>
  );
};

OfflineGraceWarning.displayName = 'OfflineGraceWarning';
