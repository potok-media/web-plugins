import { groupSources } from '../search/grouping.js';
import { buildFilters } from './filters.js';
import { loadingGrid, resultGrid } from './results.js';
import { accountsButton, accountsModal } from './accounts.js';
import {
  Alert,
  EmptyState,
  HStack,
  Page,
  PlaybackWorkspace,
  SectionHeader,
  VStack,
  t,
} from './sdk.js';

function pageContent({ state, actions, registry }) {
  const groups = groupSources(state.items);
  const subtitle = state.status === 'loading'
    ? t('search.loading', { query: state.query })
    : state.status === 'ready'
      ? t('search.matches', { count: groups.length, query: state.query })
      : '';
  const toolbarChildren = [SectionHeader(t('search.heading'))
    .subtitle(subtitle)
    .style('online-results-heading')];
  const controls = [];
  if (state.status === 'ready') controls.push(buildFilters({ groups, state, actions, registry }));
  controls.push(accountsButton(state, actions));
  toolbarChildren.push(HStack().spacing(12).style('online-results-controls').children(controls));
  const children = [HStack()
    .spacing(24)
    .style('online-results-toolbar')
    .children(toolbarChildren)];

  if (state.status === 'idle') {
    children.push(EmptyState().icon('search').title(t('search.noContext')));
    return VStack().spacing(16).children(children);
  }
  if (state.status === 'loading') {
    children.push(loadingGrid());
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

  const failedProviders = registry.all
    .filter(provider => state.errors[provider.id])
    .map(provider => provider.name);
  if (failedProviders.length) {
    children.push(Alert(t('search.partialFailure', { providers: failedProviders.join(', ') }))
      .variant('warning')
      .icon('triangle-alert'));
  }
  if (state.episodeStatus === 'loading') {
    children.push(Alert(t('episodes.loading')).variant('info').icon('loader-circle'));
  } else if (state.episodeStatus === 'error') {
    children.push(Alert(state.episodeError).variant('error').icon('circle-alert'));
  }
  children.push(resultGrid({ groups, state, actions }));
  return VStack().spacing(16).children(children);
}

export function buildPage({ state, actions, registry }) {
  // The episode panel is the host's job: while a source with episodes is open the plugin renders the
  // playback stage only, and the host fills the workspace rail from the episodes presented by the
  // controller (ui.presentEpisodes).
  if (state.episodeSelectorOpen && state.selectedStream) {
    const workspace = PlaybackWorkspace().style('online-playback-workspace');
    if (state.selectedStream?.poster) workspace.backdropSrc(state.selectedStream.poster);
    return workspace;
  }
  const page = Page().style('online-page').child(
    VStack().spacing(20).style('online-shell').child(pageContent({ state, actions, registry })),
  );
  const modal = accountsModal({ state, actions, registry });
  return modal ? VStack().style('online-page-root').children([page, modal]) : page;
}
