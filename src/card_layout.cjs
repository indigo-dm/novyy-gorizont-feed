'use strict';

function visibility(brand) {
  const settings = brand && typeof brand === 'object' ? brand : {};
  return {
    showKeyRender: settings.show_key_render !== false,
    showHouseBadge: settings.show_house_badge !== false,
    showDecoration: settings.show_decoration !== false,
    showLogoPanel: settings.show_logo_panel === true ||
      (settings.show_logo_panel == null && settings.logo_panel === 'light')
  };
}

function optionalElements(brand, item, escapeHtml) {
  const visible = visibility(brand);
  return {
    houseBadge: visible.showHouseBadge ? `<div class="house">${escapeHtml(item.house)}</div>` : '',
    decoration: visible.showDecoration ? `<div class="finish">${escapeHtml(item.decoration)}</div>` : ''
  };
}

module.exports = { optionalElements, visibility };
