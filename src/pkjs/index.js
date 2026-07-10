var MessageKeys = require('message_keys');
var core = require('./buspebble_core');
var clayConfig = require('./config');

var settings = core.parseSettings();
var Clay = null;
var clay = null;

try {
  Clay = require('pebble-clay');
  clay = new Clay(clayConfig, null, { autoHandleEvents: false });
} catch (e) {
  console.log('Clay unavailable, using built-in config URL fallback: ' + e);
}

function send(dict) {
  Pebble.sendAppMessage(dict, function() {
    console.log('sent ' + JSON.stringify(dict));
  }, function(error) {
    console.log('send failed ' + JSON.stringify(error));
  });
}

function sendError(status, reqType) {
  send(core.packError(status, reqType, MessageKeys));
}

function messageValue(dict, keyName, fallback) {
  var numericKey = MessageKeys[keyName];
  if (numericKey !== undefined && Object.prototype.hasOwnProperty.call(dict, numericKey)) {
    return dict[numericKey];
  }
  if (Object.prototype.hasOwnProperty.call(dict, keyName)) {
    return dict[keyName];
  }
  return fallback;
}

function syncSettingsToWatch() {
  settings = core.parseSettings();
  send(core.packStops(settings.favorite_stops || [], 5, MessageKeys, settings));
}

function refreshPhoneCache() {
  core.refreshDailyTransitCache(null, settings).then(function() {
    console.log('phone GTFS cache ready ' + JSON.stringify(core.getTransitCacheStatus(null)));
  }).catch(function(error) {
    console.log('phone GTFS cache refresh failed; keeping previous snapshot ' + JSON.stringify(error));
  });
}

function requestArrivals(dict) {
  var defaultStopCode = (settings.favorite_stops && settings.favorite_stops[0]) ? settings.favorite_stops[0].code : 0;
  var stopCode = messageValue(dict, 'StopCode', null);
  if (stopCode === null || stopCode === undefined || stopCode === '') {
    stopCode = messageValue(dict, 'StopCodeList0', defaultStopCode);
  }
  var stop = null;
  (settings.favorite_stops || []).some(function(candidate) {
    if (String(candidate.code) === String(stopCode)) {
      stop = candidate;
      return true;
    }
    return false;
  });
  if (!stop) stop = { code: stopCode, name: 'Stop ' + stopCode };

  core.getArrivalsForStop(null, stop, settings).then(function(result) {
    var packed = core.packArrivalRows(result.rows, result.meta, MessageKeys, settings);
    send(packed);
  }).catch(function(error) {
    console.log('arrival request failed ' + JSON.stringify(error));
    sendError(10, 1);
  });
}

function requestNearby(dict) {
  var radius = messageValue(dict, 'RadiusM', settings.radius_m || 400);
  navigator.geolocation.getCurrentPosition(function(position) {
    var lat = position.coords.latitude;
    var lon = position.coords.longitude;
    core.fetchBusNearbyStops(lat, lon, radius, settings).then(function(stops) {
      send(core.packStops(stops, 2, MessageKeys, settings));
      core.warmNearbyTransitCache(null, stops, settings).then(function(status) {
        console.log('nearby GTFS cache ready ' + JSON.stringify(status));
      }).catch(function(error) {
        console.log('nearby GTFS cache warm failed; keeping prior data ' + JSON.stringify(error));
      });
    }).catch(function(error) {
      console.log('nearby stop request failed ' + JSON.stringify(error));
      sendError(11, 2);
    });
  }, function(error) {
    console.log('geolocation failed ' + JSON.stringify(error));
    sendError(12, 2);
  }, {
    enableHighAccuracy: false,
    maximumAge: 60000,
    timeout: 7000
  });
}

function favoriteStop(dict) {
  var stopCode = messageValue(dict, 'StopCode', null);
  if (!stopCode) {
    sendError(20, 3);
    return;
  }
  var action = messageValue(dict, 'FavoriteAction', 1);
  var knownStop = { code: stopCode, name: 'Stop ' + stopCode };
  if (action < 0) {
    core.removeFavoriteStop(null, stopCode);
    core.invalidateTransitCache(null);
    syncSettingsToWatch();
    setTimeout(refreshPhoneCache, 0);
    return;
  }
  core.getStopByCode(stopCode).catch(function() {
    return knownStop;
  }).then(function(stop) {
    core.addFavoriteStop(null, stop);
    core.invalidateTransitCache(null);
    syncSettingsToWatch();
    setTimeout(refreshPhoneCache, 0);
  });
}

function favoriteLine(dict) {
  var line = messageValue(dict, 'Line0', null);
  if (!line) {
    sendError(21, 4);
    return;
  }
  var stopCode = messageValue(dict, 'StopCode', 0);
  var favoriteLines = core.toggleFavoriteLine(null, line);
  settings = core.parseSettings();
  core.invalidateTransitCache(null);
  var isFavorite = favoriteLines.some(function(favorite) {
    return String(favorite.line) === String(line);
  });
  if (isFavorite && stopCode) {
    core.getStopByCode(stopCode).then(function(stop) {
      return core.warmNearbyTransitCache(null, [stop], settings);
    }).then(function(status) {
      console.log('favorite line GTFS cache ready ' + JSON.stringify(status));
    }).catch(function(error) {
      console.log('favorite line GTFS cache warm failed ' + JSON.stringify(error));
    });
  } else {
    setTimeout(refreshPhoneCache, 0);
  }
  var response = {};
  response[MessageKeys.ReqType] = 4;
  response[MessageKeys.Status] = 0;
  send(response);
}

function requestDiagnostics() {
  send(core.packDiagnostics(core.loadDiagnostics(null), MessageKeys, core.getTransitCacheStatus(null)));
}

function requestRouteStops(dict) {
  var routeRef = messageValue(dict, 'RouteRef', 0);
  var stopCode = messageValue(dict, 'StopCode', 0);
  var line = messageValue(dict, 'Line0', '');
  core.getRouteStops(routeRef, stopCode, null, line).then(function(result) {
    send(core.packRouteStops(result, MessageKeys));
  }).catch(function(error) {
    console.log('route stop request failed ' + JSON.stringify(error));
    sendError(10, 7);
  });
}

function handleMessage(event) {
  var dict = event.payload || {};
  var reqType = messageValue(dict, 'ReqType', 5);
  settings = core.parseSettings();
  console.log('received req ' + reqType + ' ' + JSON.stringify(dict));
  if (reqType === 1) requestArrivals(dict);
  else if (reqType === 2) requestNearby(dict);
  else if (reqType === 3) favoriteStop(dict);
  else if (reqType === 4) favoriteLine(dict);
  else if (reqType === 5) syncSettingsToWatch();
  else if (reqType === 6) requestDiagnostics();
  else if (reqType === 7) requestRouteStops(dict);
  else sendError(99, reqType);
}

function parseConfigResponse(response) {
  if (!response) return null;
  if (clay && clay.getSettings) {
    try {
      return clay.getSettings(response, false);
    } catch (e) {
      console.log('Clay parse failed, falling back: ' + e);
    }
  }
  try {
    return JSON.parse(decodeURIComponent(response));
  } catch (e2) {
    return null;
  }
}

function applyConfigValues(values) {
  if (!values) return;
  values = core.normalizeConfigValues(values);
  settings = core.applyConfigValues(values);
  var cacheInputsChanged = values.ClearCache === true || values.ClearCache === 'true' ||
    !!values.FavoriteStopsJson || !!values.favorite_stops_json ||
    !!values.ManualStopCode || !!values.manual_stop_code ||
    !!values.FavoriteLinesJson || !!values.favorite_lines_json ||
    !!values.FavoriteLinesCsv || !!values.favorite_lines_csv;
  if (cacheInputsChanged) {
    core.invalidateTransitCache(null);
    setTimeout(refreshPhoneCache, 0);
  }
  var manualStopCode = values.ManualStopCode || values.manual_stop_code;
  if (manualStopCode) {
    core.getStopByCode(manualStopCode).then(function(stop) {
      core.addFavoriteStop(null, stop);
      syncSettingsToWatch();
    }).catch(function(error) {
      console.log('manual stop code add failed ' + JSON.stringify(error));
      syncSettingsToWatch();
    });
  } else {
    syncSettingsToWatch();
  }
}

function fallbackConfigUrl() {
  var html = [
    '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">',
    '<title>BusPebbIL Settings</title></head><body>',
    '<h1>BusPebbIL</h1>',
    '<label>Favorite stops JSON<br><textarea id="stops" rows="8" style="width:100%">',
    JSON.stringify(settings.favorite_stops || []),
    '</textarea></label><br>',
    '<label>Add stop code<br><input id="manualStopCode" style="width:100%"></label><br>',
    '<label>Favorite lines CSV<br><input id="lines" value="',
    (settings.favorite_lines || []).map(function(line) { return line.line; }).join(','),
    '" style="width:100%"></label><br>',
    '<label>Favorite lines JSON<br><textarea id="linesJson" rows="4" style="width:100%">',
    JSON.stringify(settings.favorite_lines || []),
    '</textarea></label><br>',
    '<label>Max arrivals<br><input id="maxArrivals" value="', settings.max_arrivals, '" style="width:100%"></label><br>',
    '<label>Vibrate under minutes<br><input id="vibrateUnderMin" value="', settings.vibrate_under_min, '" style="width:100%"></label><br>',
    '<label><input type="checkbox" id="darkMode"', settings.dark_mode ? ' checked' : '', '> Dark mode</label><br>',
    '<label><input type="checkbox" id="alertOnlyFavoriteLines"', settings.alert_only_favorite_lines ? ' checked' : '', '> Only favorite lines</label><br>',
    '<button onclick="save()">Save</button>',
    '<script>function save(){var data={FavoriteStopsJson:document.getElementById("stops").value,ManualStopCode:document.getElementById("manualStopCode").value,FavoriteLinesCsv:document.getElementById("lines").value,FavoriteLinesJson:document.getElementById("linesJson").value,MaxArrivals:document.getElementById("maxArrivals").value,VibrateUnderMin:document.getElementById("vibrateUnderMin").value,DarkMode:document.getElementById("darkMode").checked,AlertOnlyFavoriteLines:document.getElementById("alertOnlyFavoriteLines").checked};document.location="pebblejs://close#"+encodeURIComponent(JSON.stringify(data));}</script>',
    '</body></html>'
  ].join('');
  return 'data:text/html,' + encodeURIComponent(html);
}

Pebble.addEventListener('ready', function() {
  console.log('BusPebbIL ready');
  settings = core.parseSettings();
  syncSettingsToWatch();
  setTimeout(refreshPhoneCache, 0);
});

Pebble.addEventListener('appmessage', handleMessage);

Pebble.addEventListener('showConfiguration', function() {
  if (clay && clay.generateUrl) {
    Pebble.openURL(clay.generateUrl());
  } else {
    Pebble.openURL(fallbackConfigUrl());
  }
});

Pebble.addEventListener('webviewclosed', function(event) {
  var values = parseConfigResponse(event.response);
  applyConfigValues(values);
});
