// Subtitle line describing a grouped source: year, qualities and voices. Kept free of UI imports so
// non-UI layers (e.g. the controller when handing episodes to the host panel) can reuse it.
export function sourceSubtitle(group, translate) {
  const voices = group.voices || [];
  const voiceLabel = voices.length === 1
    ? voices[0]
    : translate('source.voices', { count: voices.length });
  const qualityLabel = (group.qualities || [group.quality]).filter(Boolean).join(' / ');
  return [group.year, qualityLabel, voiceLabel].filter(Boolean).join(' · ');
}
