import { groupSources } from '../search/grouping.js';
import { buildFilters } from './filters.js';
import { loadingGrid, resultList } from './results.js';
import { accountsButton, accountsModal } from './accounts.js';
import {
  Alert,
  EmptyState,
  HStack,
  Icon,
  InlinePlayer,
  Page,
  Text,
  VStack,
  t,
} from './sdk.js';

function pageContent({ state, actions, registry }) {
  const groups = groupSources(state.items);
  // Reference header (see /tmp/online-mock.html): brand + query pill on one row,
  // filter row beneath. No separate "results" heading — the pill carries the query.
  const brand = HStack().spacing(0).style('online-brand').children([
    Text('Potok ').style('online-brand-base'),
    Text('Online').style('online-brand-accent'),
  ]);
  const headerChildren = [brand];
  if (state.status !== 'idle') {
    headerChildren.push(HStack()
      .spacing(8)
      .style('online-query-pill')
      .children([
        Icon('search').style('online-query-pill-icon'),
        Text(state.query).style('online-query-pill-text'),
      ]));
  }
  headerChildren.push(accountsButton(state, actions));
  const children = [HStack()
    .spacing(16)
    .style('online-header')
    .children(headerChildren)];

  if (state.status === 'idle') {
    children.push(EmptyState().icon('search').title(t('search.noContext')));
    return VStack().spacing(16).children(children);
  }
  if (state.status === 'error') {
    children.push(EmptyState()
      .icon('triangle-alert')
      .title(t('search.failed'))
      .description(state.error || t('search.failedHint'))
      .actionLabel(t('search.retry'))
      .onAction(actions.retrySearch));
    return VStack().spacing(16).children(children);
  }
  if (state.status === 'ready') {
    children.push(HStack()
      .spacing(12)
      .style('online-filters-row')
      .children([buildFilters({ groups, state, actions, registry })]));
  }
  // Loading without any arrived batch yet: card-shaped skeletons. As soon as the first
  // providers respond, the real cards render and the remaining chips shimmer in place.
  if (state.status === 'loading' && state.items.length === 0) {
    children.push(loadingGrid());
    return VStack().spacing(16).children(children);
  }

  // Per-provider failures are already visible on their chips (tooltip + retry) — no banner.
  if (state.episodeStatus === 'loading') {
    children.push(Alert(t('episodes.loading')).variant('info').icon('loader-circle'));
  } else if (state.episodeStatus === 'error') {
    children.push(Alert(state.episodeError).variant('error').icon('circle-alert'));
  }
  children.push(resultList({ groups, state, actions, registry }));
  return VStack().spacing(16).children(children);
}

export function buildPage({ state, actions, registry }) {
  // The episode panel is the host's job: while a source with episodes is open the plugin renders the
  // playback stage only, and the host fills the stage rail from the episodes presented by the
  // controller (ui.presentEpisodes). The InlinePlayer itself is host-rendered into the stage while
  // the playback opened with mount='inline' (see playbackController).
  if (state.episodeSelectorOpen && state.selectedStream) {
    const stage = InlinePlayer().style('online-playback-workspace');
    if (state.selectedStream?.poster) stage.backdropSrc(state.selectedStream.poster);
    // While the episode resolves upstream (playVideo not dispatched yet) the host shows a
    // centered loading state in the stage instead of a black screen.
    stage.loading(state.playbackPending === true);
    return stage;
  }
  const page = Page().style('online-page').child(
    VStack().spacing(20).style('online-shell').child(pageContent({ state, actions, registry })),
  );
  const modal = accountsModal({ state, actions, registry });
  return modal ? VStack().style('online-page-root').children([page, modal]) : page;
}
