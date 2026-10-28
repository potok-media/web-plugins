import { compareQualities } from '../search/grouping.js';
import { HStack, Select, Text, t } from './sdk.js';

function selectedFilterValue(value) {
  return typeof value === 'object' && value ? value.id : value;
}

export function buildFilters({ groups, state, actions, registry }) {
  const providerItems = [{ id: 'all', label: t('filters.all') }];
  for (const provider of registry.all) {
    const hasResults = groups.some(group => group.variants.some(item => item.providerId === provider.id));
    const needsAccount = provider.access === 'account' && !state.accounts[provider.id];
    if (hasResults || provider.access === 'account') {
      providerItems.push({
        id: provider.id,
        label: needsAccount ? `${provider.name} · ${t('filters.connectAccount')}` : provider.name,
      });
    }
  }

  const qualityItems = [{ id: 'all', label: t('filters.all') }, ...[...new Set(
    groups.flatMap(group => group.qualities),
  )].sort(compareQualities).map(quality => ({ id: quality, label: quality }))];

  const voiceItems = [{ id: 'all', label: t('filters.all') }, ...[...new Set(
    groups.flatMap(group => group.voices),
  )].sort((left, right) => String(left).localeCompare(String(right)))
    .map(voice => ({ id: voice, label: voice }))];

  const select = (id, items, value, style, onChange) => Select(id)
    .variant('glass')
    .options(items.map(item => ({ value: item.id, label: item.label })))
    .value(value)
    .style(`online-filter ${style}`)
    .onChange(next => onChange(selectedFilterValue(next) || 'all'));

  const control = (label, component) => HStack()
    .spacing(8)
    .style('online-filter-control')
    .children([Text(label).style('online-filter-label'), component]);

  return HStack().spacing(16).style('online-filter-row').children([
    control(t('filters.source'), select(
      'online-provider-filter', providerItems, state.activeProvider, 'online-filter-source', actions.setProvider,
    )),
    control(t('filters.quality'), select(
      'online-quality-filter', qualityItems, state.activeQuality, 'online-filter-quality', actions.setQuality,
    )),
    control(t('filters.voice'), select(
      'online-voice-filter', voiceItems, state.activeVoice, 'online-filter-voice', actions.setVoice,
    )),
  ]);
}
