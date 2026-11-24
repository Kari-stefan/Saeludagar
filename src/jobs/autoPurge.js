import { autoPurge } from '../services/purge.js';

const ONE_HOUR = 60 * 60 * 1000;

function check(db) {
  try {
    const result = autoPurge(db);
    if (result.purged) console.log('Automatic purge: student data deleted (BR-55).');
    else if (result.reason === 'no-admin') {
      console.error('Automatic purge is waiting: an event is owned by a student and no admin account exists to take it over.');
    }
  } catch (err) {
    console.error(`Automatic purge failed: ${err.message}`);
  }
}

// AGENT_START §8, BR-55: the check that purges 30 days after the course-choice deadline. It runs
// once when it is started, so a server that was down at the due time purges at once, and then
// every hour. Logs one line when it purges, with no personal data. Returns a function that stops it.
export function startAutoPurge(db, intervalMs = ONE_HOUR) {
  check(db);
  const timer = setInterval(() => check(db), intervalMs);
  return () => clearInterval(timer);
}
