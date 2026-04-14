import fs from 'node:fs';
import path from 'node:path';

import { app } from 'electron';
import * as winston from 'winston';
import DailyRotate from 'winston-daily-rotate-file';

export type LogLevel = 'error' | 'warn' | 'info' | 'http' | 'verbose' | 'debug' | 'silly';

function ensureDir(dir: string) {
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (e) {
    /* keep going */
  }
}

let fileTransportAdded = false;
let logDir = '';

const format = winston.format.combine(
  winston.format.timestamp(),
  winston.format.errors({ stack: true }),
  winston.format.splat(),
  winston.format.printf(({ timestamp, level, message, stack, ...meta }) => {
    const base = `${timestamp} [${level}] ${message}`;
    const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
    return stack ? `${base}\n${stack}${metaStr}` : `${base}${metaStr}`;
  })
);

export const logger = winston.createLogger({
  level: process.env.NOTELY_LOG_LEVEL || (app?.isPackaged ? 'info' : 'debug'),
  format,
  transports: [
    new winston.transports.Console({
      level: process.env.NOTELY_CONSOLE_LEVEL || 'info',
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.timestamp(),
        winston.format.printf(({ timestamp, level, message, ...meta }) => {
          // Include metadata for debugging (especially error details)
          const metaKeys = Object.keys(meta).filter(
            (k) => k !== 'level' && k !== 'message' && k !== 'timestamp'
          );
          const metaStr = metaKeys.length > 0 ? `\n  ${JSON.stringify(meta, null, 2)}` : '';
          return `${timestamp} [${level}] ${message}${metaStr}`;
        })
      ),
    }),
  ],
});

export function setLogLevel(level: LogLevel) {
  logger.level = level;
}

export function setupFileLogging() {
  if (fileTransportAdded) return;
  try {
    logDir = app ? path.join(app.getPath('userData'), 'logs') : path.join(process.cwd(), 'logs');
    ensureDir(logDir);
    const rotate = new DailyRotate({
      dirname: logDir,
      filename: 'notely-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      zippedArchive: true,
      maxFiles: '14d',
      maxSize: '10m',
      level: process.env.NOTELY_FILE_LEVEL || 'info',
    });
    logger.add(rotate);
    fileTransportAdded = true;
  } catch (e) {
    // keep console-only if file transport fails
  }
}

export function getLogFileDir() {
  return logDir;
}
