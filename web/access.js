(function () {
  'use strict';

  var config = window.FEED_STUDIO_ACCESS || {};
  var expectedHash = String(config.passwordHash || '').toLowerCase();
  var gate = document.getElementById('access-gate');
  var form = document.getElementById('access-form');
  var input = document.getElementById('access-password');
  var error = document.getElementById('access-error');
  var logout = document.getElementById('logout-access');
  var sessionKey = 'feed-studio-access:' + expectedHash.slice(0, 16);
  var credentialKey = sessionKey + ':upload-credential';
  var failures = 0;

  window.FEED_STUDIO_CREDENTIAL = {
    get: function () { return sessionStorage.getItem(credentialKey) || ''; },
    set: function (value) { sessionStorage.setItem(credentialKey, String(value || '')); }
  };

  function validConfig() {
    return /^[0-9a-f]{64}$/.test(expectedHash) && window.crypto && window.crypto.subtle;
  }

  async function sha256(value) {
    var bytes = new TextEncoder().encode(value);
    var digest = await window.crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest)).map(function (byte) {
      return byte.toString(16).padStart(2, '0');
    }).join('');
  }

  function loadApplication() {
    if (document.querySelector('script[data-feed-studio-app]')) return;
    var script = document.createElement('script');
    script.src = 'app.js';
    script.dataset.feedStudioApp = '1';
    document.body.appendChild(script);
  }

  function unlock() {
    document.body.classList.remove('access-locked');
    gate.hidden = true;
    sessionStorage.setItem(sessionKey, 'granted');
    loadApplication();
  }

  if (!validConfig()) {
    error.textContent = 'Защита входа временно недоступна. Обратитесь к администратору.';
    input.disabled = true;
    form.querySelector('button').disabled = true;
    return;
  }

  logout.addEventListener('click', function () {
    sessionStorage.removeItem(sessionKey);
    sessionStorage.removeItem(credentialKey);
    window.location.reload();
  });

  if (sessionStorage.getItem(sessionKey) === 'granted') {
    unlock();
    return;
  }

  form.addEventListener('submit', async function (event) {
    event.preventDefault();
    var button = form.querySelector('button');
    error.textContent = '';
    button.disabled = true;
    try {
      var actualHash = await sha256(input.value);
      if (actualHash === expectedHash) {
        window.FEED_STUDIO_CREDENTIAL.set(input.value);
        input.value = '';
        unlock();
        return;
      }
      failures += 1;
      error.textContent = 'Неверный пароль.';
      input.select();
      if (failures >= 5) {
        error.textContent = 'Слишком много попыток. Повторите через несколько секунд.';
        await new Promise(function (resolve) { window.setTimeout(resolve, 5000); });
        failures = 0;
      }
    } catch (accessError) {
      error.textContent = 'Не удалось проверить пароль. Обновите страницу.';
    } finally {
      button.disabled = false;
    }
  });
}());
