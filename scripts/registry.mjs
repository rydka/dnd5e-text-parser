/**
 * Registry of the fallback resolver (extension point). No side effect at import: the state is module-local.
 * The resolver is only called by the `parse*Async` functions, never by the synchronous ones.
 */

const entries = [];

/**
 * Register a fallback resolver.
 * @param {string} id                         Identifier of the registrant (a module id).
 * @param {function} resolver                 FallbackResolver (see CLAUDE.md).
 * @param {{priority?: number}} [options]     Higher priority wins; the latest registration wins a tie.
 * @returns {function(): void}                Unregister function.
 */
export function registerFallback(id, resolver, { priority = 0 } = {}) {
  if ( (typeof id !== "string") || !id ) throw new TypeError("registerFallback: id must be a non-empty string");
  if ( typeof resolver !== "function" ) throw new TypeError("registerFallback: resolver must be a function");
  const entry = { id, resolver, priority };
  const existing = entries.findIndex(e => e.id === id);
  if ( existing >= 0 ) entries.splice(existing, 1);
  entries.push(entry);
  return () => {
    const index = entries.indexOf(entry);
    if ( index >= 0 ) entries.splice(index, 1);
  };
}

/**
 * The active fallback resolver.
 * @returns {function|null}
 */
export function getFallback() {
  let best = null;
  for ( const entry of entries ) {
    if ( !best || (entry.priority >= best.priority) ) best = entry;
  }
  return best ? best.resolver : null;
}
