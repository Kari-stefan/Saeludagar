import path from 'node:path';
import express from 'express';
import session from 'express-session';
import helmet from 'helmet';
import { ROOT_DIR } from './config.js';
import { SqliteSessionStore } from './db/sessionStore.js';
import { loadUser, STUDENT_SESSION_MS } from './middleware/auth.js';
import { csrfToken, verifyCsrf } from './middleware/csrf.js';
import { flash } from './middleware/flash.js';
import { languageMiddleware } from './middleware/language.js';
import { errorHandler, notFound } from './middleware/errors.js';
import { createAccounts } from './services/accounts.js';
import { kennitalaCrypto } from './services/crypto.js';
import { publicRouter } from './routes/public.js';
import { authRouter } from './routes/auth.js';
import { studentRouter } from './routes/student.js';
import { teacherRouter } from './routes/teacher.js';
import { adminRouter } from './routes/admin.js';

export function createApp({ config, db, sessionStore = new SqliteSessionStore(db) }) {
  if (!config.sessionSecret) {
    throw new Error('SESSION_SECRET is not set. Copy .env.example to .env and fill it in (see README, "Setup").');
  }
  const accounts = createAccounts({ db, kt: kennitalaCrypto(config) });

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

  // AGENT_START §8. The cookie (the only one the site sets, BR-57) is renewed on every request;
  // login lengthens it for teachers and admins (BR-09).
  app.use(session({
    name: 'sid',
    secret: config.sessionSecret,
    store: sessionStore,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: { httpOnly: true, sameSite: 'lax', secure: config.isProduction, maxAge: STUDENT_SESSION_MS },
  }));

  // Page locals come before the body parser, so its error pages still get them.
  app.use(languageMiddleware);
  app.use(loadUser(db));
  app.use(csrfToken);
  app.use(flash);
  app.use(express.urlencoded({ extended: false, limit: '100kb' }));
  app.use(verifyCsrf);

  app.use(publicRouter());
  app.use(authRouter({ accounts }));
  app.use(studentRouter());
  app.use('/teacher', teacherRouter());
  app.use('/admin', adminRouter({ db, accounts }));

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
