import path from 'node:path';

export const ROOT_DIR = path.resolve(import.meta.dirname, '..');

// Absence-point rules (BR-47). Constants in code, not admin settings.
export const POINTS_PER_ATTENDANCE = 4;
export const MAX_POINTS_PER_COURSE = 4;
export const MAX_SIGNUPS_PER_STUDENT = 4;

function resolvePath(value, fallback) {
  const p = value || fallback;
  return p === ':memory:' ? p : path.resolve(ROOT_DIR, p);
}

export function loadConfig(env = process.env) {
  const nodeEnv = env.NODE_ENV || 'development';
  return {
    nodeEnv,
    isProduction: nodeEnv === 'production',
    port: Number(env.PORT) || 3000,
    baseUrl: env.BASE_URL || 'http://localhost:3000',
    schoolName: (env.SCHOOL_NAME || '').trim(),
    databasePath: resolvePath(env.DATABASE_PATH, './data/saeludagar.db'),
    uploadDir: resolvePath(env.UPLOAD_DIR, './uploads'),
    backupDir: resolvePath(env.BACKUP_DIR, './backups'),
    sessionSecret: env.SESSION_SECRET || '',
    kennitalaEncKey: env.KENNITALA_ENC_KEY || '',
    kennitalaHmacKey: env.KENNITALA_HMAC_KEY || '',
    smtp: {
      host: env.SMTP_HOST || '',
      port: Number(env.SMTP_PORT) || 587,
      secure: env.SMTP_SECURE === 'true',
      user: env.SMTP_USER || '',
      pass: env.SMTP_PASS || '',
      from: env.MAIL_FROM || '',
      maxPerMinute: Number(env.SMTP_MAX_PER_MINUTE) || 30,
    },
    trustProxy: env.TRUST_PROXY === '1',
  };
}
