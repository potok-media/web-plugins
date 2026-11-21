import { PotokSDK } from 'potok-sdk';
import { components, injectHostCss } from './sdk.js';
import { installStyles } from './styles.js';

const { HStack, VStack, Text, Select, Input } = components;
const CSS_PREFIX = 'potok-torrents-settings';

let initialized = false;

// Load values from storage — must complete before first render
async function loadValues() {
  const selectedSource = await PotokSDK.storage.local.getItem('searchSource') || 'potok';
  const address = await PotokSDK.storage.local.getItem(
    selectedSource === 'jacred' ? 'jacredUrl' : 'searchEngineURL'
  ) || '';
  const apiKey = await PotokSDK.storage.local.getItem('jacredApiKey') || '';
  return { selectedSource, address, apiKey };
}

// Build layout from passed values — always returns valid UI
function buildLayout(state) {
  const i18n = PotokSDK.i18n;

  const sources = [
    { label: i18n.t('potok-torrents:settings.searchSourcePotok'), value: 'potok' },
    { label: i18n.t('potok-torrents:settings.searchSourceJacred'), value: 'jacred' }
  ];

  const addressLabel = (state.selectedSource === 'jacred')
    ? i18n.t('potok-torrents:config.jacredUrl')
    : i18n.t('potok-torrents:config.searchEngineUrl');

  const select = Select('pt-settings-source')
    .options(sources)
    .value(state.selectedSource)
    .style('pt-select')
    .onChange(async (value) => {
      // Load address for newly selected source
      const newAddress = await PotokSDK.storage.local.getItem(
        value === 'jacred' ? 'jacredUrl' : 'searchEngineURL'
      ) || '';
      await PotokSDK.storage.local.setItem('searchSource', value);
      PotokSDK.ui.render(
        buildLayout({ ...state, selectedSource: value, address: newAddress }),
        'torrents-search-source'
      );
    });

  const addressInput = Input('pt-settings-address')
    .style('pt-input')
    .label(addressLabel)
    .value(state.address)
    .onChange(async (value) => {
      await PotokSDK.storage.local.setItem(
        state.selectedSource === 'jacred' ? 'jacredUrl' : 'searchEngineURL',
        value
      );
    });

  const apiInput = (state.selectedSource === 'jacred')
    ? Input('pt-settings-api-key')
        .style('pt-input')
        .label(i18n.t('potok-torrents:config.jacredApiKey'))
        .value(state.apiKey)
        .inputType('password')
        .onChange(async (value) => {
          await PotokSDK.storage.local.setItem('jacredApiKey', value);
        })
    : undefined;

  const controls = HStack()
    .spacing(8)
    .children([select, addressInput]);

  const children = [controls];
  if (apiInput) children.push(apiInput);

  return HStack()
    .spacing(12)
    .style(CSS_PREFIX)
    .children([
      Text(i18n.t('potok-torrents:settings.searchSource')).style('pt-label'),
      VStack().spacing(8).children(children).style('pt-controls')
    ]);
}

export async function initSettings() {
  if (initialized) return;
  initialized = true;

  installStyles();
  const state = await loadValues();

  PotokSDK.registerSlotContribution({
    slotName: 'sidebar-status',
    id: 'torrents-search-source',
    render: () => ({
      label: PotokSDK.i18n.t('potok-torrents:settings.searchSourceTitle'),
      layout: buildLayout(state)
    })
  });

  PotokSDK.ui.render(buildLayout(state), 'torrents-search-source');
}
