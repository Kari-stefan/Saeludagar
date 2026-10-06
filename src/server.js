import { loadConfig } from './config.js';
import { openDatabase } from './db/index.js';
import { SCHEMA_VERSION } from './db/migrate.js';
import { createApp } from './app.js';

const config = loadConfig();

const db = openDatabase(config.databasePath);
if (db.pragma('user_version', { simple: true }) !== SCHEMA_VERSION) {
  console.error('The database is not set up. Run: npm run migrate');
  process.exit(1);
}

let app;
try {
  app = createApp({ config });
} catch (err) {
  console.error(err.message);
  process.exit(1);
}

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
});

function shutdown() {
  server.close(() => {
    db.close();
    process.exit(0);
  });
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
