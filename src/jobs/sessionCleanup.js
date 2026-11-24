const FIFTEEN_MINUTES = 15 * 60 * 1000;

function cleanup(store) {
  try {
    store.clearExpired();
  } catch (err) {
    console.error(`Session cleanup failed: ${err.message}`);
  }
}

// AGENT_START §8: delete expired sessions when it is started and then every 15 minutes. Returns a
// function that stops it.
export function startSessionCleanup(store, intervalMs = FIFTEEN_MINUTES) {
  cleanup(store);
  const timer = setInterval(() => cleanup(store), intervalMs);
  return () => clearInterval(timer);
}
