import { loadConfig } from './config.js';
import { openDatabase } from './db/index.js';
import { SCHEMA_VERSION } from './db/migrate.js';
import { SqliteSessionStore } from './db/sessionStore.js';
import { createApp } from './app.js';
import { createOutboxWorker } from './jobs/outbox.js';
import { startSessionCleanup } from './jobs/sessionCleanup.js';
import { createMailer } from './services/email.js';

const config = loadConfig();

const db = openDatabase(config.databasePath);
if (db.pragma('user_version', { simple: true }) !== SCHEMA_VERSION) {
  console.error('The database is not set up. Run: npm run migrate');
  process.exit(1);
}

const sessionStore = new SqliteSessionStore(db);
let app;
let mailer;
try {
  app = createApp({ config, db, sessionStore });
  mailer = createMailer(config);
} catch (err) {
  console.error(err.message);
  process.exit(1);
}

// Scheduled jobs run inside this process (AGENT_START §8).
const outbox = createOutboxWorker({ db, mailer, config });
let stopSessionCleanup = () => {};

// Express 5 passes listen errors (such as a busy port) to this callback.
const server = app.listen(config.port, (err) => {
  if (err) {
    console.error(err.code === 'EADDRINUSE'
      ? `Port ${config.port} is already in use. Stop the other server, or set PORT in .env to a free port.`
      : `Could not start the server: ${err.message}`);
    db.close();
    process.exit(1);
  }
  console.log(`Sæludagar is running at http://localhost:${config.port}`);
  outbox.start();
  stopSessionCleanup = startSessionCleanup(sessionStore);
});

async function shutdown() {
  stopSessionCleanup();
  await outbox.stop();
  server.close(() => {
    db.close();
    process.exit(0);
  });
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
