var API_BASE = 'https://open-bus-stride-api.hasadna.org.il';
var BUS_NEARBY_API_BASE = 'https://api.busnearby.co.il/directions';
var CURLBUS_API_BASE = 'https://curlbus.app';
var transitCache = require('./transit_cache');
var DAY_MS = 24 * 60 * 60 * 1000;
var MINUTE_MS = 60 * 1000;
var MAX_ROWS = 24;
var MAX_STOP_ROWS = 12;
var MAX_ROUTE_STOP_ROWS = 64;
var MAX_TEXT_CHARS = 64;
var MAX_STOP_NAME_CHARS = 64;
var STATUS_OK = 0;
var STATUS_NO_DATA = 32;
var STATUS_API_AUTH = 33;
var STATUS_RATE_LIMIT = 34;
var OPERATOR_COLOR_SHIFT = 8;
var OPERATOR_COLOR_MASK = 15 << OPERATOR_COLOR_SHIFT;

if (typeof Promise === 'undefined') {
  Promise = function(executor) {
    var callbacks = [];
    var state = 'pending';
    var value;
    function settle(nextState, nextValue) {
      if (state !== 'pending') return;
      state = nextState;
      value = nextValue;
      callbacks.forEach(run);
    }
    function run(callback) {
      setTimeout(function() {
        var handler = state === 'fulfilled' ? callback.onFulfilled : callback.onRejected;
        if (!handler) {
          (state === 'fulfilled' ? callback.resolve : callback.reject)(value);
          return;
        }
        try {
          callback.resolve(handler(value));
        } catch (e) {
          callback.reject(e);
        }
      }, 0);
    }
    this.then = function(onFulfilled, onRejected) {
      return new Promise(function(resolve, reject) {
        var callback = { onFulfilled: onFulfilled, onRejected: onRejected, resolve: resolve, reject: reject };
        if (state === 'pending') callbacks.push(callback);
        else run(callback);
      });
    };
    this.catch = function(onRejected) {
      return this.then(null, onRejected);
    };
    executor(function(nextValue) {
      if (nextValue && typeof nextValue.then === 'function') {
        nextValue.then(function(v) { settle('fulfilled', v); }, function(e) { settle('rejected', e); });
      } else {
        settle('fulfilled', nextValue);
      }
    }, function(error) {
      settle('rejected', error);
    });
  };
  Promise.resolve = function(value) {
    return new Promise(function(resolve) { resolve(value); });
  };
}

var STORAGE = {
  settings: 'settings:v1',
  favoriteStops: 'favorites:stops:v1',
  favoriteLines: 'favorites:lines:v1',
  arrivalsPrefix: 'arrivals:',
  siriStopPrefix: 'siriStop:',
  diagnostics: 'lastDiagnostics:v1',
  rateBackoffUntil: 'rateBackoffUntil:v1'
};

var DEFAULT_FAVORITE_STOP = {
  gtfsId: '1:29310',
  gtfsDate: null,
  code: 20004,
  name: 'HaMasger/Yad Harutsim',
  city: 'Tel Aviv-Yafo',
  lat: 32.061291,
  lon: 34.784847
};

var DEFAULT_SETTINGS = {
  radius_m: 400,
  refresh_sec: 30,
  language: 'auto',
  max_arrivals: 12,
  default_screen: 'favorites',
  show_destination: true,
  show_distance: true,
  show_source_badge: true,
  dark_mode: false,
  vibrate_under_min: 5,
  alert_only_favorite_lines: false,
  favorite_stops: [DEFAULT_FAVORITE_STOP],
  favorite_lines: [],
  debug: false
};

function memoryStorage() {
  var data = {};
  var store = {
    length: 0,
    getItem: function(key) { return Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null; },
    setItem: function(key, value) {
      if (!Object.prototype.hasOwnProperty.call(data, key)) store.length += 1;
      data[key] = String(value);
    },
    removeItem: function(key) {
      if (Object.prototype.hasOwnProperty.call(data, key)) {
        delete data[key];
        store.length -= 1;
      }
    },
    key: function(index) { return Object.keys(data)[index] || null; }
  };
  return store;
}

function getStorage(adapter) {
  if (adapter) return adapter;
  if (typeof localStorage !== 'undefined') return localStorage;
  return memoryStorage();
}

function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function safeJsonParse(value, fallback) {
  if (value === null || value === undefined || value === '') return fallback;
  try {
    var parsed = JSON.parse(value);
    return parsed === null || parsed === undefined ? fallback : parsed;
  } catch (e) {
    return fallback;
  }
}

function intValue(value, fallback) {
  var n = parseInt(value, 10);
  return isNaN(n) ? fallback : n;
}

function boolValue(value, fallback) {
  if (value === true || value === 'true' || value === 1 || value === '1') return true;
  if (value === false || value === 'false' || value === 0 || value === '0') return false;
  return fallback;
}

function maxArrivalRows(settings) {
  return Math.max(1, Math.min(MAX_ROWS, intValue(settings && settings.max_arrivals, DEFAULT_SETTINGS.max_arrivals)));
}

function normalizeStop(stop) {
  if (!stop) return null;
  return {
    gtfsId: stop.gtfsId || stop.gtfs_id || stop.id || null,
    gtfsDate: stop.gtfsDate || stop.gtfs_date || stop.date || stop.gtfs_stop__date || null,
    code: intValue(stop.code || stop.stop_code || stop.stopCode, 0),
    name: String(stop.name || stop.stop_name || stop.stopName || stop.desc || stop.code || 'Stop'),
    city: String(stop.city || stop.stop_city || ''),
    lat: Number(stop.lat || stop.stop_lat || 0),
    lon: Number(stop.lon || stop.stop_lon || 0),
    distanceM: stop.distanceM || stop.distance_m || 0
  };
}

function normalizeFavoriteLine(line) {
  if (line === null || line === undefined) return null;
  if (typeof line === 'string' || typeof line === 'number') {
    return { line: String(line).replace(/^\s+|\s+$/g, ''), operator: '' };
  }
  if (!line.line) return null;
  return {
    line: String(line.line).replace(/^\s+|\s+$/g, ''),
    operator: line.operator ? String(line.operator).replace(/^\s+|\s+$/g, '') : ''
  };
}

function uniqueStops(stops) {
  var seen = {};
  var out = [];
  (stops || []).forEach(function(stop) {
    var normalized = normalizeStop(stop);
    if (!normalized || !normalized.code) return;
    var key = String(normalized.code);
    if (seen[key]) return;
    seen[key] = true;
    out.push(normalized);
  });
  return out;
}

function uniqueLines(lines) {
  var seen = {};
  var out = [];
  (lines || []).forEach(function(line) {
    var normalized = normalizeFavoriteLine(line);
    if (!normalized) return;
    var key = normalized.line + '|' + normalized.operator;
    if (seen[key]) return;
    seen[key] = true;
    out.push(normalized);
  });
  return out;
}

function parseCsvLines(csv) {
  if (!csv) return [];
  return uniqueLines(String(csv).split(',').map(function(part) {
    return { line: part.replace(/^\s+|\s+$/g, '') };
  }).filter(function(item) { return item.line; }));
}

function normalizeConfigValues(values) {
  var normalized = {};
  Object.keys(values || {}).forEach(function(key) {
    var value = values[key];
    if (value && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, 'value')) {
      normalized[key] = value.value;
    } else {
      normalized[key] = value;
    }
  });
  return normalized;
}

function parseSettings(raw, storageAdapter) {
  var storage = getStorage(storageAdapter);
  var settings = clone(DEFAULT_SETTINGS);
  var saved = safeJsonParse(storage.getItem(STORAGE.settings), {});
  var favoriteStops = safeJsonParse(storage.getItem(STORAGE.favoriteStops), null);
  var favoriteLines = safeJsonParse(storage.getItem(STORAGE.favoriteLines), null);
  var incoming = raw || {};

  Object.keys(saved || {}).forEach(function(key) { settings[key] = saved[key]; });
  Object.keys(incoming || {}).forEach(function(key) {
    if (incoming[key] !== undefined && incoming[key] !== null && incoming[key] !== '') {
      settings[key] = incoming[key];
    }
  });

  settings.radius_m = intValue(incoming.RadiusM || settings.RadiusM || settings.radius_m, DEFAULT_SETTINGS.radius_m);
  settings.refresh_sec = intValue(incoming.RefreshSec || settings.RefreshSec || settings.refresh_sec, DEFAULT_SETTINGS.refresh_sec);
  settings.max_arrivals = Math.max(1, Math.min(MAX_ROWS, intValue(incoming.MaxArrivals || settings.MaxArrivals || settings.max_arrivals, DEFAULT_SETTINGS.max_arrivals)));
  settings.vibrate_under_min = intValue(incoming.VibrateUnderMin || settings.VibrateUnderMin || settings.vibrate_under_min, DEFAULT_SETTINGS.vibrate_under_min);
  settings.show_destination = boolValue(incoming.ShowDestination !== undefined ? incoming.ShowDestination : settings.show_destination, DEFAULT_SETTINGS.show_destination);
  settings.show_distance = boolValue(incoming.ShowDistance !== undefined ? incoming.ShowDistance : settings.show_distance, DEFAULT_SETTINGS.show_distance);
  settings.show_source_badge = boolValue(incoming.ShowSourceBadge !== undefined ? incoming.ShowSourceBadge : settings.show_source_badge, DEFAULT_SETTINGS.show_source_badge);
  settings.dark_mode = boolValue(incoming.DarkMode !== undefined ? incoming.DarkMode : settings.dark_mode, DEFAULT_SETTINGS.dark_mode);
  settings.alert_only_favorite_lines = boolValue(incoming.AlertOnlyFavoriteLines !== undefined ? incoming.AlertOnlyFavoriteLines : settings.alert_only_favorite_lines, DEFAULT_SETTINGS.alert_only_favorite_lines);
  settings.debug = boolValue(incoming.Debug !== undefined ? incoming.Debug : settings.debug, DEFAULT_SETTINGS.debug);
  delete settings.nearby_city;
  delete settings.NearbyCity;

  if (favoriteStops) settings.favorite_stops = favoriteStops;
  if (favoriteLines) settings.favorite_lines = favoriteLines;
  if (incoming.FavoriteStopsJson || incoming.favorite_stops_json) {
    settings.favorite_stops = safeJsonParse(incoming.FavoriteStopsJson || incoming.favorite_stops_json, settings.favorite_stops);
  }
  if (incoming.FavoriteLinesJson || incoming.favorite_lines_json) {
    settings.favorite_lines = safeJsonParse(incoming.FavoriteLinesJson || incoming.favorite_lines_json, settings.favorite_lines);
  } else if (incoming.FavoriteLinesCsv || incoming.favorite_lines_csv) {
    settings.favorite_lines = parseCsvLines(incoming.FavoriteLinesCsv || incoming.favorite_lines_csv);
  }

  settings.favorite_stops = uniqueStops(settings.favorite_stops);
  settings.favorite_lines = uniqueLines(settings.favorite_lines);
  return settings;
}

function saveSettings(settings, storageAdapter) {
  var storage = getStorage(storageAdapter);
  storage.setItem(STORAGE.settings, JSON.stringify(settings));
  storage.setItem(STORAGE.favoriteStops, JSON.stringify(uniqueStops(settings.favorite_stops)));
  storage.setItem(STORAGE.favoriteLines, JSON.stringify(uniqueLines(settings.favorite_lines)));
}

function storageKeys(storage) {
  if (!storage) return [];
  if (typeof storage.length === 'number' && typeof storage.key === 'function') {
    var keys = [];
    for (var i = 0; i < storage.length; i += 1) {
      var key = storage.key(i);
      if (key) keys.push(key);
    }
    return keys;
  }
  return Object.keys(storage);
}

function applyConfigValues(values, storageAdapter) {
  var storage = getStorage(storageAdapter);
  values = normalizeConfigValues(values || {});
  if (values.ClearCache === true || values.ClearCache === 'true') {
    storageKeys(storage).forEach(function(key) {
      if (key.indexOf('arrivals:') === 0 || key.indexOf('siriStop:') === 0 || key.indexOf('stopindex:') === 0 || key === STORAGE.rateBackoffUntil) {
        storage.removeItem(key);
      }
    });
    transitCache.clear(storage);
  }
  var parsed = {
    radius_m: values.RadiusM,
    refresh_sec: values.RefreshSec,
    language: values.Language,
    default_screen: values.DefaultScreen,
    max_arrivals: values.MaxArrivals,
    show_destination: values.ShowDestination,
    show_distance: values.ShowDistance,
    show_source_badge: values.ShowSourceBadge,
    dark_mode: values.DarkMode,
    vibrate_under_min: values.VibrateUnderMin,
    alert_only_favorite_lines: values.AlertOnlyFavoriteLines,
    debug: values.Debug,
    FavoriteStopsJson: values.FavoriteStopsJson,
    FavoriteLinesJson: values.FavoriteLinesJson,
    FavoriteLinesCsv: values.FavoriteLinesCsv
  };
  var settings = parseSettings(parsed, storage);
  saveSettings(settings, storage);
  return settings;
}

function qs(params) {
  var parts = [];
  Object.keys(params || {}).forEach(function(key) {
    var value = params[key];
    if (value === undefined || value === null || value === '') return;
    parts.push(encodeURIComponent(key) + '=' + encodeURIComponent(String(value)));
  });
  return parts.join('&');
}

function apiGet(path, params, timeoutMs) {
  return httpJson(API_BASE + path + '?' + qs(params || {}), timeoutMs || 8000);
}

function apiGetUrl(base, path, params, timeoutMs) {
  return httpJson(base + path + '?' + qs(params || {}), timeoutMs || 8000);
}

function httpJson(url, timeoutMs) {
  if (typeof XMLHttpRequest === 'undefined' && typeof fetch !== 'undefined') {
    return new Promise(function(resolve, reject) {
      var done = false;
      var timer = setTimeout(function() {
        if (done) return;
        done = true;
        reject({ type: 'timeout', url: url });
      }, timeoutMs || 8000);
      fetch(url, { headers: { Accept: 'application/json' } }).then(function(response) {
        if (done) return null;
        return response.text().then(function(text) {
          if (done) return;
          done = true;
          clearTimeout(timer);
          if (response.status < 200 || response.status >= 300) {
            reject({ type: 'http', status: response.status, body: text, url: url });
            return;
          }
          resolve(safeJsonParse(text || '[]', []));
        });
      }).catch(function(error) {
        if (done) return;
        done = true;
        clearTimeout(timer);
        reject({ type: 'network', error: error, url: url });
      });
    });
  }

  return new Promise(function(resolve, reject) {
    var xhr = new XMLHttpRequest();
    var done = false;
    var timer = setTimeout(function() {
      if (done) return;
      done = true;
      try { xhr.abort(); } catch (e) {}
      reject({ type: 'timeout', url: url });
    }, timeoutMs || 8000);

    xhr.open('GET', url, true);
    xhr.setRequestHeader('Accept', 'application/json');
    xhr.onreadystatechange = function() {
      if (xhr.readyState !== 4 || done) return;
      done = true;
      clearTimeout(timer);
      if (xhr.status < 200 || xhr.status >= 300) {
        reject({ type: 'http', status: xhr.status, body: xhr.responseText, url: url });
        return;
      }
      try {
        resolve(safeJsonParse(xhr.responseText || '[]', []));
      } catch (e) {
        reject({ type: 'json', error: e, url: url });
      }
    };
    xhr.send();
  });
}

function asRows(payload) {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload.results)) return payload.results;
  if (Array.isArray(payload.data)) return payload.data;
  if (Array.isArray(payload.rows)) return payload.rows;
  return [];
}

function cached(storageAdapter, key, ttlMs, loader) {
  var storage = getStorage(storageAdapter);
  var now = Date.now();
  var cachedValue = safeJsonParse(storage.getItem(key), null);
  if (cachedValue && cachedValue.expiresAt > now) return Promise.resolve(cachedValue.value);
  return loader().then(function(value) {
    storage.setItem(key, JSON.stringify({ expiresAt: now + ttlMs, savedAt: now, value: value }));
    return value;
  });
}

function loadStale(storageAdapter, key, maxAgeMs) {
  var storage = getStorage(storageAdapter);
  var cachedValue = safeJsonParse(storage.getItem(key), null);
  if (!cachedValue) return null;
  var savedAt = cachedValue.savedAt || 0;
  if (savedAt && Date.now() - savedAt <= maxAgeMs) return cachedValue;
  return null;
}

function saveDiagnostics(storageAdapter, diagnostics) {
  getStorage(storageAdapter).setItem(STORAGE.diagnostics, JSON.stringify(diagnostics || {}));
}

function loadDiagnostics(storageAdapter) {
  return safeJsonParse(getStorage(storageAdapter).getItem(STORAGE.diagnostics), {});
}

function diagnosticErrorText(error) {
  if (!error) return 'error none';
  if (typeof error === 'string') return error;
  if (error.status) return 'http ' + error.status;
  if (error.type && error.stage) return error.type + ' ' + error.stage;
  if (error.type) return String(error.type);
  if (error.stage) return String(error.stage);
  return 'error';
}

function diagnosticLines(diagnostics, cacheStatus) {
  var diag = diagnostics || {};
  var errors = diag.errors || [];
  var lastError = errors.length ? errors[errors.length - 1] : null;
  var httpStatus = diag.httpStatus || (lastError && lastError.status) || 0;
  var lines = [
    'ep ' + (diag.endpoint || diag.stage || 'none'),
    'stage ' + (diag.stage || 'none') + ' http ' + (httpStatus || '-'),
    'rows ' + intValue(diag.rows, 0) + ' src ' + (diag.source || 'none') + ' age ' + intValue(diag.updatedAgoSec, 0) + 's',
    'fb ' + (diag.fallback ? 'yes' : 'no') + ' err ' + diagnosticErrorText(lastError)
  ];
  if (cacheStatus) {
    lines[3] = 'gtfs ' + cacheStatus.status + ' s' + cacheStatus.stopCount +
      ' q' + cacheStatus.scheduleCount + ' r' + cacheStatus.routeCount +
      ' ' + Math.round(cacheStatus.snapshotBytes / 1024) + 'k';
  }
  return lines;
}

function packDiagnostics(diagnostics, messageKeys, cacheStatus) {
  var dict = {};
  var lines = diagnosticLines(diagnostics, cacheStatus);
  dict[messageKeys.ReqType] = 6;
  dict[messageKeys.Status] = STATUS_OK;
  if (messageKeys.DebugLine0 !== undefined) dict[messageKeys.DebugLine0] = watchText(lines[0], 'stage none', MAX_TEXT_CHARS, false);
  if (messageKeys.DebugLine1 !== undefined) dict[messageKeys.DebugLine1] = watchText(lines[1], 'source none', MAX_TEXT_CHARS, false);
  if (messageKeys.DebugLine2 !== undefined) dict[messageKeys.DebugLine2] = watchText(lines[2], 'fallback no', MAX_TEXT_CHARS, false);
  if (messageKeys.DebugLine3 !== undefined) dict[messageKeys.DebugLine3] = watchText(lines[3], 'error none', MAX_TEXT_CHARS, false);
  return dict;
}

function rateBackoffUntil(storageAdapter) {
  return intValue(getStorage(storageAdapter).getItem(STORAGE.rateBackoffUntil), 0);
}

function noteRateLimit(storageAdapter) {
  getStorage(storageAdapter).setItem(STORAGE.rateBackoffUntil, String(Date.now() + 3 * MINUTE_MS));
}

function shouldBackoffProviderError(error) {
  return !!(error && error.type === 'http' && (error.status === 401 || error.status === 403 || error.status === 429));
}

function statusForProviderError(error) {
  if (error && error.type === 'http' && (error.status === 401 || error.status === 403)) return STATUS_API_AUTH;
  if (error && error.type === 'http' && error.status === 429) return STATUS_RATE_LIMIT;
  return STATUS_NO_DATA;
}

function dateOnlyLocal(date) {
  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate());
}

function isoWithOffset(date) {
  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  var offsetMin = -date.getTimezoneOffset();
  var sign = offsetMin >= 0 ? '+' : '-';
  var abs = Math.abs(offsetMin);
  return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate()) +
    'T' + pad(date.getHours()) + ':' + pad(date.getMinutes()) + ':' + pad(date.getSeconds()) +
    sign + pad(Math.floor(abs / 60)) + ':' + pad(abs % 60);
}

function addMinutes(date, minutes) {
  return new Date(date.getTime() + minutes * MINUTE_MS);
}

function pathValue(obj, path) {
  var parts = path.split('.');
  var current = obj;
  for (var i = 0; i < parts.length; i += 1) {
    if (current === null || current === undefined) return undefined;
    current = current[parts[i]];
  }
  return current;
}

function firstValue(obj, paths) {
  for (var i = 0; i < paths.length; i += 1) {
    var value = pathValue(obj, paths[i]);
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return null;
}

function findValueByName(obj, regex) {
  var found = null;
  function walk(value, depth) {
    if (found !== null || depth > 3 || value === null || typeof value !== 'object') return;
    Object.keys(value).forEach(function(key) {
      if (found !== null) return;
      if (regex.test(key) && value[key] !== null && value[key] !== undefined && value[key] !== '') {
        found = value[key];
        return;
      }
      walk(value[key], depth + 1);
    });
  }
  walk(obj, 0);
  return found;
}

function parseTime(value, now) {
  if (!value && value !== 0) return null;
  if (typeof value === 'number') {
    if (value > 1000000000000) return new Date(value);
    return new Date((now || new Date()).getFullYear(), (now || new Date()).getMonth(), (now || new Date()).getDate(), Math.floor(value / 3600), Math.floor((value % 3600) / 60), value % 60);
  }
  var text = String(value);
  text = text.replace(/^(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2})([+-]\d{2}:\d{2})$/, '$1T$2$3');
  var parsed = new Date(text);
  if (!isNaN(parsed.getTime())) return parsed;
  var m = text.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (m) {
    var base = now || new Date();
    return new Date(base.getFullYear(), base.getMonth(), base.getDate(), intValue(m[1], 0), intValue(m[2], 0), intValue(m[3], 0));
  }
  return null;
}

function minutesUntil(time, now) {
  return Math.round((time.getTime() - now.getTime()) / MINUTE_MS);
}

function sourceToInt(source) {
  if (source === 'siri' || source === 'live') return 1;
  if (source === 'scheduled' || source === 'schedule') return 2;
  if (source === 'cache') return 3;
  return 0;
}

function sourceLabel(source, ageSec) {
  if (source === 'siri' || source === 'live') return ageSec ? 'LIVE ' + ageSec + 's' : 'LIVE';
  if (source === 'scheduled' || source === 'schedule') return 'SCHED';
  if (source === 'cache') return 'CACHED ' + Math.max(1, Math.round((ageSec || 0) / 60)) + 'm';
  return 'DATA';
}

function isFavoriteLine(line, operator, settings) {
  var text = String(line || '');
  var op = String(operator || '').toLowerCase();
  return (settings.favorite_lines || []).some(function(fav) {
    if (String(fav.line) !== text) return false;
    if (!fav.operator) return true;
    return String(fav.operator).toLowerCase() === op;
  });
}

function normalizeArrivalRow(row, now, settings, forcedSource) {
  var line = firstValue(row, [
    'line',
    'route_short_name',
    'route_short_name_text',
    'gtfs_route.short_name',
    'gtfs_route__route_short_name',
    'siri_ride.gtfs_route.short_name',
    'siri_ride.route_short_name',
    'siri_ride__gtfs_route__route_short_name',
    'siri_ride__line_ref'
  ]) || findValueByName(row, /(^|_)(line|route_short_name|published_line_name|line_ref)$/i);

  var destination = firstValue(row, [
    'destination',
    'destination_name',
    'headsign',
    'trip_headsign',
    'gtfs_trip.trip_headsign',
    'siri_ride.destination_name',
    'siri_ride.gtfs_trip.trip_headsign',
    'siri_ride__destination_name',
    'gtfs_route__route_long_name',
    'siri_ride__gtfs_trip__trip_headsign'
  ]) || findValueByName(row, /(destination|headsign|dest_name)$/i) || '';

  var arrivalValue = firstValue(row, [
    '_buspebble_arrival_time',
    'expected_arrival_time',
    'arrival_time',
    'aimed_arrival_time',
    'siri_ride_stop.arrival_time',
    'gtfs_ride_stop__arrival_time',
    'siri_ride_stop.expected_arrival_time',
    'siri_ride__scheduled_start_time',
    'scheduled_arrival_time',
    'stop_time.arrival_time'
  ]) || findValueByName(row, /(expected.*arrival|arrival_time|scheduled.*time)$/i);

  var scheduledValue = firstValue(row, [
    '_buspebble_scheduled_time',
    'scheduled_arrival_time',
    'aimed_arrival_time',
    'siri_ride__scheduled_start_time',
    'stop_time.arrival_time'
  ]);

  var recordedValue = firstValue(row, [
    'recorded_at_time',
    'nearest_siri_vehicle_location__recorded_at_time',
    'siri_vehicle_location.recorded_at_time',
    'siri_vehicle_location__recorded_at_time',
    'siri_ride.siri_vehicle_location.recorded_at_time'
  ]) || findValueByName(row, /(recorded_at_time|recorded_time|vehicle.*recorded)$/i);

  var arrivalTime = parseTime(arrivalValue, now);
  if (!arrivalTime) return null;
  var minutes = minutesUntil(arrivalTime, now);
  var vehicleAtStop = !!firstValue(row, ['vehicle_at_stop', 'at_stop']);
  if (minutes < -2 && !vehicleAtStop) return null;
  if (minutes < 0) minutes = 0;

  var recordedTime = parseTime(recordedValue, now);
  var freshnessSec = recordedTime ? Math.max(0, Math.round((now.getTime() - recordedTime.getTime()) / 1000)) : 0;
  var source = forcedSource;
  if (!source) {
    source = recordedTime && freshnessSec <= 15 * 60 ? 'siri' : 'scheduled';
  }

  var scheduledTime = parseTime(scheduledValue, now);
  var delayMin = scheduledTime ? Math.round((arrivalTime.getTime() - scheduledTime.getTime()) / MINUTE_MS) : 0;
  var operator = String(firstValue(row, ['operator', 'agency_name', 'gtfs_agency.name', 'gtfs_route__agency_name']) || '');
  var routeRef = intValue(firstValue(row, [
    'route_ref',
    'line_id',
    'route_id',
    'gtfs_route__line_ref',
    'siri_ride__line_ref'
  ]), 0);
  var flags = 0;
  if (isFavoriteLine(line, operator, settings)) flags |= 1;
  if (delayMin > 2) flags |= 2;
  if (vehicleAtStop) flags |= 4;

  return {
    id: String(line || '') + ':' + arrivalTime.toISOString(),
    line: String(line || '?'),
    destination: String(destination || ''),
    minutes: minutes,
    arrivalTimeIso: arrivalTime.toISOString(),
    scheduledTimeIso: scheduledTime ? scheduledTime.toISOString() : '',
    delayMin: delayMin,
    operator: operator,
    routeRef: routeRef,
    source: source,
    freshnessSec: freshnessSec,
    vehicleAtStop: vehicleAtStop,
    flags: flags
  };
}

function dedupeAndSortArrivals(rows, settings) {
  var seen = {};
  var deduped = [];
  rows.forEach(function(row) {
    if (!row) return;
    var key = row.line + '|' + row.destination + '|' + row.arrivalTimeIso;
    if (seen[key]) return;
    seen[key] = true;
    deduped.push(row);
  });
  deduped.sort(function(a, b) {
    var favDiff = (b.flags & 1) - (a.flags & 1);
    if (favDiff !== 0) return favDiff;
    return a.minutes - b.minutes;
  });
  return deduped.slice(0, maxArrivalRows(settings || DEFAULT_SETTINGS));
}

function normalizeSiriRows(rows, stop, now, settings) {
  var normalized = asRows(rows).map(function(row) {
    return normalizeArrivalRow(row, now || new Date(), settings || DEFAULT_SETTINGS, null);
  }).filter(Boolean);
  return dedupeAndSortArrivals(normalized, settings || DEFAULT_SETTINGS);
}

function normalizeScheduledRows(rows, stop, now, settings) {
  var normalized = asRows(rows).map(function(row) {
    return normalizeArrivalRow(row, now || new Date(), settings || DEFAULT_SETTINGS, 'scheduled');
  }).filter(Boolean);
  return dedupeAndSortArrivals(normalized, settings || DEFAULT_SETTINGS);
}

function curlbusDestination(visit) {
  return firstValue(visit, [
    'static_info.route.destination.name.EN',
    'static_info.route.destination.name.HE',
    'static_info.route.destination.name.AR',
    'static_info.route.headsign.EN',
    'static_info.route.headsign.HE',
    'destination_name'
  ]) || '';
}

function normalizeCurlbusRows(payload, stop, now, settings) {
  var baseTime = now || new Date();
  var stopCode = String((stop && stop.code) || '');
  var visits = [];
  if (payload && payload.visits) {
    if (Array.isArray(payload.visits)) {
      visits = payload.visits;
    } else if (stopCode && Array.isArray(payload.visits[stopCode])) {
      visits = payload.visits[stopCode];
    } else {
      Object.keys(payload.visits).forEach(function(key) {
        if (Array.isArray(payload.visits[key])) visits = visits.concat(payload.visits[key]);
      });
    }
  }
  var mapped = visits.map(function(visit) {
    return {
      line: visit.line_name || visit.line || visit.route_short_name || '?',
      destination: curlbusDestination(visit),
      operator: firstValue(visit, [
        'static_info.route.agency.name.EN',
        'static_info.route.agency.name.HE',
        'operator_name'
      ]) || '',
      route_ref: visit.line_id || visit.route_id || 0,
      _buspebble_arrival_time: visit.eta,
      recorded_at_time: visit.timestamp || payload.timestamp || baseTime.toISOString(),
      vehicle_at_stop: visit.status === 'at_stop'
    };
  });
  return dedupeAndSortArrivals(mapped.map(function(row) {
    return normalizeArrivalRow(row, baseTime, settings || DEFAULT_SETTINGS, 'live');
  }).filter(Boolean), settings || DEFAULT_SETTINGS);
}

function fetchStopByCode(code) {
  return apiGet('/gtfs_stops/list', { code: code, limit: 1, order_by: 'id desc' }, 3500).then(function(payload) {
    var row = asRows(payload)[0];
    if (!row) throw { type: 'not_found', stage: 'gtfs_stop', code: code };
    return normalizeStop(row);
  });
}

function getStopByCode(code, storageAdapter) {
  var storage = getStorage(storageAdapter);
  var cachedStop = transitCache.findStop(storage, code);
  if (cachedStop) return Promise.resolve(normalizeStop(cachedStop));
  return fetchStopByCode(code).then(function(stop) {
    transitCache.rememberVisitedStop(storage, stop);
    return stop;
  });
}

function serviceDateIso(date, serviceDate) {
  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  return serviceDate + 'T' + pad(date.getUTCHours()) + ':' + pad(date.getUTCMinutes()) + ':' + pad(date.getUTCSeconds()) + '+00:00';
}

function shiftedServiceRows(rows, now) {
  return asRows(rows).map(function(row) {
    var copy = {};
    Object.keys(row).forEach(function(key) { copy[key] = row[key]; });
    var arrival = parseTime(row.arrival_time || row.gtfs_ride_stop__arrival_time, now);
    if (arrival) {
      var shifted = new Date(Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        now.getUTCDate(),
        arrival.getUTCHours(),
        arrival.getUTCMinutes(),
        arrival.getUTCSeconds()
      ));
      if (shifted.getTime() < now.getTime() - 2 * MINUTE_MS) {
        shifted = addMinutes(shifted, 24 * 60);
      }
      copy._buspebble_arrival_time = shifted.toISOString();
      copy._buspebble_scheduled_time = shifted.toISOString();
    }
    return copy;
  });
}

function resolveSiriStopByCode(storageAdapter, publicStopCode) {
  return cached(storageAdapter, STORAGE.siriStopPrefix + publicStopCode + ':v1', 7 * DAY_MS, function() {
    return apiGet('/siri_stops/list', { codes: publicStopCode, limit: 5, order_by: 'id asc' }, 3500).then(function(payload) {
      var row = asRows(payload)[0];
      if (!row) throw { type: 'not_found', stage: 'siri_stop', code: publicStopCode };
      return row;
    });
  });
}

function getRecentSiriRideStops(siriStopId, now, settings) {
  return apiGet('/siri_ride_stops/list', {
    siri_stop_ids: siriStopId,
    siri_ride__scheduled_start_time_from: isoWithOffset(addMinutes(now, -10)),
    siri_ride__scheduled_start_time_to: isoWithOffset(addMinutes(now, 90)),
    siri_vehicle_location__recorded_at_time_from: isoWithOffset(addMinutes(now, -15)),
    gtfs_date_from: dateOnlyLocal(now),
    gtfs_date_to: dateOnlyLocal(now),
    limit: maxArrivalRows(settings || DEFAULT_SETTINGS)
  }, 4500);
}

function fetchScheduledWindow(stop, now, settings) {
  function rideStopParams(from, to) {
    var params = {
      arrival_time_from: from,
      arrival_time_to: to,
      limit: maxArrivalRows(settings || DEFAULT_SETTINGS)
    };
    if (stop.gtfsId) params.gtfs_stop_ids = stop.gtfsId;
    else params.gtfs_stop__code = stop.code;
    return params;
  }

  var currentParams = rideStopParams(isoWithOffset(now), isoWithOffset(addMinutes(now, 90)));
  return apiGet('/gtfs_ride_stops/list', currentParams, 4000).then(function(payload) {
    var rows = asRows(payload);
    if (rows.length) return rows;
    if (!stop.gtfsDate) return rows;
    return apiGet('/gtfs_ride_stops/list', rideStopParams(serviceDateIso(now, stop.gtfsDate), serviceDateIso(addMinutes(now, 90), stop.gtfsDate)), 3500).then(function(servicePayload) {
      return shiftedServiceRows(servicePayload, now);
    });
  }).catch(function(error) {
    if (!stop.gtfsDate) throw error;
    return apiGet('/gtfs_ride_stops/list', rideStopParams(serviceDateIso(now, stop.gtfsDate), serviceDateIso(addMinutes(now, 90), stop.gtfsDate)), 3500).then(function(servicePayload) {
      return shiftedServiceRows(servicePayload, now);
    });
  });
}

function getScheduledFallback(stop, now, settings, storageAdapter) {
  var storage = getStorage(storageAdapter);
  var cachedRows = transitCache.getSchedule(storage, stop.code);
  if (cachedRows.length) return Promise.resolve(cachedRows);
  return fetchScheduledWindow(stop, now, settings).then(function(rows) {
    transitCache.putSchedule(storage, stop.code, rows);
    return rows;
  });
}

function localDayStart(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
}

function shiftRowsToLocalDate(rows, targetDate) {
  return asRows(rows).map(function(row) {
    var shiftedRow = {};
    Object.keys(row).forEach(function(key) { shiftedRow[key] = row[key]; });
    var arrival = parseTime(row.arrival_time || row.gtfs_ride_stop__arrival_time, targetDate);
    if (!arrival) return shiftedRow;
    var shifted = new Date(Date.UTC(
      targetDate.getFullYear(),
      targetDate.getMonth(),
      targetDate.getDate(),
      arrival.getUTCHours(),
      arrival.getUTCMinutes(),
      arrival.getUTCSeconds()
    ));
    shiftedRow._buspebble_arrival_time = shifted.toISOString();
    shiftedRow._buspebble_scheduled_time = shifted.toISOString();
    return shiftedRow;
  });
}

function fetchScheduledDay(stop, refreshTime) {
  var targetDay = localDayStart(new Date(refreshTime || Date.now()));
  var daysAgo = 0;
  function tryServiceDay() {
    var serviceDay = addMinutes(targetDay, -daysAgo * 24 * 60);
    return apiGet('/gtfs_ride_stops/list', {
      gtfs_stop__code: stop.code,
      arrival_time_from: isoWithOffset(serviceDay),
      arrival_time_to: isoWithOffset(addMinutes(serviceDay, 24 * 60)),
      limit: 1000,
      order_by: 'arrival_time asc'
    }, 10000).then(function(payload) {
      var rows = asRows(payload);
      if (rows.length || daysAgo >= 7) {
        return daysAgo ? shiftRowsToLocalDate(rows, targetDay) : rows;
      }
      daysAgo += 1;
      return tryServiceDay();
    });
  }
  return tryServiceDay();
}

function getSparseStopArrivalsFallback(stop, settings) {
  var params = {
    limit: maxArrivalRows(settings || DEFAULT_SETTINGS),
    order_by: 'arrival_time asc'
  };
  if (stop.gtfsId) params.gtfs_stop_id = stop.gtfsId;
  else params.stop_code = stop.code;
  return apiGet('/stop_arrivals/list', params, 6000);
}

function getCurlbusLiveArrivals(stopCode) {
  return apiGetUrl(CURLBUS_API_BASE, '/' + encodeURIComponent(String(stopCode)), {}, 1500);
}

function routeResultFromPayload(payload, candidate) {
  var rows = asRows(payload).slice().sort(function(a, b) {
    return intValue(a.stop_sequence, 0) - intValue(b.stop_sequence, 0);
  });
  var stops = rows.map(function(row) {
    return {
      code: intValue(row.gtfs_stop__code || row.stop_code, 0),
      name: String(row.gtfs_stop__name || row.stop_name || row.gtfs_stop__code || 'Stop'),
      city: String(row.gtfs_stop__city || row.city || '')
    };
  });
  var currentIndex = -1;
  stops.some(function(stop, index) {
    if (stop.code !== candidate.stopCode) return false;
    currentIndex = index;
    return true;
  });
  if (!stops.length || currentIndex < 0) {
    throw { type: 'not_found', stage: 'route_stops', routeRef: candidate.routeRef };
  }
  return {
    routeRef: candidate.routeRef,
    line: candidate.line,
    stops: stops,
    currentIndex: currentIndex
  };
}

function fetchRoutePattern(candidate, now) {
  candidate = candidate || {};
  var routeRef = intValue(candidate.routeRef, 0);
  var stopCode = intValue(candidate.stopCode, 0);
  var line = String(candidate.line || '').replace(/^\s+|\s+$/g, '');
  var rideId = intValue(candidate.rideId, 0);
  var baseTime = now || new Date();
  if ((!routeRef && !line) || !stopCode) {
    return Promise.reject({ type: 'invalid_route', routeRef: routeRef, stopCode: stopCode });
  }

  function fetchRide(knownRideId) {
    return apiGet('/gtfs_ride_stops/list', {
      gtfs_ride_ids: knownRideId,
      limit: 200,
      order_by: 'stop_sequence asc'
    }, 6000).then(function(payload) {
      return routeResultFromPayload(payload, { routeRef: routeRef, line: line, stopCode: stopCode });
    });
  }
  if (rideId) return fetchRide(rideId);

  function candidateParamsFor(windowTime, useLine) {
    var params = {
      gtfs_stop__code: stopCode,
      arrival_time_from: isoWithOffset(addMinutes(windowTime, -30)),
      arrival_time_to: isoWithOffset(addMinutes(windowTime, 180)),
      limit: 32,
      order_by: 'arrival_time asc'
    };
    if (useLine || !routeRef) params.gtfs_route__route_short_name = line;
    else params.gtfs_route__line_refs = routeRef;
    return params;
  }

  var daysAgo = 0;
  function findCandidate() {
    var windowTime = addMinutes(baseTime, -daysAgo * 24 * 60);
    return apiGet('/gtfs_ride_stops/list', candidateParamsFor(windowTime, false), 5000).then(function(payload) {
      var rows = asRows(payload);
      if (rows.length || !routeRef || !line) return rows;
      return apiGet('/gtfs_ride_stops/list', candidateParamsFor(windowTime, true), 5000).then(asRows);
    }).then(function(rows) {
      if (rows.length || daysAgo >= 7) return rows;
      daysAgo += 1;
      return findCandidate();
    });
  }

  return findCandidate().then(function(rows) {
    var found = rows[0];
    rideId = found && intValue(found.gtfs_ride_id, 0);
    routeRef = found ? intValue(found.gtfs_route__line_ref, routeRef) : routeRef;
    if (!rideId) throw { type: 'not_found', stage: 'route_ride', routeRef: routeRef, line: line };
    return fetchRide(rideId);
  });
}

function getRouteStops(routeRef, stopCode, now, line, storageAdapter) {
  var storage = getStorage(storageAdapter);
  var candidate = {
    routeRef: intValue(routeRef, 0),
    stopCode: intValue(stopCode, 0),
    line: String(line || '').replace(/^\s+|\s+$/g, '')
  };
  var cachedRoute = transitCache.getRoute(storage, candidate.routeRef, candidate.stopCode, candidate.line);
  if (cachedRoute) return Promise.resolve(cachedRoute);
  return fetchRoutePattern(candidate, now).then(function(result) {
    transitCache.putRoute(storage, result);
    return result;
  });
}

function getArrivalsForStop(storageAdapter, stop, settings) {
  var storage = getStorage(storageAdapter);
  var now = new Date();
  var normalizedStop = normalizeStop(stop);
  transitCache.rememberVisitedStop(storage, normalizedStop);
  var diagnostics = { stage: 'start', source: null, errors: [], rows: 0, fallback: false };
  var cacheKey = STORAGE.arrivalsPrefix + normalizedStop.code + ':v1';

  function finish(rows, source, updatedAgoSec) {
    diagnostics.source = source;
    diagnostics.rows = rows.length;
    diagnostics.updatedAgoSec = updatedAgoSec || 0;
    diagnostics.httpStatus = diagnostics.httpStatus || 200;
    saveDiagnostics(storage, diagnostics);
    if (rows.length && source !== 'cache') {
      storage.setItem(cacheKey, JSON.stringify({ savedAt: Date.now(), value: rows }));
    }
    return {
      rows: rows.slice(0, maxArrivalRows(settings || DEFAULT_SETTINGS)),
      meta: { source: source, updatedAgoSec: updatedAgoSec || 0, diagnostics: diagnostics }
    };
  }

  function cacheFallback(status) {
    diagnostics.stage = 'cache_fallback';
    var cachedRows = loadStale(storage, cacheKey, 30 * MINUTE_MS);
    if (cachedRows && cachedRows.value && cachedRows.value.length) {
      var ageSec = Math.round((Date.now() - cachedRows.savedAt) / 1000);
      cachedRows.value.forEach(function(row) { row.source = 'cache'; });
      return finish(cachedRows.value, 'cache', ageSec);
    }
    saveDiagnostics(storage, diagnostics);
    return { rows: [], meta: { source: 'none', status: status || STATUS_NO_DATA, updatedAgoSec: 0, diagnostics: diagnostics } };
  }

  return Promise.resolve().then(function() {
    if (rateBackoffUntil(storage) > Date.now()) {
      diagnostics.errors.push({ type: 'rate_backoff', until: rateBackoffUntil(storage) });
      diagnostics.fallback = true;
      return cacheFallback(STATUS_RATE_LIMIT);
    }
    diagnostics.stage = 'curlbus_live';
    diagnostics.endpoint = 'curlbus';
    return getCurlbusLiveArrivals(normalizedStop.code).then(function(payload) {
      var curlbusArrivals = normalizeCurlbusRows(payload, normalizedStop, now, settings);
      if (curlbusArrivals.length) {
        return finish(curlbusArrivals, 'live', curlbusArrivals[0].freshnessSec || 0);
      }
      diagnostics.errors.push({ type: 'empty', stage: 'curlbus_live' });
      throw { type: 'empty', stage: 'curlbus_live' };
    }).catch(function(curlbusError) {
      diagnostics.errors.push(curlbusError);
      var scheduledRows = transitCache.getSchedule(storage, normalizedStop.code);
      var scheduledArrivals = normalizeScheduledRows(scheduledRows, normalizedStop, now, settings);
      if (scheduledArrivals.length) {
        diagnostics.stage = 'phone_gtfs_cache';
        diagnostics.endpoint = 'local';
        diagnostics.fallback = true;
        return finish(scheduledArrivals, 'scheduled', 0);
      }
      if (shouldBackoffProviderError(curlbusError)) {
        noteRateLimit(storage);
        diagnostics.fallback = true;
        return cacheFallback(statusForProviderError(curlbusError));
      }
      diagnostics.stage = 'siri_stop';
      diagnostics.endpoint = 'siri_ride_stops';
      return Promise.resolve(normalizedStop.gtfsId ? normalizedStop : getStopByCode(normalizedStop.code, storage).catch(function(stopError) {
        diagnostics.errors.push(stopError);
        return normalizedStop;
      })).then(function(resolvedStop) {
        normalizedStop = resolvedStop;
        return resolveSiriStopByCode(storage, normalizedStop.code);
      }).then(function(siriStop) {
        diagnostics.stage = 'siri_ride_stops';
        return getRecentSiriRideStops(siriStop.id || siriStop.siri_stop_id || siriStop.code, now, settings);
      });
    });
  }).then(function(payload) {
    if (payload && payload.meta && payload.rows) return payload;
    var arrivals = normalizeSiriRows(payload, normalizedStop, now, settings);
    if (arrivals.length) {
      return finish(arrivals, 'siri', arrivals[0].freshnessSec || 0);
    }
    diagnostics.errors.push({ type: 'empty', stage: 'siri_ride_stops' });
    throw { type: 'empty', stage: 'siri_ride_stops' };
  }).catch(function(error) {
    diagnostics.errors.push(error);
    if (shouldBackoffProviderError(error)) {
      noteRateLimit(storage);
    }
    diagnostics.stage = 'scheduled_fallback';
    diagnostics.endpoint = 'gtfs_ride_stops';
    diagnostics.fallback = true;
    return getScheduledFallback(normalizedStop, now, settings, storage).then(function(payload) {
      var arrivals = normalizeScheduledRows(payload, normalizedStop, now, settings);
      if (arrivals.length) return finish(arrivals, 'scheduled', 0);
      diagnostics.errors.push({ type: 'empty', stage: 'scheduled_fallback' });
      return cacheFallback(statusForProviderError(error));
    }).catch(function(fallbackError) {
      diagnostics.errors.push(fallbackError);
      return cacheFallback(statusForProviderError(error));
    });
  });
}

function shorten(value, maxLen) {
  var text = String(value || '');
  var limit = maxLen || 14;
  if (text.length <= limit) return text;
  return text.slice(0, Math.max(1, limit - 3)) + '...';
}

function watchText(value, fallback, maxLen, requireWord) {
  var text = String(value || '').replace(/\s+/g, ' ').replace(/^\s+|\s+$/g, '');
  if (!text) text = fallback || '';
  if (requireWord && text.replace(/[^A-Za-z0-9\u0590-\u05FF]/g, '').length < 2) {
    text = fallback || '';
  }
  return shorten(text, maxLen);
}

function operatorColorIndex(operator) {
  var text = String(operator || '').toLowerCase();
  if (!text) return 0;
  if (text.indexOf('egged') !== -1 || text.indexOf('\u05d0\u05d2\u05d3') !== -1) return 1;
  if (text === 'dan' || text.indexOf('dan ') !== -1 || text.indexOf(' dan') !== -1 || text.indexOf('\u05d3\u05df') !== -1) return 2;
  if (text.indexOf('metropoline') !== -1 || text.indexOf('\u05de\u05d8\u05e8\u05d5\u05e4\u05d5\u05dc\u05d9\u05df') !== -1) return 3;
  if (text.indexOf('kavim') !== -1 || text.indexOf('\u05e7\u05d5\u05d5\u05d9\u05dd') !== -1) return 4;
  if (text.indexOf('superbus') !== -1 || text.indexOf('\u05e1\u05d5\u05e4\u05e8\u05d1\u05d5\u05e1') !== -1) return 5;
  if (text.indexOf('afikim') !== -1 || text.indexOf('electra') !== -1 || text.indexOf('\u05d0\u05e4\u05d9\u05e7\u05d9\u05dd') !== -1 || text.indexOf('\u05d0\u05dc\u05e7\u05d8\u05e8\u05d4') !== -1) return 6;
  if (text.indexOf('tnufa') !== -1 || text.indexOf('tnoofa') !== -1 || text.indexOf('\u05ea\u05e0\u05d5\u05e4\u05d4') !== -1) return 7;
  if (text.indexOf('nateev') !== -1 || text.indexOf('nativ') !== -1 || text.indexOf('\u05e0\u05ea\u05d9\u05d1') !== -1) return 8;
  return 0;
}

function packArrivalRows(rows, meta, messageKeys, settings) {
  var dict = {};
  var maxRows = maxArrivalRows(settings || DEFAULT_SETTINGS);
  dict[messageKeys.Status] = meta && meta.status ? meta.status : STATUS_OK;
  dict[messageKeys.Source] = settings && settings.show_source_badge === false ? 0 : sourceToInt(meta && meta.source);
  dict[messageKeys.UpdatedAgoSec] = (meta && meta.updatedAgoSec) || 0;
  dict[messageKeys.ReqType] = 1;
  rows.slice(0, maxRows).forEach(function(row, i) {
    var flags = intValue(row.flags, 0);
    flags = (flags & ~OPERATOR_COLOR_MASK) | (operatorColorIndex(row.operator) << OPERATOR_COLOR_SHIFT);
    var vibrateUnderMin = settings ? intValue(settings.vibrate_under_min, DEFAULT_SETTINGS.vibrate_under_min) : DEFAULT_SETTINGS.vibrate_under_min;
    var canVibrate = !settings || settings.alert_only_favorite_lines !== true || (flags & 1);
    if (canVibrate && vibrateUnderMin > 0 && intValue(row.minutes, 999) <= vibrateUnderMin) flags |= 8;
    dict[messageKeys.Line0 + i] = watchText(row.line, '?', MAX_TEXT_CHARS, false);
    dict[messageKeys.Dest0 + i] = settings && settings.show_destination === false ? '' : watchText(row.destination, 'Scheduled', MAX_TEXT_CHARS, true);
    dict[messageKeys.Minutes0 + i] = intValue(row.minutes, 0);
    dict[messageKeys.DelayMin0 + i] = intValue(row.delayMin, 0);
    dict[messageKeys.Flags0 + i] = flags;
    if (messageKeys.ArrivalRoute0 !== undefined) {
      dict[messageKeys.ArrivalRoute0 + i] = intValue(row.routeRef, 0);
    }
  });
  return dict;
}

function packRouteStops(result, messageKeys) {
  var dict = {};
  var stops = result && result.stops ? result.stops : [];
  var currentIndex = intValue(result && result.currentIndex, 0);
  var start = currentIndex >= MAX_ROUTE_STOP_ROWS ? currentIndex - Math.floor(MAX_ROUTE_STOP_ROWS / 2) : 0;
  if (start + MAX_ROUTE_STOP_ROWS > stops.length) start = Math.max(0, stops.length - MAX_ROUTE_STOP_ROWS);
  var visibleStops = stops.slice(start, start + MAX_ROUTE_STOP_ROWS);

  dict[messageKeys.ReqType] = 7;
  dict[messageKeys.Status] = STATUS_OK;
  dict[messageKeys.RouteRef] = intValue(result && result.routeRef, 0);
  dict[messageKeys.RouteCurrentIndex] = Math.max(0, currentIndex - start);
  dict[messageKeys.RouteStopCount] = visibleStops.length;
  visibleStops.forEach(function(stop, index) {
    dict[messageKeys.RouteStopName0 + index] = watchText(stop.name, 'Stop ' + stop.code, 20, true);
    if (messageKeys.RouteStopCode0 !== undefined) {
      dict[messageKeys.RouteStopCode0 + index] = intValue(stop.code, 0);
    }
  });
  return dict;
}

function packStops(stops, reqType, messageKeys, settings) {
  var dict = {};
  dict[messageKeys.ReqType] = reqType;
  dict[messageKeys.Status] = 0;
  if (reqType === 5 && messageKeys.SettingsUpdated !== undefined) {
    dict[messageKeys.SettingsUpdated] = settings && settings.default_screen === 'nearby' ? 2 : 1;
  }
  if (reqType === 5 && messageKeys.RefreshSec !== undefined) {
    dict[messageKeys.RefreshSec] = intValue(settings && settings.refresh_sec, DEFAULT_SETTINGS.refresh_sec);
  }
  if (reqType === 5 && messageKeys.DebugEnabled !== undefined) {
    dict[messageKeys.DebugEnabled] = settings && settings.debug ? 1 : 0;
  }
  if (reqType === 5 && messageKeys.DarkMode !== undefined) {
    dict[messageKeys.DarkMode] = settings && settings.dark_mode ? 1 : 0;
  }
  stops.slice(0, MAX_STOP_ROWS).forEach(function(stop, i) {
    var normalized = normalizeStop(stop);
    dict[messageKeys.StopName0 + i] = watchText(normalized.name, 'Stop ' + normalized.code, MAX_STOP_NAME_CHARS, true);
    dict[messageKeys.StopCodeList0 + i] = normalized.code;
    dict[messageKeys.StopDistM0 + i] = settings && settings.show_distance === false ? 0 : intValue(normalized.distanceM, 0);
  });
  return dict;
}

function packError(status, reqType, messageKeys) {
  var dict = {};
  dict[messageKeys.ReqType] = reqType || 0;
  dict[messageKeys.Status] = status || 1;
  dict[messageKeys.Source] = 0;
  dict[messageKeys.UpdatedAgoSec] = 0;
  return dict;
}

var dailyTransitRefreshPromise = null;

function refreshDailyTransitCache(storageAdapter, settings, now) {
  var storage = getStorage(storageAdapter);
  if (dailyTransitRefreshPromise) return dailyTransitRefreshPromise;
  dailyTransitRefreshPromise = transitCache.refreshDaily(storage, settings, {
    loadSchedule: function(stop, refreshTime) {
      return fetchScheduledDay(normalizeStop(stop), refreshTime);
    },
    loadRoute: function(candidate, refreshTime) {
      return fetchRoutePattern(candidate, new Date(refreshTime));
    }
  }, now).then(function(snapshot) {
    dailyTransitRefreshPromise = null;
    return snapshot;
  }, function(error) {
    dailyTransitRefreshPromise = null;
    throw error;
  });
  return dailyTransitRefreshPromise;
}

function getTransitCacheStatus(storageAdapter) {
  var snapshot = transitCache.readSnapshot(getStorage(storageAdapter));
  return {
    status: snapshot.status,
    savedAt: snapshot.savedAt,
    expiresAt: snapshot.expiresAt,
    stationCount: snapshot.stations.length,
    stopCount: snapshot.stations.length,
    scheduleCount: Object.keys(snapshot.schedules).length,
    routeCount: Object.keys(snapshot.routes).length,
    snapshotBytes: JSON.stringify(snapshot).length
  };
}

function invalidateTransitCache(storageAdapter) {
  return transitCache.invalidate(getStorage(storageAdapter));
}

function normalizeBusNearbyStop(stop) {
  return normalizeStop({
    id: stop.id,
    code: stop.code,
    name: stop.name,
    city: stop.city || '',
    lat: stop.lat,
    lon: stop.lon,
    distanceM: stop.dist
  });
}

function fetchBusNearbyStops(lat, lon, radiusM, settings) {
  var locale = settings && settings.language === 'he' ? 'he' : 'en';
  return apiGetUrl(BUS_NEARBY_API_BASE, '/index/stops', {
    locale: locale,
    radius: radiusM || DEFAULT_SETTINGS.radius_m,
    lat: lat,
    lon: lon
  }, 4500).then(function(payload) {
    return asRows(payload).map(normalizeBusNearbyStop).filter(function(stop) {
      return stop.code && stop.lat && stop.lon;
    }).slice(0, MAX_STOP_ROWS);
  });
}

function warmNearbyTransitCache(storageAdapter, stops, settings, now) {
  var storage = getStorage(storageAdapter);
  var refreshTime = now instanceof Date ? now.getTime() : Number(now || Date.now());
  var nearbyStations = uniqueStops((stops || []).map(normalizeStop)).slice(0, MAX_STOP_ROWS);
  var routeCandidates = [];
  var stationIndex = 0;
  transitCache.rememberStations(storage, nearbyStations);

  function loadNextSchedule() {
    if (stationIndex >= nearbyStations.length) return loadRoutes();
    var station = nearbyStations[stationIndex++];
    return fetchScheduledDay(station, refreshTime).then(function(rows) {
      transitCache.putSchedule(storage, station.code, rows, refreshTime);
      (rows || []).forEach(function(row) {
        var candidate = transitCache.routeCandidate(row, station.code);
        if (candidate) routeCandidates.push(candidate);
      });
      return loadNextSchedule();
    }, function() {
      return loadNextSchedule();
    });
  }

  function loadRoutes() {
    routeCandidates = transitCache.uniqueRouteCandidates(routeCandidates, 32);
    var routeIndex = 0;
    function loadNextRoute() {
      if (routeIndex >= routeCandidates.length) return getTransitCacheStatus(storage);
      var candidate = routeCandidates[routeIndex++];
      return fetchRoutePattern(candidate, new Date(refreshTime)).then(function(route) {
        transitCache.putRoute(storage, route, refreshTime);
        return loadNextRoute();
      }, function() {
        return loadNextRoute();
      });
    }
    return loadNextRoute();
  }

  return loadNextSchedule();
}

function addFavoriteStop(storageAdapter, stop) {
  var storage = getStorage(storageAdapter);
  var settings = parseSettings(null, storage);
  settings.favorite_stops = uniqueStops((settings.favorite_stops || []).concat([stop]));
  saveSettings(settings, storage);
  return settings.favorite_stops;
}

function removeFavoriteStop(storageAdapter, stopCode) {
  var storage = getStorage(storageAdapter);
  var settings = parseSettings(null, storage);
  settings.favorite_stops = (settings.favorite_stops || []).filter(function(stop) {
    return String(stop.code) !== String(stopCode);
  });
  if (!settings.favorite_stops.length) settings.favorite_stops = clone(DEFAULT_SETTINGS.favorite_stops);
  saveSettings(settings, storage);
  return settings.favorite_stops;
}

function toggleFavoriteLine(storageAdapter, line) {
  var storage = getStorage(storageAdapter);
  var settings = parseSettings(null, storage);
  var exists = false;
  settings.favorite_lines = (settings.favorite_lines || []).filter(function(fav) {
    if (String(fav.line) === String(line)) {
      exists = true;
      return false;
    }
    return true;
  });
  if (!exists) settings.favorite_lines.push({ line: String(line), operator: '' });
  settings.favorite_lines = uniqueLines(settings.favorite_lines);
  saveSettings(settings, storage);
  return settings.favorite_lines;
}

module.exports = {
  API_BASE: API_BASE,
  BUS_NEARBY_API_BASE: BUS_NEARBY_API_BASE,
  CURLBUS_API_BASE: CURLBUS_API_BASE,
  DEFAULT_SETTINGS: DEFAULT_SETTINGS,
  STORAGE: STORAGE,
  STATUS_NO_DATA: STATUS_NO_DATA,
  STATUS_API_AUTH: STATUS_API_AUTH,
  STATUS_RATE_LIMIT: STATUS_RATE_LIMIT,
  sourceToInt: sourceToInt,
  sourceLabel: sourceLabel,
  safeJsonParse: safeJsonParse,
  parseSettings: parseSettings,
  saveSettings: saveSettings,
  applyConfigValues: applyConfigValues,
  normalizeConfigValues: normalizeConfigValues,
  normalizeSiriRows: normalizeSiriRows,
  normalizeCurlbusRows: normalizeCurlbusRows,
  normalizeScheduledRows: normalizeScheduledRows,
  operatorColorIndex: operatorColorIndex,
  packArrivalRows: packArrivalRows,
  packRouteStops: packRouteStops,
  packStops: packStops,
  packDiagnostics: packDiagnostics,
  packError: packError,
  loadDiagnostics: loadDiagnostics,
  shouldBackoffProviderError: shouldBackoffProviderError,
  fetchBusNearbyStops: fetchBusNearbyStops,
  warmNearbyTransitCache: warmNearbyTransitCache,
  normalizeBusNearbyStop: normalizeBusNearbyStop,
  getArrivalsForStop: getArrivalsForStop,
  getRouteStops: getRouteStops,
  refreshDailyTransitCache: refreshDailyTransitCache,
  getTransitCacheStatus: getTransitCacheStatus,
  invalidateTransitCache: invalidateTransitCache,
  addFavoriteStop: addFavoriteStop,
  removeFavoriteStop: removeFavoriteStop,
  toggleFavoriteLine: toggleFavoriteLine,
  getStopByCode: getStopByCode,
  shorten: shorten,
  memoryStorage: memoryStorage,
  normalizeStop: normalizeStop
};
