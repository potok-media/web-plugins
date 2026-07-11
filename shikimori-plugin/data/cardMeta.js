const CARD_META_MAX = 1000;
const cardMeta = new Map();

export function rememberCard(card) {
  const key = String(card.shikiId);
  cardMeta.delete(key);
  cardMeta.set(key, card);
  if (cardMeta.size > CARD_META_MAX) cardMeta.delete(cardMeta.keys().next().value);
}

export function getCard(id) {
  const key = String(id);
  const card = cardMeta.get(key);
  if (card) { cardMeta.delete(key); cardMeta.set(key, card); }
  return card;
}

export function clearCardMeta() {
  cardMeta.clear();
}