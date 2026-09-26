(function () {
  'use strict';

  var REPOSITORY = 'indigo-dm/novyy-gorizont-feed';
  var state = {
    registry: null,
    project: null,
    inventory: null,
    status: null,
    assets: null,
    rules: [],
    imageSettings: { lot_overrides: {}, bulk_rules: [] },
    parameterSettings: { lot_values: {}, bulk_rules: [] },
    activeRuleId: null,
    activeView: 'dashboard',
    filters: { house: '', rooms: '', floor: '', search: '' },
    imageFilters: { house: '', rooms: '', floor: '', search: '' },
    parameterFilters: { house: '', rooms: '', floor: '', search: '' },
    page: 1,
    pageSize: 12,
    previewId: null,
    imageLotId: null,
    parameterLotId: null,
    imageUploadBusy: false,
    imageUploadMessage: '',
    imageUploadTone: '',
    dirty: false
  };

  var $ = function (selector, root) { return (root || document).querySelector(selector); };
  var $$ = function (selector, root) { return Array.from((root || document).querySelectorAll(selector)); };
  var esc = function (value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  };
  var safeColor = function (value) {
    return /^#[0-9a-f]{6}$/i.test(String(value || '')) ? String(value) : '#000000';
  };
  var clone = function (value) { return JSON.parse(JSON.stringify(value)); };
  var cacheVersion = function () {
    return state.registry && state.registry.build_id ? String(state.registry.build_id) : 'development';
  };
  var versionedUrl = function (url) {
    return url + (url.indexOf('?') >= 0 ? '&' : '?') + 'v=' + encodeURIComponent(cacheVersion());
  };
  var draftKey = function () { return 'feed-studio-rules-v1-' + (state.project ? state.project.slug : 'default'); };
  var formatPrice = function (value) {
    return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(Number(value)) + ' ₽';
  };
  var formatArea = function (value) {
    return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(Number(value)) + ' м²';
  };
  var formatDateTime = function (value) {
    if (!value) return '—';
    var date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return new Intl.DateTimeFormat('ru-RU', {
      day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit'
    }).format(date);
  };
  var emptyImageSettings = function () { return { lot_overrides: {}, bulk_rules: [] }; };
  var emptyParameterSettings = function () { return { lot_values: {}, bulk_rules: [] }; };

  function itemMatchesFilters(item, filters) {
    var search = String(filters.search || '').trim().toLowerCase();
    return (!filters.house || item.house_id === filters.house) &&
      (!filters.rooms || item.rooms === filters.rooms) &&
      (!filters.floor || String(item.floor) === filters.floor) &&
      (!search || item.id.toLowerCase().indexOf(search) >= 0);
  }

  function ruleMatchesSimple(item, rule) {
    if ((rule.exclude_ids || []).indexOf(String(item.id)) >= 0) return false;
    if ((rule.include_ids || []).length && (rule.include_ids || []).indexOf(String(item.id)) < 0) return false;
    if ((rule.house_ids || []).length && (rule.house_ids || []).indexOf(String(item.house_id)) < 0) return false;
    if ((rule.rooms || []).length && (rule.rooms || []).indexOf(String(item.rooms)) < 0) return false;
    if ((rule.floors || []).length && (rule.floors || []).indexOf(String(item.floor)) < 0) return false;
    var area = Number(item.area);
    if (rule.area_min != null && area < Number(rule.area_min)) return false;
    if (rule.area_max != null && area > Number(rule.area_max)) return false;
    return true;
  }

  function filterRuleFrom(filters, items) {
    return {
      house_ids: filters.house ? [filters.house] : [],
      rooms: filters.rooms ? [filters.rooms] : [],
      floors: filters.floor ? [filters.floor] : [],
      area_min: null,
      area_max: null,
      include_ids: filters.search ? items.map(function (item) { return item.id; }) : [],
      exclude_ids: []
    };
  }

  function normalizeImageSettings(value) {
    var source = value && typeof value === 'object' ? value : {};
    return {
      lot_overrides: source.lot_overrides && typeof source.lot_overrides === 'object' ? clone(source.lot_overrides) : {},
      bulk_rules: Array.isArray(source.bulk_rules) ? clone(source.bulk_rules) : []
    };
  }

  function normalizeParameterSettings(value) {
    var source = value && typeof value === 'object' ? value : {};
    return {
      lot_values: source.lot_values && typeof source.lot_values === 'object' ? clone(source.lot_values) : {},
      bulk_rules: Array.isArray(source.bulk_rules) ? clone(source.bulk_rules) : []
    };
  }

  function emptyRule() {
    return {
      id: 'promotion-' + Date.now(),
      name: 'Новая акция',
      enabled: false,
      label: 'Скидка',
      text: '−10 000 ₽/м²',
      house_ids: [],
      rooms: [],
      area_min: null,
      area_max: null,
      starts_at: '',
      ends_at: '',
      include_ids: [],
      exclude_ids: []
    };
  }

  function normalizeRule(rule) {
    return {
      id: String(rule.id || ('promotion-' + Date.now())).replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 64),
      name: String(rule.name || 'Акция').slice(0, 80),
      enabled: Boolean(rule.enabled),
      label: String(rule.label || 'Акция').slice(0, 24),
      text: String(rule.text || '').slice(0, 60),
      house_ids: Array.isArray(rule.house_ids) ? rule.house_ids.map(String) : [],
      rooms: Array.isArray(rule.rooms) ? rule.rooms.map(String) : [],
      area_min: rule.area_min === '' || rule.area_min == null ? null : Number(rule.area_min),
      area_max: rule.area_max === '' || rule.area_max == null ? null : Number(rule.area_max),
      starts_at: String(rule.starts_at || ''),
      ends_at: String(rule.ends_at || ''),
      include_ids: Array.isArray(rule.include_ids) ? rule.include_ids.map(String) : [],
      exclude_ids: Array.isArray(rule.exclude_ids) ? rule.exclude_ids.map(String) : []
    };
  }

  function showToast(message) {
    var toast = $('#toast');
    toast.textContent = message;
    toast.classList.add('show');
    window.clearTimeout(showToast.timer);
    showToast.timer = window.setTimeout(function () { toast.classList.remove('show'); }, 3200);
  }

  function setDirty(value) {
    state.dirty = value;
    var label = $('#saved-state');
    label.textContent = value ? 'Есть несохранённые изменения' : 'Настройки сохранены';
    label.classList.toggle('unsaved', value);
  }

  function saveDraft(showMessage) {
    localStorage.setItem(draftKey(), JSON.stringify({
      version: 2,
      rules: state.rules,
      image_settings: state.imageSettings,
      parameter_settings: state.parameterSettings
    }));
    setDirty(false);
    if (showMessage) showToast('Черновик сохранён в этом браузере');
  }

  function ruleMatches(item, rule, ignoreExcluded) {
    var today = new Date().toISOString().slice(0, 10);
    if (rule.starts_at && today < rule.starts_at) return false;
    if (rule.ends_at && today > rule.ends_at) return false;
    if (!ignoreExcluded && rule.exclude_ids.indexOf(String(item.id)) >= 0) return false;
    if (rule.include_ids.length && rule.include_ids.indexOf(String(item.id)) < 0) return false;
    if (rule.house_ids.length && rule.house_ids.indexOf(String(item.house_id)) < 0) return false;
    if (rule.rooms.length && rule.rooms.indexOf(String(item.rooms)) < 0) return false;
    var area = Number(item.area);
    if (rule.area_min != null && area < Number(rule.area_min)) return false;
    if (rule.area_max != null && area > Number(rule.area_max)) return false;
    return true;
  }

  function appliedRule(item) {
    return state.rules.find(function (rule) { return rule.enabled && ruleMatches(item, rule, false); }) || null;
  }

  function navigate(view) {
    state.activeView = view;
    $$('.nav-item').forEach(function (button) {
      button.classList.toggle('active', button.dataset.view === view);
    });
    $$('.view').forEach(function (section) {
      section.classList.toggle('active', section.id === 'view-' + view);
    });
    var titles = { dashboard: 'Обзор', lots: 'Квартиры', images: 'Изображения', parameters: 'Параметры', promotions: 'Акции', assets: 'Материалы', preview: 'Предпросмотр' };
    $('#page-title').textContent = titles[view] || 'Управление фидом';
    window.location.hash = view;
    if (view === 'preview') renderPreview();
    if (view === 'assets') renderAssets();
    if (view === 'images') renderImages();
    if (view === 'parameters') renderParameters();
  }

  function renderProjectChrome() {
    if (!state.project || !state.inventory) return;
    $('#project-name').textContent = state.project.name;
    document.title = state.project.name + ' — Feed Studio';
    $('#project-select').value = state.project.slug;
    $('#source-feed-link').href = state.project.base + '/source-profitbase.xml';
    $('#full-feed-link').href = state.project.base + '/full-avito-demo.xml';
    $('#pilot-feed-link').href = state.project.base + '/pilot-avito.xml';
    $('#full-feed-link').textContent = 'Полный фид · ' + state.inventory.full_ads + ' квартир ↗';
    $('#pilot-feed-link').textContent = 'Тестовый фид · ' + state.status.unique_plans + ' планировок ↗';
    if (state.assets && state.assets.brand) {
      document.documentElement.style.setProperty('--project-gold', state.assets.brand.gold);
      document.documentElement.style.setProperty('--project-ink', state.assets.brand.green_dark);
    }
  }

  function renderAssets() {
    if (!state.assets) return;
    $('#upload-assets').href = state.assets.upload_url;
    $('#asset-grid').innerHTML = state.assets.items.map(function (asset) {
      var preview = asset.exists ? '<img src="' + esc(versionedUrl(asset.url)) + '" alt="' + esc(asset.name) + '" loading="lazy" decoding="async">' :
        '<div class="asset-missing">Файл не загружен</div>';
      return '<article class="asset-card"><div class="asset-preview">' + preview + '</div><div class="asset-copy"><div><strong>' +
        esc(asset.name) + '</strong><span class="asset-status ' + (asset.exists ? 'ready' : '') + '">' +
        (asset.exists ? 'Готово' : 'Требуется') + '</span></div><p>' + esc(asset.description) + '</p><code>' +
        esc(asset.filename) + '</code></div></article>';
    }).join('');
    var palette = state.assets.brand.palette || [
      { name: 'Основной', value: state.assets.brand.green },
      { name: 'Акцент', value: state.assets.brand.gold },
      { name: 'Серый', value: state.assets.brand.gray },
      { name: 'Белый', value: state.assets.brand.white }
    ];
    $('#brand-palette').innerHTML = palette.map(function (color) {
      var value = safeColor(color.value);
      return '<div class="palette-item"><span class="palette-swatch" style="background:' + value + '"></span><div><strong>' +
        esc(color.name) + '</strong><code>' + esc(value.toUpperCase()) + '</code></div></div>';
    }).join('');
  }

  function renderStats() {
    $('#stat-source').textContent = state.inventory.source_ads;
    $('#stat-plans').textContent = state.inventory.full_ads || state.inventory.items.length;
    $('#stat-promotions').textContent = state.rules.filter(function (rule) { return rule.enabled; }).length;
    $('#stat-updated').textContent = formatDateTime(state.inventory.checked_at);
    if (state.inventory.items[0]) {
      $('#dashboard-preview').src = versionedUrl(state.inventory.items[0].image);
    }
  }

  function populateFilters() {
    var houses = new Map();
    var rooms = new Set();
    var floors = new Set();
    state.inventory.items.forEach(function (item) {
      houses.set(String(item.house_id), item.house);
      rooms.add(String(item.rooms));
      floors.add(String(item.floor));
    });
    var houseOptions = '<option value="">Все дома</option>' +
      Array.from(houses.entries()).map(function (entry) {
        return '<option value="' + esc(entry[0]) + '">' + esc(entry[1]) + '</option>';
      }).join('');
    var roomOptions = '<option value="">Любая</option>' +
      Array.from(rooms).sort().map(function (room) {
        return '<option value="' + esc(room) + '">' + esc(room) + '-комнатная</option>';
      }).join('');
    var floorOptions = '<option value="">Любой</option>' +
      Array.from(floors).sort(function (left, right) { return Number(left) - Number(right); }).map(function (floor) {
        return '<option value="' + esc(floor) + '">' + esc(floor) + '</option>';
      }).join('');
    $('#filter-house').innerHTML = houseOptions;
    $('#image-filter-house').innerHTML = houseOptions;
    $('#parameter-filter-house').innerHTML = houseOptions;
    $('#filter-rooms').innerHTML = roomOptions;
    $('#image-filter-rooms').innerHTML = roomOptions;
    $('#parameter-filter-rooms').innerHTML = roomOptions;
    $('#filter-floor').innerHTML = floorOptions;
    $('#image-filter-floor').innerHTML = floorOptions;
    $('#parameter-filter-floor').innerHTML = floorOptions;
    var lotOptions = state.inventory.items.map(function (item) {
      return '<option value="' + esc(item.id) + '">' + esc(item.house + ' · ' + item.rooms + 'к · ' + formatArea(item.area)) + '</option>';
    }).join('');
    $('#preview-lot').innerHTML = lotOptions;
    $('#image-lot').innerHTML = lotOptions;
    $('#parameter-lot').innerHTML = lotOptions;
    if (!state.previewId && state.inventory.items[0]) state.previewId = state.inventory.items[0].id;
    if (!state.imageLotId && state.inventory.items[0]) state.imageLotId = state.inventory.items[0].id;
    if (!state.parameterLotId && state.inventory.items[0]) state.parameterLotId = state.inventory.items[0].id;
    $('#preview-lot').value = state.previewId || '';
    $('#image-lot').value = state.imageLotId || '';
    $('#parameter-lot').value = state.parameterLotId || '';
  }

  function lotCard(item) {
    var rule = appliedRule(item);
    return '<article class="lot-card">' +
      '<div class="lot-image"><img src="' + esc(versionedUrl(item.thumbnail || item.image)) + '" alt="' + esc(item.house + ', ' + item.rooms + '-комнатная') + '" loading="lazy" decoding="async" width="480" height="360">' +
      '<span class="lot-badge">' + esc(item.house) + (rule ? ' · акция' : '') + '</span></div>' +
      '<div class="lot-body"><div class="lot-title"><strong>' + esc(item.rooms) + '-комнатная · ' + esc(formatArea(item.area)) + '</strong><span>ID ' + esc(item.id) + '</span></div>' +
      '<div class="lot-meta">' + esc(formatPrice(item.price)) + ' · этаж ' + esc(item.floor) + '/' + esc(item.floors) + '</div>' +
      '<div class="lot-actions"><button data-preview="' + esc(item.id) + '">Предпросмотр</button></div></div></article>';
  }

  function renderLots() {
    var items = state.inventory.items.filter(function (item) { return itemMatchesFilters(item, state.filters); });
    $('#lots-count').textContent = items.length;
    var pageCount = Math.max(1, Math.ceil(items.length / state.pageSize));
    state.page = Math.min(Math.max(1, state.page), pageCount);
    var start = (state.page - 1) * state.pageSize;
    var visibleItems = items.slice(start, start + state.pageSize);
    $('#lots-grid').innerHTML = visibleItems.length ? visibleItems.map(lotCard).join('') :
      '<div class="panel empty-state">По заданным фильтрам ничего не найдено.</div>';
    var pagination = $('#lots-pagination');
    if (items.length <= state.pageSize) {
      pagination.innerHTML = '';
    } else {
      var buttons = '<button data-page="' + (state.page - 1) + '" ' + (state.page === 1 ? 'disabled' : '') + '>←</button>';
      for (var page = 1; page <= pageCount; page += 1) {
        buttons += '<button class="' + (page === state.page ? 'active' : '') + '" data-page="' + page + '">' + page + '</button>';
      }
      buttons += '<button data-page="' + (state.page + 1) + '" ' + (state.page === pageCount ? 'disabled' : '') + '>→</button>';
      pagination.innerHTML = buttons;
      $$('[data-page]', pagination).forEach(function (button) {
        button.addEventListener('click', function () {
          if (button.disabled) return;
          state.page = Number(button.dataset.page);
          renderLots();
          document.getElementById('view-lots').scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
      });
    }
    $$('[data-preview]', $('#lots-grid')).forEach(function (button) {
      button.addEventListener('click', function () {
        state.previewId = button.dataset.preview;
        $('#preview-lot').value = state.previewId;
        navigate('preview');
      });
    });
  }

  function moveArrayItem(items, fromPosition, toPosition) {
    var from = Number(fromPosition) - 1;
    var to = Number(toPosition) - 1;
    if (from < 0 || from >= items.length || to < 0 || to >= items.length) return items;
    var copy = items.slice();
    var moved = copy.splice(from, 1)[0];
    copy.splice(to, 0, moved);
    return copy;
  }

  function imageOverride(item) {
    if (!state.imageSettings.lot_overrides[item.id]) {
      state.imageSettings.lot_overrides[item.id] = { order: [], hidden: [], added: [] };
    }
    var override = state.imageSettings.lot_overrides[item.id];
    if (!Array.isArray(override.order)) override.order = [];
    if (!Array.isArray(override.hidden)) override.hidden = [];
    if (!Array.isArray(override.added)) override.added = [];
    return override;
  }

  function addImageToItem(item, image) {
    var override = imageOverride(item);
    if ((override.added || []).length >= 20) throw new Error('Для одного лота можно добавить не более 20 изображений.');
    override.added.push(image);
    override.order = effectiveImages(item).map(function (current) { return current.id; });
    setDirty(true);
  }

  function uploadServiceUrl() {
    return state.assets && /^https:\/\//i.test(String(state.assets.upload_service_url || '')) ? String(state.assets.upload_service_url) : '';
  }

  function renderImageUploadState() {
    var zone = $('#image-drop-zone');
    var button = $('#choose-image-file');
    var status = $('#image-upload-status');
    if (!zone || !button || !status) return;
    var available = Boolean(uploadServiceUrl() && state.imageLotId);
    zone.classList.toggle('disabled', !available);
    zone.classList.toggle('uploading', state.imageUploadBusy);
    button.disabled = !available || state.imageUploadBusy;
    status.className = 'image-upload-status' + (state.imageUploadTone ? ' ' + state.imageUploadTone : '');
    status.textContent = state.imageUploadMessage || (available ? 'Изображение будет уменьшено до 2000 px и сохранено в GitHub.' : 'Загрузка файлов станет доступна после подключения защищённого хранилища.');
  }

  function setImageUploadMessage(message, tone) {
    state.imageUploadMessage = message || '';
    state.imageUploadTone = tone || '';
    renderImageUploadState();
  }

  async function optimizeImageFile(file) {
    var allowed = ['image/jpeg', 'image/png', 'image/webp'];
    if (!file || allowed.indexOf(file.type) < 0) throw new Error('Выберите изображение JPG, PNG или WebP.');
    if (file.size > 20 * 1024 * 1024) throw new Error('Исходный файл не должен превышать 20 МБ.');
    var bitmap = await createImageBitmap(file);
    var maxSide = 2000;
    var scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    var width = Math.max(1, Math.round(bitmap.width * scale));
    var height = Math.max(1, Math.round(bitmap.height * scale));
    var canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    var context = canvas.getContext('2d', { alpha: false });
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, width, height);
    context.drawImage(bitmap, 0, 0, width, height);
    if (bitmap.close) bitmap.close();
    var blob = await new Promise(function (resolve) { canvas.toBlob(resolve, 'image/jpeg', 0.88); });
    if (!blob) throw new Error('Не удалось подготовить изображение.');
    if (blob.size > 10 * 1024 * 1024) throw new Error('После оптимизации файл превышает 10 МБ.');
    var name = String(file.name || 'image').replace(/\.[^.]+$/, '').replace(/[^A-Za-zА-Яа-яЁё0-9_-]+/g, '-').slice(0, 60) || 'image';
    return new File([blob], name + '.jpg', { type: 'image/jpeg' });
  }

  async function uploadImageFile(file) {
    var item = state.inventory.items.find(function (lot) { return lot.id === state.imageLotId; });
    var endpoint = uploadServiceUrl();
    if (!item || !endpoint || state.imageUploadBusy) return;
    var credential = window.FEED_STUDIO_CREDENTIAL && window.FEED_STUDIO_CREDENTIAL.get ? window.FEED_STUDIO_CREDENTIAL.get() : '';
    if (!credential) {
      credential = window.prompt('Введите пароль Feed Studio для загрузки файла:') || '';
      if (credential && window.FEED_STUDIO_CREDENTIAL && window.FEED_STUDIO_CREDENTIAL.set) window.FEED_STUDIO_CREDENTIAL.set(credential);
    }
    if (!credential) return;
    state.imageUploadBusy = true;
    setImageUploadMessage('Оптимизируем и загружаем изображение…', '');
    try {
      var optimized = await optimizeImageFile(file);
      var body = new FormData();
      body.append('project', state.project.slug);
      body.append('lot', item.id);
      body.append('file', optimized, optimized.name);
      var response = await fetch(endpoint, {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + credential },
        body: body
      });
      var payload = await response.json().catch(function () { return {}; });
      if (!response.ok) {
        if (response.status === 401 && window.FEED_STUDIO_CREDENTIAL && window.FEED_STUDIO_CREDENTIAL.set) window.FEED_STUDIO_CREDENTIAL.set('');
        throw new Error(payload.error || 'Сервис загрузки вернул ошибку.');
      }
      if (!/^https:\/\//i.test(String(payload.url || '')) || !/^[A-Za-z0-9_-]+$/.test(String(payload.id || ''))) {
        throw new Error('Сервис загрузки вернул некорректный ответ.');
      }
      addImageToItem(item, { id: String(payload.id), url: String(payload.url) });
      setImageUploadMessage('Изображение загружено и добавлено в галерею.', 'success');
      renderImages();
    } catch (error) {
      setImageUploadMessage(error.message || 'Не удалось загрузить изображение.', 'error');
    } finally {
      state.imageUploadBusy = false;
      renderImageUploadState();
    }
  }

  function effectiveImages(item) {
    var images = [{ id: 'brand-card', url: item.final_image, kind: 'generated', label: 'Брендированная карточка' }]
      .concat((item.source_images || []).map(function (image) {
        return { id: image.id, url: image.url, kind: 'source', label: 'Profitbase · исходная позиция ' + image.position };
      }));
    state.imageSettings.bulk_rules.forEach(function (rule) {
      if (rule.enabled !== false && ruleMatchesSimple(item, rule)) {
        images = moveArrayItem(images, rule.from_position, rule.to_position);
      }
    });
    var override = state.imageSettings.lot_overrides[item.id] || { order: [], hidden: [], added: [] };
    (override.added || []).forEach(function (image) {
      images.push({ id: image.id, url: image.url, kind: 'added', label: 'Добавлено вручную' });
    });
    var hidden = override.hidden || [];
    images = images.filter(function (image) { return hidden.indexOf(image.id) < 0; });
    var ranks = new Map((override.order || []).map(function (id, index) { return [id, index]; }));
    var sourceRanks = new Map(images.map(function (image, index) { return [image.id, index]; }));
    images.sort(function (left, right) {
      var leftRank = ranks.has(left.id) ? ranks.get(left.id) : ranks.size + sourceRanks.get(left.id);
      var rightRank = ranks.has(right.id) ? ranks.get(right.id) : ranks.size + sourceRanks.get(right.id);
      return leftRank - rightRank;
    });
    return images;
  }

  function filteredImageItems() {
    return state.inventory.items.filter(function (item) { return itemMatchesFilters(item, state.imageFilters); });
  }

  function renderImageBulkRules() {
    $('#image-bulk-rules').innerHTML = state.imageSettings.bulk_rules.length ? state.imageSettings.bulk_rules.map(function (rule) {
      var count = state.inventory.items.filter(function (item) { return ruleMatchesSimple(item, rule); }).length;
      var floorLabel = (rule.floors || []).length ? ' · этаж ' + rule.floors.join(', ') : '';
      return '<div class="bulk-rule"><div><strong>' + esc(rule.name) + '</strong><small>' + count +
        ' квартир' + esc(floorLabel) + ' · ' + esc(rule.from_position) + ' → ' + esc(rule.to_position) + '</small></div><button data-delete-image-rule="' +
        esc(rule.id) + '" aria-label="Удалить правило">×</button></div>';
    }).join('') : '<p class="helper">Массовых правил пока нет.</p>';
    $$('[data-delete-image-rule]', $('#image-bulk-rules')).forEach(function (button) {
      button.addEventListener('click', function () {
        state.imageSettings.bulk_rules = state.imageSettings.bulk_rules.filter(function (rule) { return rule.id !== button.dataset.deleteImageRule; });
        setDirty(true);
        renderImages();
      });
    });
  }

  function renderImages() {
    if (!state.inventory) return;
    var filtered = filteredImageItems();
    $('#image-filter-count').textContent = filtered.length;
    if (!filtered.some(function (item) { return item.id === state.imageLotId; })) state.imageLotId = filtered[0] ? filtered[0].id : null;
    $('#image-lot').innerHTML = filtered.map(function (item) {
      return '<option value="' + esc(item.id) + '">' + esc(item.house + ' · ' + item.rooms + 'к · ID ' + item.id) + '</option>';
    }).join('');
    $('#image-lot').value = state.imageLotId || '';
    var item = state.inventory.items.find(function (lot) { return lot.id === state.imageLotId; });
    if (!item) {
      $('#image-gallery').innerHTML = '<div class="parameter-empty">По выбранным фильтрам квартир нет.</div>';
      $('#removed-images-wrap').classList.add('hidden');
      renderImageBulkRules();
      renderImageUploadState();
      return;
    }
    var images = effectiveImages(item);
    $('#image-gallery').innerHTML = images.map(function (image, index) {
      var imageUrl = image.kind === 'generated' ? versionedUrl(image.url) : image.url;
      return '<article class="image-item"><div class="image-item-preview"><img src="' + esc(imageUrl) + '" alt="Изображение ' +
        (index + 1) + '" loading="lazy" decoding="async"><span class="image-position">' + (index + 1) + '</span><span class="image-kind">' +
        esc(image.kind === 'generated' ? 'Feed Studio' : image.kind === 'source' ? 'Profitbase' : 'Добавлено') +
        '</span></div><div class="image-item-copy"><small title="' + esc(image.label) + '">' + esc(image.label) +
        '</small><div class="image-actions"><button data-image-left="' + esc(image.id) + '" ' + (index === 0 ? 'disabled' : '') +
        '>← Выше</button><button data-image-right="' + esc(image.id) + '" ' + (index === images.length - 1 ? 'disabled' : '') +
        '>Ниже →</button><button class="remove-image" data-remove-image="' + esc(image.id) + '" ' +
        (image.kind === 'generated' ? 'disabled title="Брендированную карточку нельзя исключить"' :
          'title="Не включать изображение в новый фид Avito"') + '>Исключить из фида</button></div></div></article>';
    }).join('');
    function saveOrder(nextImages) {
      imageOverride(item).order = nextImages.map(function (image) { return image.id; });
      setDirty(true);
      renderImages();
    }
    $$('[data-image-left]', $('#image-gallery')).forEach(function (button) {
      button.addEventListener('click', function () {
        var index = images.findIndex(function (image) { return image.id === button.dataset.imageLeft; });
        saveOrder(moveArrayItem(images, index + 1, index));
      });
    });
    $$('[data-image-right]', $('#image-gallery')).forEach(function (button) {
      button.addEventListener('click', function () {
        var index = images.findIndex(function (image) { return image.id === button.dataset.imageRight; });
        saveOrder(moveArrayItem(images, index + 1, index + 2));
      });
    });
    $$('[data-remove-image]', $('#image-gallery')).forEach(function (button) {
      button.addEventListener('click', function () {
        if (button.disabled) return;
        var override = imageOverride(item);
        var current = images.find(function (image) { return image.id === button.dataset.removeImage; });
        if (current && override.hidden.indexOf(current.id) < 0) override.hidden.push(current.id);
        override.order = images.filter(function (image) { return image.id !== current.id; }).map(function (image) { return image.id; });
        setDirty(true);
        renderImages();
      });
    });
    var override = state.imageSettings.lot_overrides[item.id] || { hidden: [] };
    var hiddenIds = override.hidden || [];
    var hiddenImages = (item.source_images || []).map(function (image) {
      return { id: image.id, url: image.url, label: 'Profitbase · исходная позиция ' + image.position, kind: 'source' };
    }).concat((override.added || []).map(function (image) {
      return { id: image.id, url: image.url, label: 'Добавлено вручную', kind: 'added' };
    })).filter(function (image) { return hiddenIds.indexOf(image.id) >= 0; });
    $('#removed-images-wrap').classList.toggle('hidden', hiddenImages.length === 0);
    $('#removed-images').innerHTML = hiddenImages.map(function (image) {
      return '<div class="removed-image"><img src="' + esc(image.url) + '" alt="" loading="lazy" decoding="async"><span>' +
        esc(image.label) + '</span><button class="restore-image" data-restore-image="' + esc(image.id) + '">Вернуть в фид</button></div>';
    }).join('');
    $$('[data-restore-image]', $('#removed-images')).forEach(function (button) {
      button.addEventListener('click', function () {
        var currentOverride = imageOverride(item);
        currentOverride.hidden = currentOverride.hidden.filter(function (id) { return id !== button.dataset.restoreImage; });
        setDirty(true);
        renderImages();
      });
    });
    renderImageBulkRules();
    renderImageUploadState();
  }

  function supportedParameters() {
    return (state.inventory.parameter_catalog || []).filter(function (item) { return item.supported; });
  }

  function parameterByTag(tag) {
    return (state.inventory.parameter_catalog || []).find(function (item) { return item.tag === tag; });
  }

  function effectiveParameters(item) {
    var values = {};
    state.parameterSettings.bulk_rules.forEach(function (rule) {
      if (rule.enabled !== false && ruleMatchesSimple(item, rule)) Object.assign(values, rule.values || {});
    });
    Object.assign(values, state.parameterSettings.lot_values[item.id] || {});
    return values;
  }

  function parameterControl(catalog, value, prefix) {
    if (!catalog) return '';
    if (catalog.kind === 'multi') {
      var selected = Array.isArray(value) ? value : [];
      return '<div class="check-group">' + (catalog.values || []).map(function (option) {
        return '<label class="check-chip"><input type="checkbox" data-' + prefix + '-multi="' + esc(catalog.tag) + '" value="' + esc(option) + '" ' +
          (selected.indexOf(option) >= 0 ? 'checked' : '') + '><span>' + esc(option) + '</span></label>';
      }).join('') + '</div>';
    }
    if (catalog.kind === 'number') {
      return '<input type="number" data-' + prefix + '-value="' + esc(catalog.tag) + '" min="' + esc(catalog.min) + '" max="' +
        esc(catalog.max) + '" step="' + esc(catalog.step) + '" value="' + esc(value || catalog.min) + '">';
    }
    return '<select data-' + prefix + '-value="' + esc(catalog.tag) + '">' + (catalog.values || []).map(function (option) {
      return '<option value="' + esc(option) + '" ' + (String(value) === String(option) ? 'selected' : '') + '>' + esc(option) + '</option>';
    }).join('') + '</select>';
  }

  function readParameterControl(root, catalog, prefix) {
    if (catalog.kind === 'multi') {
      return $$('[data-' + prefix + '-multi="' + catalog.tag + '"]:checked', root).map(function (input) { return input.value; });
    }
    var control = $('[data-' + prefix + '-value="' + catalog.tag + '"]', root);
    return control ? control.value : '';
  }

  function filteredParameterItems() {
    return state.inventory.items.filter(function (item) { return itemMatchesFilters(item, state.parameterFilters); });
  }

  function renderParameterBulkValue() {
    var catalog = parameterByTag($('#bulk-parameter-tag').value);
    $('#bulk-parameter-value').innerHTML = catalog ? '<label class="field"><span>Значение</span>' + parameterControl(catalog, catalog.kind === 'multi' ? [catalog.values[0]] : catalog.values ? catalog.values[0] : catalog.min, 'bulk-param') + '</label>' : '';
  }

  function renderParameterBulkRules() {
    $('#parameter-bulk-rules').innerHTML = state.parameterSettings.bulk_rules.length ? state.parameterSettings.bulk_rules.map(function (rule) {
      var count = state.inventory.items.filter(function (item) { return ruleMatchesSimple(item, rule); }).length;
      var labels = Object.keys(rule.values || {}).map(function (tag) { return (parameterByTag(tag) || { name: tag }).name; }).join(', ');
      var floorLabel = (rule.floors || []).length ? ' · этаж ' + rule.floors.join(', ') : '';
      return '<div class="bulk-rule"><div><strong>' + esc(rule.name) + '</strong><small>' + count + ' квартир' + esc(floorLabel) + ' · ' + esc(labels) +
        '</small></div><button data-delete-parameter-rule="' + esc(rule.id) + '" aria-label="Удалить правило">×</button></div>';
    }).join('') : '<p class="helper">Массовых правил пока нет.</p>';
    $$('[data-delete-parameter-rule]', $('#parameter-bulk-rules')).forEach(function (button) {
      button.addEventListener('click', function () {
        state.parameterSettings.bulk_rules = state.parameterSettings.bulk_rules.filter(function (rule) { return rule.id !== button.dataset.deleteParameterRule; });
        setDirty(true);
        renderParameters();
      });
    });
  }

  function renderParameters() {
    if (!state.inventory) return;
    var tagCounts = state.inventory.source_tag_counts || {};
    var tags = Object.keys(tagCounts).sort();
    $('#source-tags-count').textContent = tags.length + ' тегов';
    $('#source-tags').innerHTML = tags.map(function (tag) {
      return '<span class="tag-chip">' + esc(tag) + ' <strong>' + esc(tagCounts[tag]) + '</strong></span>';
    }).join('');
    var filtered = filteredParameterItems();
    $('#parameter-filter-count').textContent = filtered.length;
    if (!filtered.some(function (item) { return item.id === state.parameterLotId; })) state.parameterLotId = filtered[0] ? filtered[0].id : null;
    $('#parameter-lot').innerHTML = filtered.map(function (item) {
      return '<option value="' + esc(item.id) + '">' + esc(item.house + ' · ' + item.rooms + 'к · ID ' + item.id) + '</option>';
    }).join('');
    $('#parameter-lot').value = state.parameterLotId || '';
    var item = state.inventory.items.find(function (lot) { return lot.id === state.parameterLotId; });
    var supported = supportedParameters();
    var catalogOptions = supported.map(function (catalog) {
      var count = tagCounts[catalog.tag] || 0;
      return '<option value="' + esc(catalog.tag) + '">' + esc(catalog.name) + (count ? ' · уже есть в Profitbase' : '') + '</option>';
    }).join('');
    $('#new-parameter-tag').innerHTML = catalogOptions;
    $('#bulk-parameter-tag').innerHTML = catalogOptions;
    var deferred = (state.inventory.parameter_catalog || []).filter(function (catalog) { return !catalog.supported; }).map(function (catalog) { return catalog.tag; });
    $('#parameter-catalog-note').textContent = deferred.length ? 'После сверки справочника Avito добавим: ' + deferred.join(', ') + '.' : '';
    if (!item) {
      $('#parameter-list').innerHTML = '<div class="parameter-empty">По выбранным фильтрам квартир нет.</div>';
      renderParameterBulkValue();
      renderParameterBulkRules();
      return;
    }
    var values = effectiveParameters(item);
    var tagsWithValues = Object.keys(values);
    $('#parameter-list').innerHTML = tagsWithValues.length ? tagsWithValues.map(function (tag) {
      var catalog = parameterByTag(tag);
      var individual = Object.prototype.hasOwnProperty.call(state.parameterSettings.lot_values[item.id] || {}, tag);
      return '<div class="parameter-row"><div class="parameter-row-title"><strong>' + esc(catalog ? catalog.name : tag) +
        '</strong><code>' + esc(tag) + (individual ? ' · для лота' : ' · массовое правило') + '</code></div><div>' +
        parameterControl(catalog, values[tag], 'param') + '</div><button class="remove-parameter" data-remove-parameter="' + esc(tag) + '" ' +
        (individual ? '' : 'disabled title="Удалите массовое правило справа"') + '>×</button></div>';
    }).join('') : '<div class="parameter-empty">Дополнительные параметры для этой квартиры ещё не назначены.</div>';
    $$('[data-param-value]', $('#parameter-list')).concat($$('[data-param-multi]', $('#parameter-list'))).forEach(function (control) {
      control.addEventListener('change', function () {
        var tag = control.dataset.paramValue || control.dataset.paramMulti;
        var catalog = parameterByTag(tag);
        if (!state.parameterSettings.lot_values[item.id]) state.parameterSettings.lot_values[item.id] = {};
        state.parameterSettings.lot_values[item.id][tag] = readParameterControl($('#parameter-list'), catalog, 'param');
        setDirty(true);
      });
    });
    $$('[data-remove-parameter]', $('#parameter-list')).forEach(function (button) {
      button.addEventListener('click', function () {
        if (button.disabled) return;
        delete state.parameterSettings.lot_values[item.id][button.dataset.removeParameter];
        if (!Object.keys(state.parameterSettings.lot_values[item.id]).length) delete state.parameterSettings.lot_values[item.id];
        setDirty(true);
        renderParameters();
      });
    });
    renderParameterBulkValue();
    renderParameterBulkRules();
  }

  function renderRuleList() {
    $('#rules-list').innerHTML = state.rules.map(function (rule, index) {
      var count = state.inventory.items.filter(function (item) { return ruleMatches(item, rule, false); }).length;
      return '<button class="rule-item ' + (rule.id === state.activeRuleId ? 'active' : '') + '" data-rule-id="' + esc(rule.id) + '">' +
        '<span class="rule-state ' + (rule.enabled ? 'on' : '') + '"></span><span class="rule-copy"><strong>' +
        esc((index + 1) + '. ' + rule.name) + '</strong><small>' + count + ' квартир · ' + (rule.enabled ? 'включена' : 'выключена') +
        '</small></span></button>';
    }).join('');
    $$('[data-rule-id]', $('#rules-list')).forEach(function (button) {
      button.addEventListener('click', function () {
        state.activeRuleId = button.dataset.ruleId;
        renderRuleList();
        renderRuleEditor();
      });
    });
  }

  function chips(name, values, selected, labels) {
    return values.map(function (value) {
      return '<label class="check-chip"><input type="checkbox" data-array="' + esc(name) + '" value="' + esc(value) + '" ' +
        (selected.indexOf(String(value)) >= 0 ? 'checked' : '') + '><span>' + esc(labels[value] || value) + '</span></label>';
    }).join('');
  }

  function renderRuleEditor() {
    var editor = $('#rule-editor');
    var rule = state.rules.find(function (item) { return item.id === state.activeRuleId; });
    if (!rule) {
      editor.innerHTML = '<div class="empty-state">Выберите или создайте правило акции.</div>';
      return;
    }
    var houses = [];
    var houseLabels = {};
    var roomValues = [];
    state.inventory.items.forEach(function (item) {
      if (houses.indexOf(item.house_id) < 0) houses.push(item.house_id);
      houseLabels[item.house_id] = item.house;
      if (roomValues.indexOf(item.rooms) < 0) roomValues.push(item.rooms);
    });
    roomValues.sort();
    var roomLabels = {};
    roomValues.forEach(function (room) { roomLabels[room] = room + '-комнатные'; });
    var groupMatches = state.inventory.items.filter(function (item) { return ruleMatches(item, rule, true); });
    var finalMatches = groupMatches.filter(function (item) { return rule.exclude_ids.indexOf(String(item.id)) < 0; });
    var index = state.rules.indexOf(rule);
    editor.innerHTML =
      '<div class="editor-header"><div><p class="eyebrow">Правило ' + (index + 1) + '</p><h2>' + esc(rule.name) + '</h2></div>' +
      '<div class="editor-header-actions"><button class="button button-secondary" id="move-rule-up" ' + (index === 0 ? 'disabled' : '') + '>↑ Выше</button>' +
      '<button class="button button-danger" id="delete-rule">Удалить</button></div></div>' +
      '<div class="form-grid">' +
      '<label class="field field-wide"><span>Название правила</span><input data-field="name" value="' + esc(rule.name) + '" maxlength="80"></label>' +
      '<label class="field"><span>Короткая метка</span><input data-field="label" value="' + esc(rule.label) + '" maxlength="24"></label>' +
      '<label class="field"><span>Текст на изображении</span><input data-field="text" value="' + esc(rule.text) + '" maxlength="60"></label>' +
      '<div class="field field-wide"><span>Статус</span><div class="switch-row"><label class="switch"><input type="checkbox" data-field="enabled" ' +
      (rule.enabled ? 'checked' : '') + '><span></span></label><strong>' + (rule.enabled ? 'Акция включена' : 'Акция выключена') + '</strong></div></div>' +
      '<div class="field field-wide"><span>Дома · ничего не выбрано = все</span><div class="check-group">' +
      chips('house_ids', houses, rule.house_ids, houseLabels) + '</div></div>' +
      '<div class="field field-wide"><span>Комнатность · ничего не выбрано = любая</span><div class="check-group">' +
      chips('rooms', roomValues, rule.rooms, roomLabels) + '</div></div>' +
      '<div class="field"><span>Площадь, м²</span><div class="field-row"><input type="number" min="0" max="500" step="0.1" data-field="area_min" placeholder="От" value="' +
      (rule.area_min == null ? '' : esc(rule.area_min)) + '"><input type="number" min="0" max="500" step="0.1" data-field="area_max" placeholder="До" value="' +
      (rule.area_max == null ? '' : esc(rule.area_max)) + '"></div></div>' +
      '<div class="field"><span>Период действия</span><div class="field-row"><input type="date" data-field="starts_at" value="' + esc(rule.starts_at) +
      '"><input type="date" data-field="ends_at" value="' + esc(rule.ends_at) + '"></div></div></div>' +
      '<div class="match-block"><div class="match-heading"><div><p class="eyebrow">Результат условия</p><h2>Подходящие квартиры</h2></div><div><strong>' +
      finalMatches.length + '</strong><span> из ' + groupMatches.length + ' после исключений</span></div></div>' +
      '<div class="match-list">' + (groupMatches.length ? groupMatches.map(function (item) {
        var excluded = rule.exclude_ids.indexOf(String(item.id)) >= 0;
        return '<div class="match-item"><div><strong>' + esc(item.house + ' · ' + item.rooms + 'к · ' + formatArea(item.area)) +
          '</strong><small>ID ' + esc(item.id) + '</small></div><button class="exclude-button ' + (excluded ? 'excluded' : '') +
          '" data-exclude="' + esc(item.id) + '">' + (excluded ? 'Вернуть' : 'Исключить') + '</button></div>';
      }).join('') : '<div class="empty-state">Нет подходящих квартир.</div>') + '</div></div>';

    $$('[data-field]', editor).forEach(function (input) {
      var eventName = input.type === 'text' ? 'input' : 'change';
      input.addEventListener(eventName, function () {
        var field = input.dataset.field;
        if (input.type === 'checkbox') rule[field] = input.checked;
        else if (field === 'area_min' || field === 'area_max') rule[field] = input.value === '' ? null : Number(input.value);
        else rule[field] = input.value;
        setDirty(true);
        renderStats();
        renderRuleList();
        renderLots();
        renderPreview();
        if (eventName === 'change') renderRuleEditor();
      });
    });
    $$('[data-array]', editor).forEach(function (input) {
      input.addEventListener('change', function () {
        var field = input.dataset.array;
        if (input.checked && rule[field].indexOf(input.value) < 0) rule[field].push(input.value);
        if (!input.checked) rule[field] = rule[field].filter(function (value) { return value !== input.value; });
        setDirty(true);
        renderAll();
      });
    });
    $$('[data-exclude]', editor).forEach(function (button) {
      button.addEventListener('click', function () {
        var id = button.dataset.exclude;
        if (rule.exclude_ids.indexOf(id) >= 0) rule.exclude_ids = rule.exclude_ids.filter(function (value) { return value !== id; });
        else rule.exclude_ids.push(id);
        setDirty(true);
        renderAll();
      });
    });
    $('#delete-rule').addEventListener('click', function () {
      if (!window.confirm('Удалить правило «' + rule.name + '»?')) return;
      state.rules = state.rules.filter(function (item) { return item.id !== rule.id; });
      state.activeRuleId = state.rules[0] ? state.rules[0].id : null;
      setDirty(true);
      renderAll();
    });
    $('#move-rule-up').addEventListener('click', function () {
      if (index <= 0) return;
      state.rules.splice(index, 1);
      state.rules.splice(index - 1, 0, rule);
      setDirty(true);
      renderAll();
    });
  }

  function renderPreview() {
    if (!state.inventory || !state.inventory.items.length) return;
    var item = state.inventory.items.find(function (lot) { return lot.id === state.previewId; }) || state.inventory.items[0];
    state.previewId = item.id;
    $('#preview-lot').value = item.id;
    $('#preview-image').src = versionedUrl(item.image);
    $('#preview-title').textContent = item.rooms + '-комнатная, ' + formatArea(item.area);
    $('#preview-details').innerHTML =
      '<div><dt>Дом</dt><dd>' + esc(item.house) + '</dd></div><div><dt>ID</dt><dd>' + esc(item.id) + '</dd></div>' +
      '<div><dt>Цена</dt><dd>' + esc(formatPrice(item.price)) + '</dd></div><div><dt>Этаж</dt><dd>' + esc(item.floor + '/' + item.floors) + '</dd></div>';
    var rule = appliedRule(item);
    var promo = $('#live-promo');
    promo.classList.toggle('hidden', !rule);
    if (rule) {
      $('#live-promo-label').textContent = rule.label;
      $('#live-promo-text').textContent = rule.text;
      $('#applied-rule').innerHTML = '<span>Применяется правило</span><strong>' + esc(rule.name) + ': ' + esc(rule.text) + '</strong>';
    } else {
      $('#applied-rule').innerHTML = '<span>Акция</span><strong>К этой квартире не применяется</strong>';
    }
  }

  function renderAll() {
    renderProjectChrome();
    renderStats();
    renderLots();
    renderImages();
    renderParameters();
    renderRuleList();
    renderRuleEditor();
    renderAssets();
    renderPreview();
  }

  function settingsPayload() {
    return {
      version: 2,
      project: state.project.slug,
      rules: state.rules.map(normalizeRule),
      image_settings: clone(state.imageSettings),
      parameter_settings: clone(state.parameterSettings)
    };
  }

  function validateSettings() {
    if (state.rules.length > 10) return 'Допускается не более 10 правил.';
    if (state.imageSettings.bulk_rules.length > 30) return 'Допускается не более 30 массовых правил изображений.';
    if (state.parameterSettings.bulk_rules.length > 30) return 'Допускается не более 30 массовых правил параметров.';
    for (var i = 0; i < state.rules.length; i += 1) {
      var rule = state.rules[i];
      if (!rule.name.trim()) return 'У правила ' + (i + 1) + ' нет названия.';
      if (rule.enabled && !rule.text.trim()) return 'У активного правила «' + rule.name + '» нет текста.';
      if (rule.area_min != null && rule.area_max != null && Number(rule.area_min) > Number(rule.area_max)) {
        return 'В правиле «' + rule.name + '» минимальная площадь больше максимальной.';
      }
      if (rule.starts_at && rule.ends_at && rule.starts_at > rule.ends_at) {
        return 'В правиле «' + rule.name + '» дата начала позже даты окончания.';
      }
    }
    return '';
  }

  function openPublishModal() {
    var error = validateSettings();
    if (error) {
      showToast(error);
      return;
    }
    saveDraft(false);
    var enabled = state.rules.filter(function (rule) { return rule.enabled; });
    var affected = state.inventory.items.filter(function (item) { return Boolean(appliedRule(item)); }).length;
    $('#publish-summary').innerHTML = '<strong>' + enabled.length + ' активных правил</strong><br>' +
      affected + ' из ' + state.inventory.items.length + ' квартир получат акцию.<br>' +
      Object.keys(state.imageSettings.lot_overrides).length + ' индивидуальных галерей и ' + state.imageSettings.bulk_rules.length + ' массовых правил изображений.<br>' +
      Object.keys(state.parameterSettings.lot_values).length + ' квартир с дополнительными параметрами и ' + state.parameterSettings.bulk_rules.length + ' массовых правил параметров.';
    $('#publish-modal').classList.remove('hidden');
  }

  function confirmPublish() {
    var payload = JSON.stringify(settingsPayload(), null, 2);
    var body = 'Запрос на обновление настроек демонстрационного фида.\n\n' +
      'FEED_SETTINGS_JSON_START\n' + payload + '\nFEED_SETTINGS_JSON_END\n\n' +
      'Запрос сформирован кабинетом Feed Studio. Workflow применит его только от владельца репозитория.';
    var title = '[feed-settings] ' + state.project.name + ': обновить настройки фида';
    var url = 'https://github.com/' + REPOSITORY + '/issues/new?title=' + encodeURIComponent(title) + '&body=' + encodeURIComponent(body);
    if (url.length > 7800) {
      showToast('Настройки слишком объёмные для отправки. Скачайте JSON и сократите исключения.');
      downloadSettings();
      return;
    }
    window.open(url, '_blank', 'noopener');
    $('#publish-modal').classList.add('hidden');
    showToast('Подтвердите запрос в открывшемся окне GitHub');
  }

  function downloadSettings() {
    var data = JSON.stringify(settingsPayload(), null, 2);
    var blob = new Blob([data], { type: 'application/json;charset=utf-8' });
    var link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = state.project.slug + '-promotion-rules.json';
    link.click();
    URL.revokeObjectURL(link.href);
  }

  function slugify(value) {
    var map = { а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch', ы: 'y', э: 'e', ю: 'yu', я: 'ya', ь: '', ъ: '' };
    return String(value || '').toLowerCase().split('').map(function (char) { return map[char] == null ? char : map[char]; }).join('')
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);
  }

  function openProjectModal() {
    $('#new-project-slug').dataset.edited = '';
    $('#new-project-name').value = '';
    $('#new-project-slug').value = '';
    $('#project-modal').classList.remove('hidden');
    $('#new-project-name').focus();
  }

  function syncProjectIdentifiers() {
    var slug = slugify($('#new-project-name').value);
    if (!$('#new-project-slug').dataset.edited) $('#new-project-slug').value = slug;
  }

  function confirmProject() {
    var name = $('#new-project-name').value.trim();
    var slug = $('#new-project-slug').value.trim();
    if (!name || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
      showToast('Проверьте название и системное имя объекта.');
      return;
    }
    if (state.registry.projects.some(function (project) { return project.slug === slug; })) {
      showToast('Объект с таким системным именем уже существует.');
      return;
    }
    var payload = { version: 1, name: name, slug: slug };
    var body = 'Запрос на создание нового объекта Feed Studio.\n\n' +
      'FEED_PROJECT_JSON_START\n' + JSON.stringify(payload, null, 2) + '\nFEED_PROJECT_JSON_END\n\n' +
      'После создания нужно добавить закрытую ссылку Profitbase и фирменные материалы.';
    var title = '[feed-project] Добавить ' + name;
    window.open('https://github.com/' + REPOSITORY + '/issues/new?title=' + encodeURIComponent(title) + '&body=' + encodeURIComponent(body), '_blank', 'noopener');
    $('#project-modal').classList.add('hidden');
    showToast('Подтвердите создание объекта в GitHub');
  }

  function bindStaticEvents() {
    $$('.nav-item').forEach(function (button) {
      button.addEventListener('click', function () { navigate(button.dataset.view); });
    });
    $$('[data-go]').forEach(function (button) {
      button.addEventListener('click', function () { navigate(button.dataset.go); });
    });
    $('#filter-house').addEventListener('change', function (event) { state.filters.house = event.target.value; state.page = 1; renderLots(); });
    $('#filter-rooms').addEventListener('change', function (event) { state.filters.rooms = event.target.value; state.page = 1; renderLots(); });
    $('#filter-floor').addEventListener('change', function (event) { state.filters.floor = event.target.value; state.page = 1; renderLots(); });
    $('#filter-search').addEventListener('input', function (event) { state.filters.search = event.target.value; state.page = 1; renderLots(); });
    $('#image-filter-house').addEventListener('change', function (event) { state.imageFilters.house = event.target.value; renderImages(); });
    $('#image-filter-rooms').addEventListener('change', function (event) { state.imageFilters.rooms = event.target.value; renderImages(); });
    $('#image-filter-floor').addEventListener('change', function (event) { state.imageFilters.floor = event.target.value; renderImages(); });
    $('#image-filter-search').addEventListener('input', function (event) { state.imageFilters.search = event.target.value; renderImages(); });
    $('#image-lot').addEventListener('change', function (event) { state.imageLotId = event.target.value; renderImages(); });
    $('#choose-image-file').addEventListener('click', function (event) {
      event.stopPropagation();
      if (!uploadServiceUrl()) return;
      $('#image-file-input').click();
    });
    $('#image-file-input').addEventListener('change', function (event) {
      var file = event.target.files && event.target.files[0];
      event.target.value = '';
      if (file) uploadImageFile(file);
    });
    var dropZone = $('#image-drop-zone');
    dropZone.addEventListener('click', function () { if (uploadServiceUrl()) $('#image-file-input').click(); });
    dropZone.addEventListener('keydown', function (event) {
      if ((event.key === 'Enter' || event.key === ' ') && uploadServiceUrl()) { event.preventDefault(); $('#image-file-input').click(); }
    });
    ['dragenter', 'dragover'].forEach(function (eventName) {
      dropZone.addEventListener(eventName, function (event) { event.preventDefault(); if (uploadServiceUrl()) dropZone.classList.add('dragover'); });
    });
    ['dragleave', 'drop'].forEach(function (eventName) {
      dropZone.addEventListener(eventName, function (event) { event.preventDefault(); dropZone.classList.remove('dragover'); });
    });
    dropZone.addEventListener('drop', function (event) {
      var file = event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files[0];
      if (file && uploadServiceUrl()) uploadImageFile(file);
    });
    $('#add-image-url').addEventListener('click', function () {
      var item = state.inventory.items.find(function (lot) { return lot.id === state.imageLotId; });
      var input = $('#new-image-url');
      var url = input.value.trim();
      if (!item || !/^https:\/\//i.test(url)) { showToast('Укажите корректную HTTPS-ссылку на изображение.'); return; }
      try {
        addImageToItem(item, { id: 'add-' + Date.now().toString(36), url: url });
      } catch (error) {
        showToast(error.message);
        return;
      }
      input.value = '';
      renderImages();
    });
    $('#apply-image-bulk').addEventListener('click', function () {
      var items = filteredImageItems();
      var from = Number($('#bulk-image-from').value);
      var to = Number($('#bulk-image-to').value);
      if (!items.length) { showToast('По текущим фильтрам нет квартир.'); return; }
      if (!Number.isInteger(from) || !Number.isInteger(to) || from < 1 || to < 1 || from > 40 || to > 40 || from === to) {
        showToast('Проверьте исходную и новую позиции.'); return;
      }
      state.imageSettings.bulk_rules.push(Object.assign({
        id: 'image-rule-' + Date.now(),
        name: 'Перестановка ' + from + ' → ' + to,
        enabled: true,
        from_position: from,
        to_position: to
      }, filterRuleFrom(state.imageFilters, items)));
      setDirty(true);
      renderImages();
      showToast('Массовое правило создано для ' + items.length + ' квартир');
    });
    $('#parameter-filter-house').addEventListener('change', function (event) { state.parameterFilters.house = event.target.value; renderParameters(); });
    $('#parameter-filter-rooms').addEventListener('change', function (event) { state.parameterFilters.rooms = event.target.value; renderParameters(); });
    $('#parameter-filter-floor').addEventListener('change', function (event) { state.parameterFilters.floor = event.target.value; renderParameters(); });
    $('#parameter-filter-search').addEventListener('input', function (event) { state.parameterFilters.search = event.target.value; renderParameters(); });
    $('#parameter-lot').addEventListener('change', function (event) { state.parameterLotId = event.target.value; renderParameters(); });
    $('#add-parameter').addEventListener('click', function () {
      var item = state.inventory.items.find(function (lot) { return lot.id === state.parameterLotId; });
      var catalog = parameterByTag($('#new-parameter-tag').value);
      if (!item || !catalog) return;
      if (!state.parameterSettings.lot_values[item.id]) state.parameterSettings.lot_values[item.id] = {};
      if (Object.prototype.hasOwnProperty.call(effectiveParameters(item), catalog.tag)) {
        showToast('Этот параметр уже назначен квартире.'); return;
      }
      state.parameterSettings.lot_values[item.id][catalog.tag] = catalog.kind === 'multi' ? [catalog.values[0]] :
        catalog.kind === 'number' ? String(catalog.min) : catalog.values[0];
      setDirty(true);
      renderParameters();
    });
    $('#bulk-parameter-tag').addEventListener('change', renderParameterBulkValue);
    $('#apply-parameter-bulk').addEventListener('click', function () {
      var items = filteredParameterItems();
      var catalog = parameterByTag($('#bulk-parameter-tag').value);
      if (!items.length) { showToast('По текущим фильтрам нет квартир.'); return; }
      if (!catalog) return;
      var value = readParameterControl($('#bulk-parameter-value'), catalog, 'bulk-param');
      if (catalog.kind === 'multi' && !value.length) { showToast('Выберите хотя бы одно значение.'); return; }
      var values = {}; values[catalog.tag] = value;
      state.parameterSettings.bulk_rules.push(Object.assign({
        id: 'parameter-rule-' + Date.now(),
        name: catalog.name,
        enabled: true,
        values: values
      }, filterRuleFrom(state.parameterFilters, items)));
      setDirty(true);
      renderParameters();
      showToast('Параметр назначен для ' + items.length + ' квартир');
    });
    $('#preview-lot').addEventListener('change', function (event) { state.previewId = event.target.value; renderPreview(); });
    $('#add-rule').addEventListener('click', function () {
      if (state.rules.length >= 10) { showToast('Можно создать не более 10 правил.'); return; }
      var rule = emptyRule();
      state.rules.push(rule);
      state.activeRuleId = rule.id;
      setDirty(true);
      renderAll();
    });
    $('#save-draft').addEventListener('click', function () { saveDraft(true); });
    $('#publish-settings').addEventListener('click', openPublishModal);
    $('#cancel-publish').addEventListener('click', function () { $('#publish-modal').classList.add('hidden'); });
    $('#confirm-publish').addEventListener('click', confirmPublish);
    $('#publish-modal').addEventListener('click', function (event) {
      if (event.target.id === 'publish-modal') $('#publish-modal').classList.add('hidden');
    });
    $('#project-select').addEventListener('change', function (event) { loadProject(event.target.value); });
    $('#add-project').addEventListener('click', openProjectModal);
    $('#cancel-project').addEventListener('click', function () { $('#project-modal').classList.add('hidden'); });
    $('#confirm-project').addEventListener('click', confirmProject);
    $('#project-modal').addEventListener('click', function (event) {
      if (event.target.id === 'project-modal') $('#project-modal').classList.add('hidden');
    });
    $('#new-project-name').addEventListener('input', syncProjectIdentifiers);
    $('#new-project-slug').addEventListener('input', function () {
      this.dataset.edited = this.value ? '1' : '';
    });
  }

  async function loadProject(slug) {
    var project = state.registry.projects.find(function (item) { return item.slug === slug; });
    if (!project) return;
    if (!project.available) {
      showToast('Объект создан, но источник Profitbase ещё не подключён.');
      $('#project-select').value = state.project ? state.project.slug : state.registry.default_project;
      return;
    }
    var base = project.base;
    var version = '?v=' + encodeURIComponent(cacheVersion());
    try {
      var responses = await Promise.all([
        fetch(base + '/inventory.json' + version, { cache: 'force-cache' }),
        fetch(base + '/settings.json' + version, { cache: 'force-cache' }),
        fetch(base + '/status.json' + version, { cache: 'force-cache' }),
        fetch(base + '/assets.json' + version, { cache: 'force-cache' })
      ]);
      if (responses.some(function (response) { return !response.ok; })) throw new Error('Не удалось загрузить данные кабинета.');
      var data = await Promise.all(responses.map(function (response) { return response.json(); }));
      state.project = project;
      state.inventory = data[0];
      state.status = data[2];
      state.assets = data[3];
      var publishedRules = (data[1].rules || []).map(normalizeRule);
      var draft = null;
      try { draft = JSON.parse(localStorage.getItem(draftKey()) || 'null'); } catch (error) { draft = null; }
      state.rules = draft && Array.isArray(draft.rules) ? draft.rules.map(normalizeRule) : publishedRules;
      state.imageSettings = normalizeImageSettings(draft && draft.image_settings != null ? draft.image_settings : data[1].image_settings || emptyImageSettings());
      state.parameterSettings = normalizeParameterSettings(draft && draft.parameter_settings != null ? draft.parameter_settings : data[1].parameter_settings || emptyParameterSettings());
      state.activeRuleId = state.rules[0] ? state.rules[0].id : null;
      state.previewId = null;
      state.imageLotId = null;
      state.parameterLotId = null;
      state.imageUploadBusy = false;
      state.imageUploadMessage = '';
      state.imageUploadTone = '';
      state.page = 1;
      state.filters = { house: '', rooms: '', floor: '', search: '' };
      state.imageFilters = { house: '', rooms: '', floor: '', search: '' };
      state.parameterFilters = { house: '', rooms: '', floor: '', search: '' };
      populateFilters();
      renderAll();
      navigate(state.activeView);
      setDirty(false);
    } catch (error) {
      document.querySelector('main').innerHTML = '<section class="panel empty-state"><div><h2>Кабинет временно недоступен</h2><p>' + esc(error.message) + '</p></div></section>';
    }
  }

  async function init() {
    try {
      var response = await fetch('projects.json', { cache: 'no-cache' });
      if (!response.ok) throw new Error('Не удалось загрузить список объектов.');
      state.registry = await response.json();
      $('#project-select').innerHTML = state.registry.projects.map(function (project) {
        return '<option value="' + esc(project.slug) + '" ' + (project.available ? '' : 'disabled') + '>' +
          esc(project.name) + (project.available ? '' : ' · настройка') + '</option>';
      }).join('');
      bindStaticEvents();
      var requestedView = window.location.hash.replace('#', '');
      state.activeView = ['dashboard', 'lots', 'images', 'parameters', 'promotions', 'assets', 'preview'].indexOf(requestedView) >= 0 ? requestedView : 'dashboard';
      await loadProject(state.registry.default_project);
    } catch (error) {
      document.querySelector('main').innerHTML = '<section class="panel empty-state"><div><h2>Кабинет временно недоступен</h2><p>' + esc(error.message) + '</p></div></section>';
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
}());
