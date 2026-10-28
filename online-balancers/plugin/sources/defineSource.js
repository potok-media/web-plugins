export function defineSource(definition) {
  const id = String(definition?.id || '').trim();
  const name = String(definition?.name || '').trim();
  if (!id) throw new Error('Online source id is required');
  if (!name) throw new Error(`Online source '${id}' must have a name`);
  return Object.freeze({
    id,
    name,
    category: definition.category || 'general',
    access: definition.access === 'account' ? 'account' : 'free',
    authMode: definition.authMode || null,
    capabilities: Object.freeze({
      movies: definition.capabilities?.movies !== false,
      series: definition.capabilities?.series !== false,
      search: definition.capabilities?.search !== false,
      episodes: definition.capabilities?.episodes !== false,
      playback: definition.capabilities?.playback !== false,
    }),
  });
}
