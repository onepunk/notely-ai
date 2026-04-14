import {
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Spinner,
} from '@fluentui/react-components';
import { ArrowSync24Regular, CloudArrowUp24Regular, Folder24Regular } from '@fluentui/react-icons';
import * as React from 'react';

export interface EntityCounts {
  binders: number;
  notes: number;
  transcriptions: number;
  summaries: number;
  total: number;
}

export interface MergeSyncPromptProps {
  open: boolean;
  serverUrl: string;
  localCounts: EntityCounts | null;
  serverCounts: EntityCounts | null;
  loading: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

const formatServerName = (url: string): string => {
  try {
    const parsed = new URL(url);
    if (parsed.hostname.includes('yourdomain.com')) {
      return 'Notely Cloud';
    }
    return parsed.hostname;
  } catch {
    return 'Server';
  }
};

export const MergeSyncPrompt: React.FC<MergeSyncPromptProps> = ({
  open,
  serverUrl,
  localCounts,
  serverCounts,
  loading,
  onConfirm,
  onCancel,
}) => {
  const serverName = formatServerName(serverUrl);

  return (
    <Dialog open={open} modalType="modal">
      <DialogSurface style={{ maxWidth: '480px' }}>
        <DialogBody>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
            <ArrowSync24Regular style={{ color: 'var(--colorBrandForeground1)' }} />
            <DialogTitle style={{ margin: 0 }}>Connecting to {serverName}</DialogTitle>
          </div>

          <DialogContent style={{ paddingTop: '16px' }}>
            {loading ? (
              <div style={{ display: 'flex', justifyContent: 'center', padding: '32px' }}>
                <Spinner size="medium" label="Loading sync information..." />
              </div>
            ) : (
              <>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr',
                    gap: '16px',
                    marginBottom: '24px',
                  }}
                >
                  {/* Local Notes Card */}
                  <div
                    style={{
                      padding: '16px',
                      borderRadius: '8px',
                      backgroundColor: 'var(--colorNeutralBackground3)',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        marginBottom: '8px',
                      }}
                    >
                      <Folder24Regular />
                      <span style={{ fontWeight: 600 }}>Local</span>
                    </div>
                    <div style={{ fontSize: '24px', fontWeight: 700 }}>
                      {localCounts?.notes ?? 0}
                    </div>
                    <div style={{ fontSize: '12px', color: 'var(--colorNeutralForeground3)' }}>
                      notes
                    </div>
                    {localCounts && localCounts.binders > 0 && (
                      <div
                        style={{
                          fontSize: '12px',
                          color: 'var(--colorNeutralForeground3)',
                          marginTop: '4px',
                        }}
                      >
                        {localCounts.binders} binders
                      </div>
                    )}
                  </div>

                  {/* Server Notes Card */}
                  <div
                    style={{
                      padding: '16px',
                      borderRadius: '8px',
                      backgroundColor: 'var(--colorNeutralBackground3)',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        marginBottom: '8px',
                      }}
                    >
                      <CloudArrowUp24Regular />
                      <span style={{ fontWeight: 600 }}>Server</span>
                    </div>
                    <div style={{ fontSize: '24px', fontWeight: 700 }}>
                      {serverCounts?.notes ?? 0}
                    </div>
                    <div style={{ fontSize: '12px', color: 'var(--colorNeutralForeground3)' }}>
                      notes
                    </div>
                    {serverCounts && serverCounts.binders > 0 && (
                      <div
                        style={{
                          fontSize: '12px',
                          color: 'var(--colorNeutralForeground3)',
                          marginTop: '4px',
                        }}
                      >
                        {serverCounts.binders} binders
                      </div>
                    )}
                  </div>
                </div>

                <div
                  style={{
                    padding: '12px 16px',
                    borderRadius: '8px',
                    backgroundColor: 'var(--colorNeutralBackground2)',
                    marginBottom: '16px',
                  }}
                >
                  <p style={{ margin: 0, fontSize: '14px' }}>
                    All notes will be merged and synced. Your local notes will be uploaded to the
                    server, and server notes will be downloaded.
                  </p>
                </div>
              </>
            )}
          </DialogContent>

          <DialogActions>
            <Button appearance="secondary" onClick={onCancel} disabled={loading}>
              Cancel
            </Button>
            <Button appearance="primary" onClick={onConfirm} disabled={loading}>
              Merge & Continue
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
};

MergeSyncPrompt.displayName = 'MergeSyncPrompt';
