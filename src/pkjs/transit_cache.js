var DAY_MS = 24 * 60 * 60 * 1000;
var SNAPSHOT_KEY = 'gtfsCache:snapshot:v2';
var LEGACY_SNAPSHOT_KEY = 'gtfsCache:snapshot:v1';
var SNAPSHOT_VERSION = 2;
var MAX_STATIONS = 64;
var MAX_SCHEDULES = 64;
var MAX_ROUTES = 128;
var MAX_DAILY_ROUTES = 32;
var cachedRaw = null;
var cachedSnapshot = null;

function copy(value) {
  return JSON.parse(JSON.stringify(value));
}

function createSnapshot(values) {
  values = values || {};
  var savedAt = Number(values.savedAt || 0);
  var hasData = (values.stations || values.visited || []).length ||
    Object.keys(values.schedules || {}).length || Object.keys(values.routes || {}).length;
  var status = values.status || (savedAt ? 'ready' : (hasData ? 'partial' : 'empty'));
  if (status === 'empty' && hasData) status = 'partial';
  return {
    version: SNAPSHOT_VERSION,
    status: status,
    savedAt: savedAt,
    expiresAt: Number(values.expiresAt || (savedAt ? savedAt + DAY_MS : 0)),
    stations: values.stations || values.visited || [],
    schedules: values.schedules || {},
    routes: values.routes || {},
    lastError: values.lastError || null
  };
}

function parseSnapshot(raw, allowLegacy) {
  try {
    var parsed = JSON.parse(raw);
    if (!parsed) return null;
    if (parsed.version === SNAPSHOT_VERSION) return createSnapshot(parsed);
    if (allowLegacy && parsed.version === 1) {
      return createSnapshot({
        status: 'stale',
        savedAt: parsed.savedAt,
        expiresAt: 0,
        stations: parsed.visited || [],
        schedules: parsed.schedules || {},
        routes: parsed.routes || {},
        lastError: parsed.lastError
      });
    }
  } catch (error) {
    return null;
  }
  return null;
}

function readSnapshot(storage) {
  var raw = storage && storage.getItem ? storage.getItem(SNAPSHOT_KEY) : null;
  var allowLegacy = false;
  if (!raw && storage && storage.getItem) {
    raw = storage.getItem(LEGACY_SNAPSHOT_KEY);
    allowLegacy = true;
  }
  if (!raw) return createSnapshot();
  if (raw === cachedRaw && cachedSnapshot) return cachedSnapshot;
  var snapshot = parseSnapshot(raw, allowLegacy) || createSnapshot();
  if (allowLegacy && snapshot.version === SNAPSHOT_VERSION) {
    snapshot = writeSnapshot(storage, snapshot);
    storage.removeItem(LEGACY_SNAPSHOT_KEY);
    return snapshot;
  }
  cachedRaw = raw;
  cachedSnapshot = snapshot;
  return snapshot;
}

function writeSnapshot(storage, snapshot) {
  var normalized = createSnapshot(snapshot);
  var raw = JSON.stringify(normalized);
  storage.setItem(SNAPSHOT_KEY, raw);
  cachedRaw = raw;
  cachedSnapshot = normalized;
  return normalized;
}

function isFresh(snapshot, now) {
  return snapshot.status === 'ready' && snapshot.expiresAt > now;
}

function stopCode(stop) {
  return Number(stop && (stop.code || stop.stop_code || stop.stopCode) || 0);
}

function uniqueStops(stops, limit) {
  var seen = {};
  var result = [];
  (stops || []).some(function(stop) {
    var code = stopCode(stop);
    if (!code || seen[code]) return false;
    seen[code] = true;
    result.push(stop);
    return limit && result.length >= limit;
  });
  return result;
}

function findStop(storage, code) {
  var target = Number(code || 0);
  var found = null;
  readSnapshot(storage).stations.some(function(stop) {
    if (stopCode(stop) !== target) return false;
    found = stop;
    return true;
  });
  return found;
}

function rememberStations(storage, stations) {
  var existing = readSnapshot(storage);
  var snapshot = copy(existing);
  snapshot.stations = uniqueStops((stations || []).concat(snapshot.stations), MAX_STATIONS);
  return writeSnapshot(storage, snapshot);
}

function rememberVisitedStop(storage, stop) {
  if (!stopCode(stop)) return readSnapshot(storage);
  return rememberStations(storage, [stop]);
}

function trimOldestEntries(entries, limit) {
  var keys = Object.keys(entries || {});
  if (keys.length <= limit) return entries;
  keys.sort(function(a, b) {
    return Number(entries[b].savedAt || 0) - Number(entries[a].savedAt || 0);
  });
  var trimmed = {};
  keys.slice(0, limit).forEach(function(key) { trimmed[key] = entries[key]; });
  return trimmed;
}

function putSchedule(storage, code, rows, savedAt) {
  var snapshot = copy(readSnapshot(storage));
  snapshot.schedules[String(Number(code))] = {
    savedAt: Number(savedAt || Date.now()),
    rows: (rows || []).slice(0, 1000)
  };
  snapshot.schedules = trimOldestEntries(snapshot.schedules, MAX_SCHEDULES);
  return writeSnapshot(storage, snapshot);
}

function getSchedule(storage, code) {
  var entry = readSnapshot(storage).schedules[String(Number(code))];
  return entry && entry.rows ? entry.rows : [];
}

function routeKey(route) {
  var routeRef = Number(route && route.routeRef || 0);
  if (routeRef) return 'ref:' + routeRef;
  return 'line:' + String(route && route.line || '');
}

function putRoute(storage, route, savedAt) {
  if (!route || !route.stops || !route.stops.length) return readSnapshot(storage);
  var snapshot = copy(readSnapshot(storage));
  var storedRoute = {
    savedAt: Number(savedAt || Date.now()),
    routeRef: Number(route.routeRef || 0),
    line: String(route.line || ''),
    stops: route.stops
  };
  snapshot.routes[routeKey(storedRoute)] = storedRoute;
  snapshot.routes = trimOldestEntries(snapshot.routes, MAX_ROUTES);
  return writeSnapshot(storage, snapshot);
}

function routeContainsStop(route, code) {
  var target = Number(code || 0);
  return (route.stops || []).some(function(stop) { return stopCode(stop) === target; });
}

function getRoute(storage, routeRef, code, line) {
  var snapshot = readSnapshot(storage);
  var route = snapshot.routes['ref:' + Number(routeRef || 0)] || null;
  if (!route) {
    Object.keys(snapshot.routes).some(function(key) {
      var candidate = snapshot.routes[key];
      if (line && String(candidate.line) !== String(line)) return false;
      if (!routeContainsStop(candidate, code)) return false;
      route = candidate;
      return true;
    });
  }
  if (!route || !routeContainsStop(route, code)) return null;
  var currentIndex = -1;
  route.stops.some(function(stop, index) {
    if (stopCode(stop) !== Number(code)) return false;
    currentIndex = index;
    return true;
  });
  return {
    routeRef: Number(route.routeRef || routeRef || 0),
    line: route.line,
    stops: route.stops,
    currentIndex: currentIndex
  };
}

function favoriteLineSet(settings) {
  var lines = {};
  (settings && settings.favorite_lines || []).forEach(function(favorite) {
    var line = String(favorite && favorite.line || '');
    if (line) lines[line] = true;
  });
  return lines;
}

function routeCandidate(row, fallbackStopCode) {
  var routeRef = Number(row && (row.gtfs_route__line_ref || row.routeRef) || 0);
  var line = String(row && (row.gtfs_route__route_short_name || row.line) || '');
  var rideId = Number(row && (row.gtfs_ride_id || row.rideId) || 0);
  if (!routeRef && !line) return null;
  return {
    rideId: rideId,
    routeRef: routeRef,
    line: line,
    stopCode: Number(row && (row.gtfs_stop__code || row.stopCode) || fallbackStopCode || 0)
  };
}

function uniqueRouteCandidates(candidates, limit) {
  var seen = {};
  var result = [];
  (candidates || []).some(function(candidate) {
    if (!candidate) return false;
    var key = candidate.routeRef ? 'route:' + candidate.routeRef :
      'ride:' + candidate.rideId + ':' + candidate.line;
    if (seen[key]) return false;
    seen[key] = true;
    result.push(candidate);
    return limit && result.length >= limit;
  });
  return result;
}

function favoriteRouteCandidates(snapshot, favoriteLines) {
  var candidates = [];
  Object.keys(snapshot.routes).forEach(function(key) {
    var route = snapshot.routes[key];
    if (!favoriteLines[String(route.line || '')] || !route.stops.length) return;
    candidates.push({
      routeRef: Number(route.routeRef || 0),
      line: String(route.line || ''),
      stopCode: stopCode(route.stops[0])
    });
  });
  return candidates;
}

function mergeLatest(next, latest) {
  next.stations = uniqueStops(latest.stations.concat(next.stations), MAX_STATIONS);
  Object.keys(latest.routes).forEach(function(key) { next.routes[key] = latest.routes[key]; });
  Object.keys(latest.schedules).forEach(function(key) {
    if (!next.schedules[key] || latest.schedules[key].savedAt > next.schedules[key].savedAt) {
      next.schedules[key] = latest.schedules[key];
    }
  });
  next.routes = trimOldestEntries(next.routes, MAX_ROUTES);
  next.schedules = trimOldestEntries(next.schedules, MAX_SCHEDULES);
}

function refreshDaily(storage, settings, loaders, now) {
  var refreshTime = Number(now || Date.now());
  var existing = readSnapshot(storage);
  if (isFresh(existing, refreshTime)) return Promise.resolve(existing);

  var favoriteStops = uniqueStops(settings && settings.favorite_stops || []);
  var favoriteLines = favoriteLineSet(settings);
  var routeCandidates = favoriteRouteCandidates(existing, favoriteLines);
  var next = createSnapshot({
    status: 'refreshing',
    savedAt: refreshTime,
    expiresAt: refreshTime + DAY_MS,
    stations: uniqueStops(favoriteStops.concat(existing.stations), MAX_STATIONS),
    schedules: copy(existing.schedules),
    routes: copy(existing.routes)
  });
  var stopIndex = 0;

  function loadNextSchedule() {
    if (stopIndex >= favoriteStops.length) return loadRoutes();
    var stop = favoriteStops[stopIndex++];
    return Promise.resolve(loaders.loadSchedule(stop, refreshTime)).then(function(rows) {
      next.schedules[String(stopCode(stop))] = {
        savedAt: refreshTime,
        rows: (rows || []).slice(0, 1000)
      };
      (rows || []).forEach(function(row) {
        var candidate = routeCandidate(row, stopCode(stop));
        if (candidate && favoriteLines[candidate.line]) routeCandidates.push(candidate);
      });
      return loadNextSchedule();
    });
  }

  function loadRoutes() {
    routeCandidates = uniqueRouteCandidates(routeCandidates, MAX_DAILY_ROUTES);
    var routeIndex = 0;
    function loadNextRoute() {
      if (routeIndex >= routeCandidates.length || !loaders.loadRoute) return finish();
      var candidate = routeCandidates[routeIndex++];
      return Promise.resolve(loaders.loadRoute(candidate, refreshTime)).then(function(route) {
        if (route && route.stops && route.stops.length) {
          route.savedAt = refreshTime;
          next.routes[routeKey(route)] = route;
        }
        return loadNextRoute();
      }, function() {
        return loadNextRoute();
      });
    }
    return loadNextRoute();
  }

  function finish() {
    mergeLatest(next, readSnapshot(storage));
    next.status = 'ready';
    next.lastError = null;
    return writeSnapshot(storage, next);
  }

  return loadNextSchedule();
}

function clear(storage) {
  storage.removeItem(SNAPSHOT_KEY);
  storage.removeItem(LEGACY_SNAPSHOT_KEY);
  cachedRaw = null;
  cachedSnapshot = null;
}

function invalidate(storage) {
  var snapshot = copy(readSnapshot(storage));
  snapshot.status = 'stale';
  snapshot.expiresAt = 0;
  return writeSnapshot(storage, snapshot);
}

module.exports = {
  DAY_MS: DAY_MS,
  SNAPSHOT_KEY: SNAPSHOT_KEY,
  createSnapshot: createSnapshot,
  readSnapshot: readSnapshot,
  writeSnapshot: writeSnapshot,
  isFresh: isFresh,
  findStop: findStop,
  rememberStations: rememberStations,
  rememberVisitedStop: rememberVisitedStop,
  putSchedule: putSchedule,
  getSchedule: getSchedule,
  putRoute: putRoute,
  getRoute: getRoute,
  routeCandidate: routeCandidate,
  uniqueRouteCandidates: uniqueRouteCandidates,
  refreshDaily: refreshDaily,
  clear: clear,
  invalidate: invalidate,
  invalidateStops: invalidate
};
