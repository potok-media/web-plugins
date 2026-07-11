import { fetchAnimes, toCards } from '../shikimori.js';
import { rememberCard } from './cardMeta.js';

export function cardToItem(card) {
  return {
    id: card.shikiId,
    mediaType: card.mediaType,
    title: card.title,
    subtitle: card.subtitle,
    image: card.posterSrc,
    rating: card.rating,
  };
}

export async function loadItems(filters) {
  const animes = await fetchAnimes(filters);
  const cards = toCards(animes);
  cards.forEach(rememberCard);
  return { items: cards.map(cardToItem), cards, rawCount: animes.length };
}