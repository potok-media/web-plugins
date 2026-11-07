import { Alert, Button, Card, Divider, HStack, Input, Modal, Text, VStack, t } from './sdk.js';

function accountLabel(provider, account) {
  if (!account) return t('accounts.disconnected');
  return account.label || t('accounts.connected');
}

function accountActions(provider, account, actions) {
  const controls = [Button(account ? t('accounts.manage') : t('accounts.connect'))
    .variant(account ? 'secondary' : 'primary')
    .onClick(() => actions.openAccountProvider(provider.id))];
  if (account) {
    controls.push(Button(t('accounts.disconnect'))
      .variant('danger')
      .onClick(() => actions.disconnectAccount(provider.id)));
  }
  return HStack().spacing(8).style('online-account-actions').children(controls);
}

function accountList({ state, actions, registry }) {
  return VStack().spacing(12).style('online-account-list').children(registry.accounts.map(provider => {
    const account = state.accounts[provider.id];
    return Card()
      .style('online-account-card')
      .title(provider.name)
      .subtitle(accountLabel(provider, account))
      .child(accountActions(provider, account, actions));
  }));
}

function field(name, label, value, actions, options = {}) {
  const input = Input(`online-account-${name}`)
    .label(label)
    .value(value || '')
    .onChange(next => actions.setAccountField(name, next));
  if (options.placeholder) input.placeholder(options.placeholder);
  if (options.type) input.inputType(options.type);
  return input;
}

function accountError(state) {
  return state.accountError
    ? Alert(state.accountError).variant('error').icon('circle-alert')
    : null;
}

function providerControls(state, provider, actions) {
  const providerId = state.accountProvider;
  const items = [];
  const error = accountError(state);
  if (error) items.push(error);

  if (providerId === 'alloha') {
    items.push(
      Text(t('accounts.allohaHint')).variant('secondary'),
      field('label', t('accounts.label'), state.accountDraft.label, actions),
      field('apiToken', t('accounts.apiToken'), state.accountDraft.apiToken, actions),
      field('secretToken', t('accounts.secretToken'), state.accountDraft.secretToken, actions, { type: 'password' }),
      Button(state.accountStatus === 'loading' ? t('accounts.saving') : t('accounts.save'))
        .variant('primary')
        .onClick(actions.saveAlloha),
    );
  } else if (providerId === 'kinopub') {
    // Auto-start device code flow on entry (no intermediate button)
    if (!state.kinoPubDevice && state.accountStatus === 'idle') {
      actions.startKinoPub();
    }
    if (state.kinoPubDevice) {
      const { userCode, verificationUri } = state.kinoPubDevice;
      const isExpired = state.kinoPubDevice.expiresIn
        && (Date.now() > state.kinoPubDevice.expiresAt);
      const hasAccount = Boolean(state.accounts.kinopub);

      // Code row
      items.push(HStack().spacing(12).children([
        Text(userCode).style('online-activation-code'),
        Button(t('accounts.kinopubCopyCode'))
          .variant('secondary')
          .icon('copy')
          .onClick(() => {
            PotokSDK.ui.copyText(userCode);
            PotokSDK.ui.showHUD('success', t('accounts.kinopubCopyCode'));
          }),
      ]));

      // Divider
      items.push(Divider());

      // URL row
      items.push(HStack().spacing(8).children([
        Text(verificationUri).style('online-activation-link'),
        Button(t('accounts.openUrl'))
          .variant('ghost')
          .icon('external-link')
          .onClick(() => { PotokSDK.ui.openUrl(verificationUri); }),
      ]));

      // Polling status (show when device exists, account not yet connected, and not expired)
      if (!hasAccount && !isExpired) {
        items.push(HStack().spacing(8).children([
          HStack().style('online-polling-spinner'),
          Text(t('accounts.kinopubPolling')).variant('secondary').size('sm'),
        ]));
      }

      // Expiry alert + get new code button
      if (isExpired) {
        items.push(Alert(t('accounts.kinopubExpired')).variant('warning').icon('triangle-alert'));
        items.push(Button(t('accounts.kinopubStart'))
          .variant('primary')
          .style('online-confirm-btn')
          .onClick(actions.startKinoPub));
      }
    } else {
      items.push(Button(state.accountStatus === 'loading'
        ? t('accounts.opening')
        : t('accounts.kinopubStart'))
        .variant('primary')
        .onClick(actions.startKinoPub));
    }
  } else if (providerId === 'filmix') {
    // Filmix device flow: the API has no activation-status poll, so the account is stored
    // on explicit user confirmation (no auto-polling).
    items.push(Text(t('accounts.filmixHint')).variant('secondary'));
    if (!state.filmixDevice && state.accountStatus === 'idle') {
      actions.startFilmix();
    }
    if (state.filmixDevice) {
      const { userCode, verificationUri } = state.filmixDevice;
      items.push(HStack().spacing(12).children([
        Text(userCode).style('online-activation-code'),
        Button(t('accounts.kinopubCopyCode'))
          .variant('secondary')
          .icon('copy')
          .onClick(() => {
            PotokSDK.ui.copyText(userCode);
            PotokSDK.ui.showHUD('success', t('accounts.kinopubCopyCode'));
          }),
      ]));
      items.push(Divider());
      items.push(HStack().spacing(8).children([
        Text(verificationUri).style('online-activation-link'),
        Button(t('accounts.openUrl'))
          .variant('ghost')
          .icon('external-link')
          .onClick(() => { PotokSDK.ui.openUrl(verificationUri); }),
      ]));
      items.push(Button(t('accounts.kinopubConfirm'))
        .variant('primary')
        .style('online-confirm-btn')
        .onClick(actions.confirmFilmix));
    } else {
      items.push(Button(state.accountStatus === 'loading'
        ? t('accounts.opening')
        : t('accounts.kinopubStart'))
        .variant('primary')
        .onClick(actions.startFilmix));
    }
  } else if (providerId === 'rezka') {
    items.push(
      Alert(t('accounts.rezkaWarning')).variant('warning').icon('triangle-alert'),
      field('host', t('accounts.host'), state.accountDraft.host, actions, { placeholder: 'https://rezka.ag' }),
      field('login', t('accounts.login'), state.accountDraft.login, actions),
      field('password', t('accounts.password'), state.accountDraft.password, actions, { type: 'password' }),
      Button(state.accountStatus === 'loading' ? t('accounts.signingIn') : t('accounts.signIn'))
        .variant('primary')
        .onClick(actions.loginRezka),
    );
  }

  return VStack().spacing(16).style('online-account-provider').children(items);
}

export function accountsButton(state, actions) {
  const connected = Object.keys(state.accounts).length;
  return Button(connected
    ? t('accounts.buttonConnected', { count: connected })
    : t('accounts.button'))
    .variant('secondary')
    .icon('link')
    .style('online-accounts-button')
    .onClick(actions.openAccounts);
}

export function accountsModal({ state, actions, registry }) {
  if (!state.accountsOpen) return null;
  const provider = registry.accounts.find(item => item.id === state.accountProvider);
  return Modal()
    .open(true)
    .variant('modal')
    .style('online-account-modal')
    .title(provider ? provider.name : t('accounts.title'))
    .closeOnBackdrop(true)
    .onClose(actions.closeAccounts)
    .child(provider
      ? providerControls(state, provider, actions)
      : accountList({ state, actions, registry }));
}
