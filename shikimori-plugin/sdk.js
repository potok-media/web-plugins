import { PotokSDK } from 'potok-sdk';

export const {
  VStack, HStack, Spacer, ContentRow, TopTenRow, PosterGrid,
  Scroller, SearchBar, Select, Skeleton, EmptyState,
  SidebarGroup, Button, Card, Text, Heading, Modal,
} = PotokSDK.ui.components;

export const t = (key, opts) => PotokSDK.i18n.t(`potok-shikimori:${key}`, opts);