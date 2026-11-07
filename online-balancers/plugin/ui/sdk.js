import { PotokSDK } from 'potok-sdk';
import { I18N_NAMESPACE } from '../constants.js';

export const {
  Alert,
  Badge,
  Button,
  Card,
  Chip,
  ContentCard,
  Divider,
  EmptyState,
  EpisodeSelector,
  Grid,
  HStack,
  Icon,
  Image,
  InlinePlayer,
  Input,
  LoadingSpinner,
  Modal,
  Page,
  Select,
  SectionHeader,
  Skeleton,
  Text,
  Tooltip,
  VStack,
} = PotokSDK.ui.components;

export const t = (key, options) => PotokSDK.i18n.t(`${I18N_NAMESPACE}:${key}`, options);
export { PotokSDK };
