import { autoPurge } from '../services/purge.js';

const ONE_HOUR = 60 * 60 * 1000;

// AGENT_START §8, BR-55: the hourly check that purges 30 days after the course-choice deadline.
// Logs one line when it purges, with no personal data. Returns a function that stops it.
export function startAutoPurge(db, intervalMs = ONE_HOUR) {
  const timer = setInterval(() => {
    try {
      const result = autoPurge(db);
      if (result.purged) console.log('Automatic purge: student data deleted (BR-55).');
      else if (result.reason === 'no-admin') {
        console.error('Automatic purge is waiting: an event is owned by a student and no admin account exists to take it over.');
      }
    } catch (err) {
      console.error(`Automatic purge failed: ${err.message}`);
    }
  }, intervalMs);
  return () => clearInterval(timer);
}
