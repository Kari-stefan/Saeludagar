import path from 'node:path';
import express from 'express';
import session from 'express-session';
import helmet from 'helmet';
import { ROOT_DIR } from './config.js';
import { languageMiddleware } from './middleware/language.js';
import { errorHandler, notFound } from './middleware/errors.js';
import { publicRouter } from './routes/public.js';
import { authRouter } from './routes/auth.js';
import { studentRouter } from './routes/student.js';
import { teacherRouter } from './routes/teacher.js';
import { adminRouter } from './routes/admin.js';

export function createApp({ config }) {
  if (!config.sessionSecret) {
    throw new Error('SESSION_SECRET is not set. Copy .env.example to .env and fill it in (see README, "Setup").');
  }

  const app = express();
  app.set('views', path.join(ROOT_DIR, 'src', 'views'));
  app.set('view engine', 'ejs');
  if (config.trustProxy) app.set('trust proxy', 1);

  app.locals.schoolName = config.schoolName;

  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        imgSrc: ["'self'", 'data:'],
        fontSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
        upgradeInsecureRequests: config.isProduction ? [] : null,
      },
    },
    strictTransportSecurity: config.isProduction,
  }));

  app.use(express.static(path.join(ROOT_DIR, 'public')));
  app.use(express.urlencoded({ extended: false, limit: '100kb' }));

  // Uses express-session's in-memory store until the SQLite store arrives in milestone 2.
  app.use(session({
    name: 'sid',
    secret: config.sessionSecret,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: { httpOnly: true, sameSite: 'lax', secure: config.isProduction },
  }));

  app.use(languageMiddleware);

  app.use(publicRouter());
  app.use(authRouter());
  app.use(studentRouter());
  app.use('/teacher', teacherRouter());
  app.use('/admin', adminRouter());

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
