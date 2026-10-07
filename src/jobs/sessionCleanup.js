const FIFTEEN_MINUTES = 15 * 60 * 1000;

// AGENT_START §8: delete expired sessions every 15 minutes. Returns a function that stops it.
export function startSessionCleanup(store, intervalMs = FIFTEEN_MINUTES) {
  const timer = setInterval(() => {
    try {
      store.clearExpired();
    } catch (err) {
      console.error(`Session cleanup failed: ${err.message}`);
    }
  }, intervalMs);
  return () => clearInterval(timer);
}
