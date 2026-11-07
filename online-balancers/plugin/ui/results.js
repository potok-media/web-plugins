import { visibleGroups } from '../search/grouping.js';
import { sourceSubtitle as buildSourceSubtitle } from '../media/sourceMeta.js';
import {
  Badge,
  Button,
  EmptyState,
  Grid,
  HStack,
  Image,
  Skeleton,
  Text,
  VStack,
  t,
} from './sdk.js';

export function sourceSubtitle(group) {
  return buildSourceSubtitle(group, t);
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

// Aggregate a group's variants into card meta: best quality, distinct voice count,
// provider count, adult flag.
function cardAggregates(group, registry) {
  const qualities = [];
  const voices = new Set();
  const providers = new Set();
  let adult = false;
  for (const variant of group.variants) {
    if (variant.quality && !qualities.includes(variant.quality)) qualities.push(variant.quality);
    if (variant.voice) voices.add(variant.voice);
    providers.add(variant.providerId);
    if (registry.get(variant.providerId)?.adult === true) adult = true;
  }
  qualities.sort((left, right) => (Number.parseInt(right, 10) || 0) - (Number.parseInt(left, 10) || 0));
  return { quality: qualities[0] ?? null, voices, providers, adult };
}

function gridCard(group, { state, actions, registry }) {
  const aggregate = cardAggregates(group, registry);
  const metaParts = [
    aggregate.quality,
    aggregate.voices.size > 1 ? t('chips.voices', { count: aggregate.voices.size }) : null,
    aggregate.providers.size > 1 ? t('card.variants', { count: aggregate.providers.size }) : null,
  ].filter(Boolean).join(' · ');

  const poster = group.poster
    ? Image(group.poster).style('online-grid-poster').rounded('var(--radius-m)').fit('cover')
    : Skeleton().height('15rem').rounded('var(--radius-m)');
  // Provider badge over the poster's top-right corner (where the host's media cards
  // carry their TV/movie kind badge) — the leading balancer of the group.
  const primaryProvider = group.variants[0]?.provider ?? '';

  return VStack()
    .spacing(8)
    .alignItems('flex-start')
    .style(`online-grid-card${state.selectedId === group.id ? ' online-result-selected' : ''}`)
    .children([
      HStack()
        .style('online-grid-poster-wrap')
        .children([
          poster,
          primaryProvider ? Badge(primaryProvider).style('online-grid-provider-badge') : null,
        ].filter(Boolean)),
      HStack()
        .spacing(6)
        .style('online-grid-title-row')
        .children([
          Text(group.title).style('online-grid-title'),
          aggregate.adult ? Badge('18+').style('online-badge-adult') : null,
        ].filter(Boolean)),
      metaParts ? Text(metaParts).style('online-grid-meta') : null,
      // Full-card click target: the SDK only gives Buttons an onClick, so an invisible
      // overlay button covers the card.
      Button('')
        .variant('ghost')
        .style('online-grid-hit')
        .onClick(() => actions.openSource(group)),
    ].filter(Boolean));
}

export function resultList({ groups, state, actions, registry }) {
  const visibleItems = visibleGroups(groups, {
    provider: state.activeProvider,
    quality: state.activeQuality,
    voice: state.activeVoice,
  });
  if (!visibleItems.length && state.status === 'ready') {
    return EmptyState()
      .icon('search-x')
      .title(t('search.empty'))
      .description(t('search.emptyHint'));
  }

  return Grid()
    .minWidth('10.75rem')
    .gap('var(--space-l)')
    .style('online-results-grid')
    .children(visibleItems.map(group => gridCard(group, { state, actions, registry })));
}
