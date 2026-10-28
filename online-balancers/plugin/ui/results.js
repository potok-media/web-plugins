import { stableCardId, visibleGroups } from '../search/grouping.js';
import { ContentCard, EmptyState, Grid, Skeleton, t } from './sdk.js';

export function sourceSubtitle(group) {
  const voices = group.voices || [];
  const voiceLabel = voices.length === 1
    ? voices[0]
    : t('source.voices', { count: voices.length });
  const qualityLabel = (group.qualities || [group.quality]).filter(Boolean).join(' / ');
  return [group.year, qualityLabel, voiceLabel].filter(Boolean).join(' · ');
}

export function loadingGrid() {
  return Grid()
    .minWidth('10.75rem')
    .gap('var(--space-l)')
    .style('online-results-grid')
    .children([0, 1, 2, 3, 4, 5].map(() => Skeleton()
      .height('16rem')
      .rounded('var(--radius-m)')
      .style('online-poster-skeleton')));
}

export function resultGrid({ groups, state, actions }) {
  const visibleItems = visibleGroups(groups, {
    provider: state.activeProvider,
    quality: state.activeQuality,
    voice: state.activeVoice,
  });
  if (!visibleItems.length) {
    return EmptyState()
      .icon('search-x')
      .title(t('search.empty'))
      .description(t('search.emptyHint'));
  }

  return Grid()
    .minWidth('10.75rem')
    .gap('var(--space-l)')
    .style('online-results-grid')
    .children(visibleItems.map(item => ContentCard()
      .item({
        id: stableCardId(item),
        title: item.title,
        subtitle: sourceSubtitle(item),
        image: item.poster,
        mediaType: item.mediaType === 'movie' ? 'movie' : 'tv',
      })
      .style(`online-result-card${state.selectedId === item.id ? ' online-result-selected' : ''}`)
      .onClick(() => actions.openSource(item))));
}
