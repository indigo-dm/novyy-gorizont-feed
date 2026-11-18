'use strict';

const assert = require('assert');
const { publishedCardVersion } = require('./card_version.cjs');

const version = '0123456789abcdef';
assert.strictEqual(publishedCardVersion({
  id: '408236193',
  card_version: version,
  feed_images: []
}), version);
assert.strictEqual(publishedCardVersion({
  id: '408236193',
  feed_images: [{
    id: 'brand-card',
    kind: 'generated',
    url: `https://feed-api.indigo-dm.ru/media/projects/orion/images/408236193/${version}.png`
  }]
}), version);
assert.strictEqual(publishedCardVersion({
  id: '408236193',
  feed_images: [{
    id: 'brand-card',
    kind: 'generated',
    url: 'https://feed-api.indigo-dm.ru/media/projects/orion/images/408236193.png'
  }]
}), '');
assert.strictEqual(publishedCardVersion({
  id: '408236193',
  feed_images: [{
    id: 'brand-card',
    kind: 'generated',
    url: `https://feed-api.indigo-dm.ru/media/projects/orion/images/other/${version}.png`
  }]
}), '');

console.log({ explicit_version: true, legacy_url_version: true, invalid_url_rejected: true });
