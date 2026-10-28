export function createSessionStore() {
  let active = null;
  return Object.freeze({
    get() { return active; },
    set(value, providerId = null) {
      active = value ? { session: value, providerId } : null;
    },
    clear() { active = null; },
  });
}
