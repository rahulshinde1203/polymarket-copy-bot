import fs from 'fs';
import path from 'path';
import { createLogger, format, transports } from 'winston';
import { env } from './env';
import { LOG_FILE_PATH } from './constants';

const logsDir = path.dirname(LOG_FILE_PATH);
fs.mkdirSync(logsDir, { recursive: true });

const { combine, timestamp, printf, colorize, errors, json } = format;

const consoleFormat = combine(
  colorize(),
  errors({ stack: true }),
  timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  printf(({ level, message, timestamp, stack }) =>
    stack
      ? `${timestamp} [${level}]: ${message}\n${stack}`
      : `${timestamp} [${level}]: ${message}`,
  ),
);

const fileFormat = combine(
  errors({ stack: true }),
  timestamp(),
  json(),
);

const logger = createLogger({
  level: env.LOG_LEVEL,
  transports: [
    new transports.Console({ format: consoleFormat }),
    new transports.File({
      filename: LOG_FILE_PATH,
      format: fileFormat,
      maxsize: 10 * 1024 * 1024, // 10 MB
      maxFiles: 5,
      tailable: true,
    }),
  ],
});

export default logger;
