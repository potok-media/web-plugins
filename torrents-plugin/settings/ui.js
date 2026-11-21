import { PotokSDK } from 'potok-sdk';
import { components, injectHostCss } from './sdk.js';
import { installStyles } from './styles.js';

const { HStack, VStack, Text, Select, Input } = components;

/** Unique CSS prefix — keeps selectors scoped, no collision with host or other plugins */
const CSS_PREFIX = 'potok-torrents-settings';

let initialized = false;

// ---------------------------------------------------------------------------
// Shared mutable state (updated via onChange, so re-renders stay in sync)
// ---------------------------------------------------------------------------
let selectedSource = 'potok';
let storedAddress = '';
let storedApiKey = '';

async function loadStoredValues() {
  selectedSource = await PotokSDK.storage.local.getItem('searchSource') || 'potok';
  storedAddress = await PotokSDK.storage.local.getItem(
    selectedSource === 'jacred' ? 'jacredUrl' : 'searchEngineURL'
  ) || '';
  storedApiKey = await PotokSDK.storage.local.getItem('jacredApiKey') || '';
}

export async function initSettings() {
  if (initialized) return;
  initialized = true;

  // Install CSS first so the select renders at the correct width
  installStyles();

  // Load persisted values before building the UI
  await loadStoredValues();

  const i18n = PotokSDK.i18n;

  // ---------------------------------------------------------------------------
  // Layout builder — synchronous, receives values from closure state
  // ---------------------------------------------------------------------------
  function buildLayout() {
    const sources = [
      { label: i18n.t('potok-torrents:settings.searchSourcePotok'), value: 'potok' },
      { label: i18n.t('potok-torrents:settings.searchSourceJacred'), value: 'jacred' }
    ];

    const addressLabel = (selectedSource === 'jacred')
      ? i18n.t('potok-torrents:config.jacredUrl')
      : i18n.t('potok-torrents:config.searchEngineUrl');

    const select = Select('pt-settings-source')
      .options(sources)
      .value(selectedSource)
      .style('pt-select')
      .onChange(async (value) => {
        selectedSource = value;
        // Reload the address field value for the newly selected source
        storedAddress = await PotokSDK.storage.local.getItem(
          value === 'jacred' ? 'jacredUrl' : 'searchEngineURL'
        ) || '';
        await PotokSDK.storage.local.setItem('searchSource', value);
        PotokSDK.ui.render(buildLayout(), 'torrents-search-source');
      });

    const addressInput = Input('pt-settings-address')
      .style('pt-input')
      .label(addressLabel)
      .value(storedAddress)
      .onChange(async (value) => {
        storedAddress = value;
        await PotokSDK.storage.local.setItem(
          selectedSource === 'jacred' ? 'jacredUrl' : 'searchEngineURL',
          value
        );
      });

    const apiInput = (selectedSource === 'jacred')
      ? Input('pt-settings-api-key')
          .style('pt-input')
          .label(i18n.t('potok-torrents:config.jacredApiKey'))
          .value(storedApiKey)
          .inputType('password')
          .onChange(async (value) => {
            storedApiKey = value;
            await PotokSDK.storage.local.setItem('jacredApiKey', value);
          })
      : undefined;

    const controls = HStack()
      .spacing(8)
      .children([select, addressInput]);

    const children = [controls];
    if (apiInput) {
      children.push(apiInput);
    }

    return HStack()
      .spacing(12)
      .style(CSS_PREFIX)
      .children([
        Text(i18n.t('potok-torrents:settings.searchSource')).style('pt-label'),
        VStack()
          .spacing(8)
          .children(children)
          .style('pt-controls')
      ]);
  }

  // ---------------------------------------------------------------------------
  // Register
  // ---------------------------------------------------------------------------
  PotokSDK.registerSlotContribution({
    slotName: 'sidebar-status',
    id: 'torrents-search-source',
    render: () => ({
      label: i18n.t('potok-torrents:settings.searchSourceTitle'),
      layout: buildLayout()
    })
  });

  PotokSDK.ui.render(buildLayout(), 'torrents-search-source');
}
