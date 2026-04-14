import { Button, Input, Spinner, Text } from '@fluentui/react-components';
import {
  ArrowDownload20Regular,
  Info16Regular,
  Dismiss16Regular,
  Warning16Regular,
} from '@fluentui/react-icons';
import * as React from 'react';
import { useTranslation } from 'react-i18next';

import type { HuggingFaceRepoFile } from '../../../../preload/index';
import { useLLMStore } from '../model/llm.store';

import styles from './CustomModelImport.module.css';

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

export const CustomModelImport: React.FC = () => {
  const { t } = useTranslation();
  const [urlInput, setUrlInput] = React.useState('');
  const [downloadingFiles, setDownloadingFiles] = React.useState<Set<string>>(new Set());

  const urlParseState = useLLMStore((state) => state.urlParseState);
  const parseHuggingFaceUrl = useLLMStore((state) => state.parseHuggingFaceUrl);
  const clearUrlParseState = useLLMStore((state) => state.clearUrlParseState);
  const downloadCustomModel = useLLMStore((state) => state.downloadCustomModel);
  const gpuInfo = useLLMStore((state) => state.gpuInfo);

  const vramBytes = (gpuInfo?.vramMB ?? 0) * 1024 * 1024;

  const handleParse = React.useCallback(async () => {
    const trimmed = urlInput.trim();
    if (!trimmed) return;
    await parseHuggingFaceUrl(trimmed);
  }, [urlInput, parseHuggingFaceUrl]);

  const handleClear = React.useCallback(() => {
    setUrlInput('');
    clearUrlParseState();
  }, [clearUrlParseState]);

  const handleDownloadDirect = React.useCallback(async () => {
    const result = urlParseState.result;
    if (!result?.downloadUrl || !result.filename) return;

    const filename = result.filename;
    setDownloadingFiles((prev) => new Set(prev).add(filename));
    try {
      const modelId = `custom-${filename
        .replace('.gguf', '')
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, '-')}`;
      await downloadCustomModel({
        url: result.downloadUrl,
        filename,
        modelId,
        repo: result.repo,
        name: filename.replace('.gguf', ''),
      });
    } catch (error) {
      console.error('Download failed:', error);
    } finally {
      setDownloadingFiles((prev) => {
        const next = new Set(prev);
        next.delete(filename);
        return next;
      });
    }
  }, [urlParseState.result, downloadCustomModel]);

  const handleDownloadFile = React.useCallback(
    async (file: HuggingFaceRepoFile) => {
      const result = urlParseState.result;
      if (!result) return;

      setDownloadingFiles((prev) => new Set(prev).add(file.filename));
      try {
        const modelId = `custom-${file.filename
          .replace('.gguf', '')
          .toLowerCase()
          .replace(/[^a-z0-9-]/g, '-')}`;
        await downloadCustomModel({
          url: file.downloadUrl,
          filename: file.filename,
          modelId,
          repo: result.repo,
          name: file.filename.replace('.gguf', ''),
        });
      } catch (error) {
        console.error('Download failed:', error);
      } finally {
        setDownloadingFiles((prev) => {
          const next = new Set(prev);
          next.delete(file.filename);
          return next;
        });
      }
    },
    [urlParseState.result, downloadCustomModel]
  );

  const handleKeyDown = React.useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        handleParse();
      }
    },
    [handleParse]
  );

  return (
    <div className={styles.container}>
      {/* URL Input */}
      <div className={styles.inputRow}>
        <Input
          className={styles.urlInput}
          appearance="filled-darker"
          value={urlInput}
          onChange={(_, data) => setUrlInput(data.value)}
          onKeyDown={handleKeyDown}
          placeholder={t('llm.custom.url_placeholder', {
            defaultValue: 'https://huggingface.co/org/model/resolve/main/model.gguf',
          })}
          disabled={urlParseState.parsing || downloadingFiles.size > 0}
        />
        {urlParseState.result ? (
          <Button
            appearance="subtle"
            icon={<Dismiss16Regular />}
            onClick={handleClear}
            disabled={downloadingFiles.size > 0}
          >
            {t('common.clear', { defaultValue: 'Clear' })}
          </Button>
        ) : (
          <Button
            appearance="primary"
            onClick={handleParse}
            disabled={!urlInput.trim() || urlParseState.parsing}
          >
            {urlParseState.parsing ? (
              <Spinner size="tiny" />
            ) : (
              t('llm.custom.parse', { defaultValue: 'Check URL' })
            )}
          </Button>
        )}
      </div>

      {/* GGUF Notice */}
      <div className={styles.notice}>
        <Info16Regular className={styles.noticeIcon} />
        <Text size={200}>
          {t('llm.custom.gguf_notice', {
            defaultValue:
              'Only GGUF format models are supported. Find compatible models on huggingface.co by searching for "GGUF" in the model name.',
          })}
        </Text>
      </div>

      {/* Error */}
      {urlParseState.error && (
        <Text size={200} className={styles.errorMessage}>
          {urlParseState.error}
        </Text>
      )}

      {/* Parse Result - Direct File */}
      {urlParseState.result && !urlParseState.result.isRepoUrl && urlParseState.result.filename && (
        <div className={styles.parseResult}>
          <div className={styles.parseHeader}>
            <Text weight="semibold">
              {t('llm.custom.ready_to_download', { defaultValue: 'Ready to download' })}
            </Text>
          </div>
          <div className={styles.directFile}>
            <Text size={200} className={styles.repoName}>
              {urlParseState.result.repo}
            </Text>
            <Text size={200}>/</Text>
            <Text weight="semibold" size={200}>
              {urlParseState.result.filename}
            </Text>
          </div>
          {(() => {
            const isFileDownloading = downloadingFiles.has(urlParseState.result!.filename!);
            return (
              <Button
                appearance="primary"
                icon={isFileDownloading ? <Spinner size="tiny" /> : <ArrowDownload20Regular />}
                onClick={handleDownloadDirect}
                disabled={isFileDownloading}
              >
                {isFileDownloading
                  ? t('llm.custom.downloading', { defaultValue: 'Downloading...' })
                  : t('llm.custom.download', { defaultValue: 'Download' })}
              </Button>
            );
          })()}
        </div>
      )}

      {/* Parse Result - Repo with file list */}
      {urlParseState.result &&
        urlParseState.result.isRepoUrl &&
        urlParseState.result.ggufFiles &&
        urlParseState.result.ggufFiles.length > 0 && (
          <div className={styles.parseResult}>
            <div className={styles.parseHeader}>
              <Text weight="semibold">
                {t('llm.custom.select_file', {
                  defaultValue: 'Select a GGUF file to download',
                })}
              </Text>
              <Text size={200} className={styles.repoName}>
                {urlParseState.result.repo}
              </Text>
            </div>
            <div className={styles.fileList}>
              {urlParseState.result.ggufFiles.map((file) => {
                const tooLarge = vramBytes > 0 && file.size > vramBytes;
                const isFileDownloading = downloadingFiles.has(file.filename);
                return (
                  <div
                    key={file.filename}
                    className={`${styles.fileItem} ${tooLarge ? styles.fileItemIncompatible : ''}`}
                  >
                    <div className={styles.fileInfo}>
                      <Text size={200} className={styles.fileName}>
                        {file.filename}
                      </Text>
                      <Text
                        size={100}
                        className={tooLarge ? styles.fileSizeError : styles.fileSize}
                      >
                        {formatBytes(file.size)}
                        {tooLarge &&
                          ` — ${t('llm.custom.exceeds_vram', {
                            defaultValue: 'Exceeds available VRAM ({{vram}})',
                            vram: formatBytes(vramBytes),
                          })}`}
                      </Text>
                    </div>
                    {tooLarge ? (
                      <div className={styles.incompatibleLabel}>
                        <Warning16Regular className={styles.incompatibleIcon} />
                        <Text size={200}>
                          {t('llm.custom.unsupported', { defaultValue: 'Unsupported' })}
                        </Text>
                      </div>
                    ) : (
                      <Button
                        size="small"
                        appearance="primary"
                        icon={
                          isFileDownloading ? <Spinner size="tiny" /> : <ArrowDownload20Regular />
                        }
                        onClick={() => handleDownloadFile(file)}
                        disabled={isFileDownloading}
                      >
                        {isFileDownloading
                          ? t('llm.custom.queued', { defaultValue: 'Queued...' })
                          : t('llm.custom.download', { defaultValue: 'Download' })}
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
    </div>
  );
};
