import { EpisodeSelector } from './sdk.js';
import { sourceSubtitle } from './results.js';

export function buildEpisodePanel({ state, actions }) {
  if (!state.episodeSelectorOpen || !state.selectedStream) return null;
  return EpisodeSelector()
    .isOpen(true)
    .presentation('panel')
    .activeEpisodeId(state.activeEpisodeId)
    .canReorder(true)
    .title(state.selectedStream.title)
    .subtitle(sourceSubtitle(state.selectedStream))
    .episodes(state.selectedEpisodes)
    .seasonsLoading(false)
    .onClose(actions.closeEpisodeSelector)
    .onReorder(actions.reorderEpisodes)
    .onPlay(actions.playEpisode);
}
