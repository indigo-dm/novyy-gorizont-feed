'use strict';

function publishedCardVersion(item) {
  const explicit = String(item && item.card_version || '').trim();
  if (explicit) return explicit;

  const itemId = String(item && item.id || '').trim();
  const images = Array.isArray(item && item.feed_images) ? item.feed_images : [];
  const generated = images.find((image) => image && (image.id === 'brand-card' || image.kind === 'generated'));
  const value = String(generated && generated.url || '').trim();
  if (!itemId || !value) return '';

  try {
    const segments = new URL(value, 'https://feed-studio.invalid').pathname.split('/').filter(Boolean);
    const imagesIndex = segments.lastIndexOf('images');
    if (imagesIndex < 0 || segments[imagesIndex + 1] !== itemId) return '';
    const match = /^([0-9a-f]{16})\.png$/i.exec(segments[imagesIndex + 2] || '');
    return match ? match[1].toLowerCase() : '';
  } catch {
    return '';
  }
}

module.exports = { publishedCardVersion };
