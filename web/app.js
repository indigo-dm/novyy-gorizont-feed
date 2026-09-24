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
    activeRuleId: null,
    activeView: 'dashboard',
    filters: { house: '', rooms: '', search: '' },
    page: 1,
    pageSize: 24,
    previewId: null,
    dirty: false
  };

  var $ = function (selector, root) { return (root || document).querySelector(selector); };
  var $$ = function (selector, root) { return Array.from((root || document).querySelectorAll(selector)); };
  var esc = function (value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  };
  var clone = function (value) { return JSON.parse(JSON.stringify(value)); };
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
    localStorage.setItem(draftKey(), JSON.stringify({ version: 1, rules: state.rules }));
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
    var titles = { dashboard: 'Обзор', lots: 'Квартиры', promotions: 'Акции', assets: 'Материалы', preview: 'Предпросмотр' };
    $('#page-title').textContent = titles[view] || 'Управление фидом';
    window.location.hash = view;
    if (view === 'preview') renderPreview();
    if (view === 'assets') renderAssets();
  }

  function renderProjectChrome() {
    if (!state.project || !state.inventory) return;
    $('#project-name').textContent = state.project.name;
    document.title = state.project.name + ' — Feed Studio';
    $('#project-select').value = state.project.slug;
    $('#full-feed-link').href = state.project.base + '/full-avito-demo.xml';
    $('#pilot-feed-link').href = state.project.base + '/pilot-avito.xml';
    if (state.assets && state.assets.brand) {
      document.documentElement.style.setProperty('--project-gold', state.assets.brand.gold);
      document.documentElement.style.setProperty('--project-ink', state.assets.brand.green_dark);
    }
  }

  function renderAssets() {
    if (!state.assets) return;
    $('#upload-assets').href = state.assets.upload_url;
    $('#asset-grid').innerHTML = state.assets.items.map(function (asset) {
      var preview = asset.exists ? '<img src="' + esc(asset.url) + '" alt="' + esc(asset.name) + '">' :
        '<div class="asset-missing">Файл не загружен</div>';
      return '<article class="asset-card"><div class="asset-preview">' + preview + '</div><div class="asset-copy"><div><strong>' +
        esc(asset.name) + '</strong><span class="asset-status ' + (asset.exists ? 'ready' : '') + '">' +
        (asset.exists ? 'Готово' : 'Требуется') + '</span></div><p>' + esc(asset.description) + '</p><code>' +
        esc(asset.filename) + '</code></div></article>';
    }).join('');
  }

  function renderStats() {
    $('#stat-source').textContent = state.inventory.source_ads;
    $('#stat-plans').textContent = state.inventory.full_ads || state.inventory.items.length;
    $('#stat-promotions').textContent = state.rules.filter(function (rule) { return rule.enabled; }).length;
    $('#stat-updated').textContent = formatDateTime(state.inventory.checked_at);
    if (state.inventory.items[0]) {
      $('#dashboard-preview').src = state.inventory.items[0].image;
    }
  }

  function populateFilters() {
    var houses = new Map();
    var rooms = new Set();
    state.inventory.items.forEach(function (item) {
      houses.set(String(item.house_id), item.house);
      rooms.add(String(item.rooms));
    });
    $('#filter-house').innerHTML = '<option value="">Все дома</option>' +
      Array.from(houses.entries()).map(function (entry) {
        return '<option value="' + esc(entry[0]) + '">' + esc(entry[1]) + '</option>';
      }).join('');
    $('#filter-rooms').innerHTML = '<option value="">Любая</option>' +
      Array.from(rooms).sort().map(function (room) {
        return '<option value="' + esc(room) + '">' + esc(room) + '-комнатная</option>';
      }).join('');
    $('#preview-lot').innerHTML = state.inventory.items.map(function (item) {
      return '<option value="' + esc(item.id) + '">' + esc(item.house + ' · ' + item.rooms + 'к · ' + formatArea(item.area)) + '</option>';
    }).join('');
    if (!state.previewId && state.inventory.items[0]) state.previewId = state.inventory.items[0].id;
    $('#preview-lot').value = state.previewId || '';
  }

  function lotCard(item) {
    var rule = appliedRule(item);
    return '<article class="lot-card">' +
      '<div class="lot-image"><img src="' + esc(item.image) + '" alt="' + esc(item.house + ', ' + item.rooms + '-комнатная') + '">' +
      '<span class="lot-badge">' + esc(item.house) + (rule ? ' · акция' : '') + '</span></div>' +
      '<div class="lot-body"><div class="lot-title"><strong>' + esc(item.rooms) + '-комнатная · ' + esc(formatArea(item.area)) + '</strong><span>ID ' + esc(item.id) + '</span></div>' +
      '<div class="lot-meta">' + esc(formatPrice(item.price)) + ' · этаж ' + esc(item.floor) + '/' + esc(item.floors) + '</div>' +
      '<div class="lot-actions"><button data-preview="' + esc(item.id) + '">Предпросмотр</button></div></div></article>';
  }

  function renderLots() {
    var search = state.filters.search.trim().toLowerCase();
    var items = state.inventory.items.filter(function (item) {
      return (!state.filters.house || item.house_id === state.filters.house) &&
        (!state.filters.rooms || item.rooms === state.filters.rooms) &&
        (!search || item.id.toLowerCase().indexOf(search) >= 0);
    });
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
    $('#preview-image').src = item.image;
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
    renderRuleList();
    renderRuleEditor();
    renderAssets();
    renderPreview();
  }

  function settingsPayload() {
    return { version: 1, project: state.project.slug, rules: state.rules.map(normalizeRule) };
  }

  function validateSettings() {
    if (state.rules.length > 10) return 'Допускается не более 10 правил.';
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
      affected + ' из ' + state.inventory.items.length + ' квартир получат акцию.';
    $('#publish-modal').classList.remove('hidden');
  }

  function confirmPublish() {
    var payload = JSON.stringify(settingsPayload(), null, 2);
    var body = 'Запрос на обновление настроек демонстрационного фида.\n\n' +
      'FEED_SETTINGS_JSON_START\n' + payload + '\nFEED_SETTINGS_JSON_END\n\n' +
      'Запрос сформирован кабинетом Feed Studio. Workflow применит его только от владельца репозитория.';
    var title = '[feed-settings] ' + state.project.name + ': обновить акции';
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
    $('#filter-search').addEventListener('input', function (event) { state.filters.search = event.target.value; state.page = 1; renderLots(); });
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
    try {
      var responses = await Promise.all([
        fetch(base + '/inventory.json', { cache: 'no-store' }),
        fetch(base + '/settings.json', { cache: 'no-store' }),
        fetch(base + '/status.json', { cache: 'no-store' }),
        fetch(base + '/assets.json', { cache: 'no-store' })
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
      state.activeRuleId = state.rules[0] ? state.rules[0].id : null;
      state.previewId = null;
      state.page = 1;
      state.filters = { house: '', rooms: '', search: '' };
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
      var response = await fetch('projects.json', { cache: 'no-store' });
      if (!response.ok) throw new Error('Не удалось загрузить список объектов.');
      state.registry = await response.json();
      $('#project-select').innerHTML = state.registry.projects.map(function (project) {
        return '<option value="' + esc(project.slug) + '" ' + (project.available ? '' : 'disabled') + '>' +
          esc(project.name) + (project.available ? '' : ' · настройка') + '</option>';
      }).join('');
      bindStaticEvents();
      var requestedView = window.location.hash.replace('#', '');
      state.activeView = ['dashboard', 'lots', 'promotions', 'assets', 'preview'].indexOf(requestedView) >= 0 ? requestedView : 'dashboard';
      await loadProject(state.registry.default_project);
    } catch (error) {
      document.querySelector('main').innerHTML = '<section class="panel empty-state"><div><h2>Кабинет временно недоступен</h2><p>' + esc(error.message) + '</p></div></section>';
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
}());
