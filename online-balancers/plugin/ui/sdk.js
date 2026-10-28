import { PotokSDK } from 'potok-sdk';
import { I18N_NAMESPACE } from '../constants.js';

export const {
  Alert,
  Button,
  Card,
  ContentCard,
  Divider,
  EmptyState,
  EpisodeSelector,
  Grid,
  HStack,
  Input,
  Modal,
  Page,
  PlaybackWorkspace,
  Select,
  SectionHeader,
  Skeleton,
  Text,
  VStack,
} = PotokSDK.ui.components;

export const t = (key, options) => PotokSDK.i18n.t(`${I18N_NAMESPACE}:${key}`, options);
export { PotokSDK };
