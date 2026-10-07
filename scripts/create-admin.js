// BR-13: creates an active admin teacher account and prints its code once (AGENT_START §8).
// Usage: npm run create-admin -- --name "…" --email "…" --kennitala "…"
import { parseArgs } from 'node:util';
import { loadConfig } from '../src/config.js';
import { openDatabase } from '../src/db/index.js';
import { SCHEMA_VERSION } from '../src/db/migrate.js';
import { t } from '../src/i18n/index.js';
import { createAccounts, validateTeacher } from '../src/services/accounts.js';
import { kennitalaCrypto } from '../src/services/crypto.js';

const USAGE = 'Usage: npm run create-admin -- --name "Full name" --email "name@example.is" --kennitala "0000000000"';

function fail(message) {
  console.error(message);
  process.exit(1);
}

let args;
try {
  ({ values: args } = parseArgs({
    options: { name: { type: 'string' }, email: { type: 'string' }, kennitala: { type: 'string' } },
  }));
} catch (err) {
  fail(`${err.message}\n${USAGE}`);
}
if (!args.name || !args.email || !args.kennitala) fail(USAGE);

const { values, errors } = validateTeacher(args);
if (Object.keys(errors).length > 0) fail(Object.values(errors).map((key) => t('en', key)).join('\n'));

const config = loadConfig();
let kt;
try {
  kt = kennitalaCrypto(config);
} catch (err) {
  fail(err.message);
}

const db = openDatabase(config.databasePath);
if (db.pragma('user_version', { simple: true }) !== SCHEMA_VERSION) {
  fail('The database is not set up. Run: npm run migrate');
}
const result = await createAccounts({ db, kt }).createAdmin(values);
db.close();
if (result.error) fail(t('en', result.error));

console.log(`Admin account created for ${values.name} (${values.email}).`);
console.log(`Login code: ${result.code}`);
console.log(`This is the only time the code is shown. Log in at ${new URL('/login', config.baseUrl).href}`);
