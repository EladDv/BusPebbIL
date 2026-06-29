const assert = require('assert');
const fs = require('fs');
const path = require('path');
const core = require('../src/pkjs/buspebble_core');

const keys = {
  ReqType: 0,
  StopId: 1,
  StopCode: 2,
  LatE6: 3,
  LonE6: 4,
  RadiusM: 5,
  Status: 6,
  UpdatedAgoSec: 7,
  Source: 8,
  StopName0: 9,
  StopCodeList0: 21,
  StopDistM0: 33,
  Line0: 45,
  Dest0: 69,
  Minutes0: 93,
  DelayMin0: 117,
  Flags0: 141,
  FavoriteAction: 165,
  SettingsUpdated: 166,
  ManualStopCode: 167,
  RefreshSec: 168,
  MaxArrivals: 169,
  AlertOnlyFavoriteLines: 170,
  ForceStopIndexRefresh: 171,
  DebugEnabled: 172,
  DarkMode: 173,
  DebugLine0: 174,
  DebugLine1: 175,
  DebugLine2: 176,
  DebugLine3: 177
};

function fixture(name) {
  return JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8'));
}

function testNormalizeSiriRows() {
  const now = new Date('2026-06-28T09:00:00+03:00');
  const rows = [
    {
      gtfs_route__route_short_name: '5',
      gtfs_route__route_long_name: 'Central Station',
      gtfs_ride_stop__arrival_time: '2026-06-28T09:04:00+03:00',
      siri_ride__scheduled_start_time: '2026-06-28T09:02:00+03:00',
      nearest_siri_vehicle_location__recorded_at_time: '2026-06-28T08:59:30+03:00'
    },
    {
      gtfs_route__route_short_name: '5',
      gtfs_route__route_long_name: 'Central Station',
      gtfs_ride_stop__arrival_time: '2026-06-28T09:04:00+03:00',
      nearest_siri_vehicle_location__recorded_at_time: '2026-06-28T08:59:30+03:00'
    },
    {
      gtfs_route__route_short_name: '10',
      gtfs_ride_stop__arrival_time: '2026-06-28T08:30:00+03:00'
    }
  ];
  const settings = core.parseSettings({ FavoriteLinesCsv: '5' }, core.memoryStorage());
  const arrivals = core.normalizeSiriRows(rows, { code: 1 }, now, settings);
  assert.strictEqual(arrivals.length, 1);
  assert.strictEqual(arrivals[0].line, '5');
  assert.strictEqual(arrivals[0].minutes, 4);
  assert.strictEqual(arrivals[0].source, 'siri');
  assert.strictEqual(arrivals[0].delayMin, 2);
  assert.strictEqual(arrivals[0].flags & 1, 1);
}

function testNormalizeScheduledRows() {
  const now = new Date('2026-06-28T23:55:00+03:00');
  const arrivals = core.normalizeScheduledRows([
    {
      route_short_name: '480',
      destination_name: 'Jerusalem',
      arrival_time: '2026-06-29T00:05:00+03:00'
    }
  ], { code: 1 }, now, core.DEFAULT_SETTINGS);
  assert.strictEqual(arrivals.length, 1);
  assert.strictEqual(arrivals[0].minutes, 10);
  assert.strictEqual(arrivals[0].source, 'scheduled');
}

function testNormalizeBusGovRows() {
  const now = new Date('2026-06-28T12:00:00+03:00');
  const arrivals = core.normalizeBusGovRows([
    {
      Shilut: '83',
      DestinationQuarterName: 'Tel Aviv-Yafo Arlozorov Terminal',
      CompanyName: 'Superbus',
      MinutesToArrival: 1,
      MinutesToArrivalList: [1, 3]
    },
    {
      Shilut: '347',
      DestinationQuarterName: 'Raanana Industrial Zone',
      CompanyName: 'Metropoline',
      MinutesToArrival: 2
    }
  ], { code: 20004 }, now, { max_arrivals: 6, favorite_lines: [{ line: '83' }] });
  assert.strictEqual(arrivals.length, 3);
  assert.strictEqual(arrivals[0].line, '83');
  assert.strictEqual(arrivals[0].minutes, 1);
  assert.strictEqual(arrivals[0].source, 'live');
  assert.strictEqual(arrivals[0].freshnessSec, 0);
  assert.strictEqual(arrivals[0].flags & 1, 1);
  assert.strictEqual(arrivals[1].line, '83');
  assert.strictEqual(arrivals[1].minutes, 3);
  assert.strictEqual(arrivals[2].line, '347');
}

function testFavoriteLineOperatorMatching() {
  const now = new Date('2026-06-28T12:00:00+03:00');
  const arrivals = core.normalizeBusGovRows([
    {
      Shilut: '480',
      DestinationQuarterName: 'Jerusalem',
      CompanyName: 'Egged',
      MinutesToArrival: 4
    },
    {
      Shilut: '480',
      DestinationQuarterName: 'Jerusalem',
      CompanyName: 'Other Operator',
      MinutesToArrival: 2
    }
  ], { code: 20004 }, now, {
    max_arrivals: 6,
    favorite_lines: [{ line: '480', operator: 'Egged' }]
  });
  assert.strictEqual(arrivals.length, 2);
  assert.strictEqual(arrivals[0].operator, 'Egged');
  assert.strictEqual(arrivals[0].flags & 1, 1);
  assert.strictEqual(arrivals[1].operator, 'Other Operator');
  assert.strictEqual(arrivals[1].flags & 1, 0);
}

function testBusGovLiveFixture() {
  const now = new Date('2026-06-28T12:00:00+03:00');
  const arrivals = core.normalizeBusGovRows(
    fixture('bus_gov_live_sample.json'),
    { code: 20004 },
    now,
    { max_arrivals: 6, favorite_lines: [] }
  );
  assert.strictEqual(arrivals.length, 3);
  assert.strictEqual(arrivals[0].line, '501');
  assert.strictEqual(arrivals[0].minutes, 1);
  assert.strictEqual(arrivals[0].source, 'live');
  assert.strictEqual(arrivals[1].line, '271');
  assert.strictEqual(arrivals[1].destination, 'Tel Aviv-Yafo University');

  [
    ['bus_gov_live_stop_22947.json', 22947, '89'],
    ['bus_gov_live_stop_25702.json', 25702, '276'],
    ['bus_gov_live_stop_40679.json', 40679, '3']
  ].forEach(([name, code, firstLine]) => {
    const sample = core.normalizeBusGovRows(
      fixture(name),
      { code },
      now,
      { max_arrivals: 6, favorite_lines: [] }
    );
    assert(sample.length > 0);
    assert(sample.length <= 6);
    assert.strictEqual(sample[0].line, firstLine);
    assert.strictEqual(sample[0].source, 'live');
  });
}

function testCurlbusLiveFixture() {
  const now = new Date('2026-06-28T16:27:00+03:00');
  const arrivals = core.normalizeCurlbusRows(
    fixture('curlbus_live_sample.json'),
    { code: 20004 },
    now,
    { max_arrivals: 6, favorite_lines: [] }
  );
  assert.strictEqual(arrivals.length, 2);
  assert.strictEqual(arrivals[0].line, '47');
  assert.strictEqual(arrivals[0].minutes, 1);
  assert.strictEqual(arrivals[0].source, 'live');
  assert.strictEqual(arrivals[0].destination, 'Ra\'anana Terminal/HaPnina');
  assert.strictEqual(arrivals[1].line, '501');
}

function testNearbyStops() {
  const stops = [
    { code: 1, name: 'Near', lat: 32.0801, lon: 34.7701 },
    { code: 2, name: 'Far', lat: 32.1, lon: 34.8 },
    { code: 1, name: 'Duplicate', lat: 32.0801, lon: 34.7701 }
  ];
  const nearby = core.nearbyStops(stops, 32.08, 34.77, 400);
  assert.strictEqual(nearby.length, 1);
  assert.strictEqual(nearby[0].code, 1);
  assert(nearby[0].distanceM < 50);
}

function testPackArrivalRows() {
  const rows = [
    { line: '123456789', destination: 'A very long destination name', minutes: 3, delayMin: 1, flags: 1 }
  ];
  const dict = core.packArrivalRows(rows, { source: 'siri', updatedAgoSec: 42 }, keys, { max_arrivals: 6 });
  assert.strictEqual(dict[keys.ReqType], 1);
  assert.strictEqual(dict[keys.Source], 1);
  assert.strictEqual(dict[keys.UpdatedAgoSec], 42);
  assert.strictEqual(dict[keys.Line0], '123456789');
  assert.strictEqual(dict[keys.Dest0], 'A very long destination name');
  assert.strictEqual(dict[keys.Minutes0], 3);
  assert.strictEqual(dict[keys.Line0 + 1], undefined);

  const manyRows = Array.from({ length: 30 }, (_, i) => ({
    line: String(100 + i),
    destination: 'Terminal ' + i,
    minutes: i + 1,
    delayMin: 0,
    flags: 0
  }));
  const maxDict = core.packArrivalRows(manyRows, { source: 'siri' }, keys, { max_arrivals: 24 });
  assert.strictEqual(maxDict[keys.Line0 + 23], '123');
  assert.strictEqual(maxDict[keys.Flags0 + 23], 0);
  assert.strictEqual(maxDict[keys.Flags0 + 24], undefined);

  const smallerMaxDict = core.packArrivalRows(manyRows, { source: 'siri' }, keys, { max_arrivals: 4 });
  assert.strictEqual(smallerMaxDict[keys.Line0 + 3], '103');
  assert.strictEqual(smallerMaxDict[keys.Line0 + 4], undefined);

  const hebrewDict = core.packArrivalRows([
    { line: '4', destination: '\u05de\u05e1\u05d5\u05e3 \u05d0\u05d5\u05dd \u05d0\u05dc \u05e4\u05d7\u05dd', minutes: 5, delayMin: 0, flags: 0 }
  ], { source: 'scheduled' }, keys, { max_arrivals: 6 });
  assert(hebrewDict[keys.Dest0].indexOf('\u05de\u05e1\u05d5\u05e3') === 0);

  const noDataDict = core.packArrivalRows([], { source: 'none', status: core.STATUS_NO_DATA }, keys, { max_arrivals: 6 });
  assert.strictEqual(noDataDict[keys.Status], core.STATUS_NO_DATA);
  assert.strictEqual(noDataDict[keys.Source], 0);

  const urgentDict = core.packArrivalRows([
    { line: '5', destination: 'Central', minutes: 3, delayMin: 0, flags: 0 }
  ], { source: 'siri' }, keys, { max_arrivals: 6, vibrate_under_min: 5 });
  assert.strictEqual(urgentDict[keys.Flags0] & 8, 8);

  const disabledVibrationDict = core.packArrivalRows([
    { line: '5', destination: 'Central', minutes: 3, delayMin: 0, flags: 0 }
  ], { source: 'siri' }, keys, { max_arrivals: 6, vibrate_under_min: 0 });
  assert.strictEqual(disabledVibrationDict[keys.Flags0] & 8, 0);

  const hiddenDisplayDict = core.packArrivalRows([
    { line: '5', destination: 'Central', minutes: 3, delayMin: 0, flags: 0 }
  ], { source: 'siri' }, keys, { max_arrivals: 6, show_destination: false, show_source_badge: false });
  assert.strictEqual(hiddenDisplayDict[keys.Source], 0);
  assert.strictEqual(hiddenDisplayDict[keys.Dest0], '');

  const onlyFavoriteAlertsDict = core.packArrivalRows([
    { line: '5', destination: 'Central', minutes: 3, delayMin: 0, flags: 0 },
    { line: '83', destination: 'Terminal', minutes: 3, delayMin: 0, flags: 1 }
  ], { source: 'siri' }, keys, { max_arrivals: 6, vibrate_under_min: 5, alert_only_favorite_lines: true });
  assert.strictEqual(onlyFavoriteAlertsDict[keys.Flags0] & 8, 0);
  assert.strictEqual(onlyFavoriteAlertsDict[keys.Flags0 + 1] & 8, 8);
}

function testOperatorColorPacking() {
  assert.strictEqual(core.operatorColorIndex('Egged'), 1);
  assert.strictEqual(core.operatorColorIndex('Dan'), 2);
  assert.strictEqual(core.operatorColorIndex('Metropoline'), 3);
  assert.strictEqual(core.operatorColorIndex('Kavim'), 4);
  assert.strictEqual(core.operatorColorIndex('Superbus'), 5);
  assert.strictEqual(core.operatorColorIndex('Electra Afikim'), 6);
  assert.strictEqual(core.operatorColorIndex('Tnufa'), 7);
  assert.strictEqual(core.operatorColorIndex('Nateev Express'), 8);
  assert.strictEqual(core.operatorColorIndex('Other Operator'), 0);

  const dict = core.packArrivalRows([
    { line: '480', destination: 'Central', minutes: 2, delayMin: 0, flags: 1, operator: 'Egged' }
  ], { source: 'siri' }, keys, { max_arrivals: 6, vibrate_under_min: 0 });
  assert.strictEqual(dict[keys.Flags0] & 1, 1);
  assert.strictEqual((dict[keys.Flags0] >> 8) & 15, 1);
}

function testParseSettingsRecoversFromCorruptJson() {
  const storage = core.memoryStorage();
  storage.setItem(core.STORAGE.settings, '{broken');
  storage.setItem(core.STORAGE.favoriteStops, '[{"code":3435,"name":"Stop 3435"}]');
  const settings = core.parseSettings({ RadiusM: '750', FavoriteLinesCsv: '5, 480' }, storage);
  assert.strictEqual(settings.radius_m, 750);
  assert.strictEqual(settings.favorite_stops[0].code, 3435);
  assert.deepStrictEqual(settings.favorite_lines.map((line) => line.line), ['5', '480']);
}

function testDefaultSettingsUseTelAvivStop() {
  const settings = core.parseSettings(null, core.memoryStorage());
  assert.strictEqual(settings.nearby_city, 'Tel Aviv-Yafo');
  assert.strictEqual(settings.favorite_stops[0].code, 20004);
  assert.strictEqual(settings.favorite_stops[0].city, 'Tel Aviv-Yafo');
  assert.strictEqual(settings.favorite_stops[0].name, 'HaMasger/Yad Harutsim');
}

function testStoredFavoriteStopsStayAsConfigured() {
  const storage = core.memoryStorage();
  storage.setItem(core.STORAGE.favoriteStops, JSON.stringify([
    { code: 40679, name: 'Umm al-Fahm Terminal' },
    { code: 47748, name: 'Old nearby stop' }
  ]));
  const settings = core.parseSettings(null, storage);
  assert.strictEqual(settings.favorite_stops.length, 2);
  assert.strictEqual(settings.favorite_stops[0].code, 40679);
  assert.strictEqual(settings.favorite_stops[1].code, 47748);
}

function testApplyConfigValuesAcceptsClayRawShape() {
  const storage = core.memoryStorage();
  const settings = core.applyConfigValues({
    RadiusM: { value: '750' },
    FavoriteLinesCsv: { value: '5,480' },
    ShowDestination: { value: false },
    DefaultScreen: { value: 'nearby' },
    MaxArrivals: { value: '8' },
    VibrateUnderMin: { value: '3' },
    DarkMode: { value: true },
    AlertOnlyFavoriteLines: { value: true }
  }, storage);
  assert.strictEqual(settings.radius_m, 750);
  assert.strictEqual(settings.show_destination, false);
  assert.strictEqual(settings.default_screen, 'nearby');
  assert.strictEqual(settings.max_arrivals, 8);
  assert.strictEqual(settings.vibrate_under_min, 3);
  assert.strictEqual(settings.dark_mode, true);
  assert.strictEqual(settings.alert_only_favorite_lines, true);
  assert.deepStrictEqual(settings.favorite_lines.map((line) => line.line), ['5', '480']);
  assert.strictEqual(core.parseSettings(null, storage).radius_m, 750);
  assert.strictEqual(core.parseSettings({ MaxArrivals: 99 }, core.memoryStorage()).max_arrivals, 24);
}

function testFavoriteLinesJsonPreservesOperator() {
  const storage = core.memoryStorage();
  const settings = core.applyConfigValues({
    FavoriteLinesJson: { value: '[{"line":"480","operator":"Egged"},{"line":"5"}]' }
  }, storage);
  assert.deepStrictEqual(settings.favorite_lines, [
    { line: '480', operator: 'Egged' },
    { line: '5', operator: '' }
  ]);
  assert.deepStrictEqual(core.parseSettings(null, storage).favorite_lines, settings.favorite_lines);
}

function testForceStopIndexRefreshOnlyClearsStopIndex() {
  const storage = core.memoryStorage();
  storage.setItem(core.STORAGE.stopIndexChunkPrefix + 'tel-aviv:v1', 'cached');
  storage.setItem(core.STORAGE.stopIndexMeta, 'meta');
  storage.setItem(core.STORAGE.arrivalsPrefix + '20004:v1', 'arrivals');
  core.applyConfigValues({ ForceStopIndexRefresh: true }, storage);
  assert.strictEqual(storage.getItem(core.STORAGE.stopIndexChunkPrefix + 'tel-aviv:v1'), null);
  assert.strictEqual(storage.getItem(core.STORAGE.stopIndexMeta), null);
  assert.strictEqual(storage.getItem(core.STORAGE.arrivalsPrefix + '20004:v1'), 'arrivals');
}

function testToggleFavoriteLinePersistsAndRemoves() {
  const storage = core.memoryStorage();
  let lines = core.toggleFavoriteLine(storage, '83');
  assert.deepStrictEqual(lines.map((line) => line.line), ['83']);
  assert.deepStrictEqual(core.parseSettings(null, storage).favorite_lines.map((line) => line.line), ['83']);
  lines = core.toggleFavoriteLine(storage, '83');
  assert.deepStrictEqual(lines, []);
  assert.deepStrictEqual(core.parseSettings(null, storage).favorite_lines, []);
}

function testExplicitFavoriteStopsOverrideStoredStops() {
  const storage = core.memoryStorage();
  storage.setItem(core.STORAGE.favoriteStops, '[{"code":40679,"name":"Default"}]');
  const settings = core.parseSettings({
    FavoriteStopsJson: '[{"code":20004,"name":"HaMasger","lat":32.061291,"lon":34.784847}]'
  }, storage);
  assert.strictEqual(settings.favorite_stops.length, 1);
  assert.strictEqual(settings.favorite_stops[0].code, 20004);
  assert.strictEqual(settings.favorite_stops[0].name, 'HaMasger');
}

function testMemoryStorageKeyIteration() {
  const storage = core.memoryStorage();
  storage.setItem('a', '1');
  storage.setItem('b', '2');
  storage.setItem('a', '3');
  assert.strictEqual(storage.length, 2);
  assert.deepStrictEqual([storage.key(0), storage.key(1)].sort(), ['a', 'b']);
  storage.removeItem('a');
  assert.strictEqual(storage.length, 1);
}

function testNormalizeBusNearbyStop() {
  const stop = core.normalizeBusNearbyStop({
    id: '1:29310',
    code: '20004',
    name: '\u05d4\u05de\u05e1\u05d2\u05e8/\u05d9\u05d3 \u05d7\u05e8\u05d5\u05e6\u05d9\u05dd',
    lat: 32.061291,
    lon: 34.784847,
    dist: 0
  });
  assert.strictEqual(stop.gtfsId, '1:29310');
  assert.strictEqual(stop.code, 20004);
  assert.strictEqual(stop.distanceM, 0);
}

function testBusNearbyEnglishFixture() {
  const stops = fixture('busnearby_stops_en_sample.json').map(core.normalizeBusNearbyStop);
  const dict = core.packStops(stops, 2, keys, { show_distance: true });
  assert.strictEqual(stops[0].name, 'HaMasger/Yad Harutsim');
  assert.strictEqual(dict[keys.StopName0], 'HaMasger/Yad Harutsim');
  assert.strictEqual(dict[keys.StopCodeList0], 20004);
}

function testSparseStopArrivalsFixtureDoesNotLookLive() {
  const now = new Date('2026-06-28T12:00:00+03:00');
  const arrivals = core.normalizeScheduledRows(
    fixture('stop_arrivals_sparse_sample.json'),
    { code: 20004 },
    now,
    { max_arrivals: 6, favorite_lines: [] }
  );
  assert.strictEqual(arrivals.length, 0);
}

function testPackStopsHonorsDistanceSetting() {
  const visible = core.packStops([
    { code: 20004, name: 'HaMasger', distanceM: 123 }
  ], 2, keys, { show_distance: true });
  assert.strictEqual(visible[keys.StopDistM0], 123);

  const hidden = core.packStops([
    { code: 20004, name: 'HaMasger', distanceM: 123 }
  ], 2, keys, { show_distance: false });
  assert.strictEqual(hidden[keys.StopDistM0], 0);

  const hebrew = core.packStops([
    { code: 20004, name: '\u05d4\u05de\u05e1\u05d2\u05e8/\u05d9\u05d3 \u05d7\u05e8\u05d5\u05e6\u05d9\u05dd', distanceM: 0 }
  ], 2, keys, { show_distance: true });
  assert(hebrew[keys.StopName0].indexOf('\u05d4\u05de\u05e1\u05d2\u05e8') === 0);
}

function testPackStopsCarriesDefaultScreenSummary() {
  const favorites = core.packStops([
    { code: 20004, name: 'HaMasger' }
  ], 5, keys, { default_screen: 'favorites', refresh_sec: 15 });
  assert.strictEqual(favorites[keys.SettingsUpdated], 1);
  assert.strictEqual(favorites[keys.RefreshSec], 15);

  const nearby = core.packStops([
    { code: 20004, name: 'HaMasger' }
  ], 5, keys, { default_screen: 'nearby', refresh_sec: 60, debug: true, dark_mode: true });
  assert.strictEqual(nearby[keys.SettingsUpdated], 2);
  assert.strictEqual(nearby[keys.RefreshSec], 60);
  assert.strictEqual(nearby[keys.DebugEnabled], 1);
  assert.strictEqual(nearby[keys.DarkMode], 1);
}

function testPackDiagnostics() {
  const dict = core.packDiagnostics({
    endpoint: 'gtfs_ride_stops',
    stage: 'scheduled_fallback',
    httpStatus: 200,
    source: 'cache',
    rows: 2,
    updatedAgoSec: 123,
    fallback: true,
    errors: [{ type: 'empty', stage: 'siri_ride_stops' }]
  }, keys);
  assert.strictEqual(dict[keys.ReqType], 6);
  assert.strictEqual(dict[keys.Status], 0);
  assert.strictEqual(dict[keys.DebugLine0], 'ep gtfs_ride_stops');
  assert.strictEqual(dict[keys.DebugLine1], 'stage scheduled_fallback http 200');
  assert.strictEqual(dict[keys.DebugLine2], 'rows 2 src cache age 123s');
  assert.strictEqual(dict[keys.DebugLine3], 'fb yes err empty siri_ride_stops');
}

function testProviderBackoffErrorPolicy() {
  assert.strictEqual(core.shouldBackoffProviderError({ type: 'http', status: 401 }), true);
  assert.strictEqual(core.shouldBackoffProviderError({ type: 'http', status: 403 }), true);
  assert.strictEqual(core.shouldBackoffProviderError({ type: 'http', status: 429 }), true);
  assert.strictEqual(core.shouldBackoffProviderError({ type: 'http', status: 500 }), false);
  assert.strictEqual(core.shouldBackoffProviderError({ type: 'timeout' }), false);
}

async function testGetArrivalsForStopUsesBusGovBeforeOpenBusLookup() {
  const originalFetch = global.fetch;
  const storage = core.memoryStorage();
  const settings = core.parseSettings({ MaxArrivals: 8 }, storage);
  let busGovCalled = false;

  global.fetch = function(url) {
    const textUrl = String(url);
    if (textUrl.indexOf('curlbus.app') !== -1) {
      return Promise.resolve({
        status: 200,
        text: () => Promise.resolve(JSON.stringify({ visits: { 20004: [] } }))
      });
    }
    if (textUrl.indexOf('bus.gov.il') !== -1) {
      busGovCalled = true;
      return Promise.resolve({
        status: 200,
        text: () => Promise.resolve(JSON.stringify([
          {
            Shilut: '501',
            DestinationQuarterName: 'Ra\'anana Terminal Junction',
            CompanyName: 'Metropoline',
            MinutesToArrivalList: [1, 14]
          }
        ]))
      });
    }
    if (textUrl.indexOf('/gtfs_stops/list') !== -1) {
      return Promise.reject(new Error('OpenBus stop lookup should not block bus.gov live'));
    }
    return Promise.reject(new Error('Unexpected fetch ' + textUrl));
  };

  try {
    const result = await core.getArrivalsForStop(storage, { code: 20004, name: 'HaMasger' }, settings);
    assert.strictEqual(busGovCalled, true);
    assert.strictEqual(result.meta.source, 'live');
    assert.strictEqual(result.rows.length, 2);
    assert.strictEqual(result.rows[0].line, '501');
    assert.strictEqual(result.rows[0].minutes, 1);
  } finally {
    global.fetch = originalFetch;
  }
}

async function testGetArrivalsForStopUsesCurlbusBeforeBusGov() {
  const originalFetch = global.fetch;
  const storage = core.memoryStorage();
  const settings = core.parseSettings({ MaxArrivals: 8 }, storage);
  let busGovCalled = false;

  global.fetch = function(url) {
    const textUrl = String(url);
    if (textUrl.indexOf('curlbus.app') !== -1) {
      const soon = new Date(Date.now() + 60 * 1000).toISOString();
      const later = new Date(Date.now() + 4 * 60 * 1000).toISOString();
      return Promise.resolve({
        status: 200,
        text: () => Promise.resolve(JSON.stringify({
          visits: {
            20004: [
              {
                line_name: '47',
                eta: soon,
                timestamp: new Date().toISOString(),
                static_info: { route: { destination: { name: { EN: 'Terminal' } } } }
              },
              {
                line_name: '501',
                eta: later,
                timestamp: new Date().toISOString(),
                static_info: { route: { destination: { name: { EN: 'Raanana' } } } }
              }
            ]
          }
        }))
      });
    }
    if (textUrl.indexOf('bus.gov.il') !== -1) {
      busGovCalled = true;
      return Promise.reject(new Error('bus.gov should not be called when curlbus has rows'));
    }
    return Promise.reject(new Error('Unexpected fetch ' + textUrl));
  };

  try {
    const result = await core.getArrivalsForStop(storage, { code: 20004, name: 'HaMasger' }, settings);
    assert.strictEqual(busGovCalled, false);
    assert.strictEqual(result.meta.source, 'live');
    assert.strictEqual(result.meta.diagnostics.endpoint, 'curlbus');
    assert.strictEqual(result.rows[0].line, '47');
  } finally {
    global.fetch = originalFetch;
  }
}

async function testFetchBusNearbyStopsUsesEnglishByDefault() {
  const originalFetch = global.fetch;
  const seenUrls = [];

  global.fetch = function(url) {
    seenUrls.push(String(url));
    return Promise.resolve({
      status: 200,
      text: () => Promise.resolve(JSON.stringify([
        { id: '1:20004', code: '20004', name: 'HaMasger/Yad Harutsim', lat: 32.061291, lon: 34.784847, dist: 0 }
      ]))
    });
  };

  try {
    const stops = await core.fetchBusNearbyStops(32.061291, 34.784847, 400, { language: 'auto' });
    assert.strictEqual(stops[0].name, 'HaMasger/Yad Harutsim');
    assert(seenUrls[0].indexOf('locale=en') !== -1);
    await core.fetchBusNearbyStops(32.061291, 34.784847, 400, { language: 'he' });
    assert(seenUrls[1].indexOf('locale=he') !== -1);
  } finally {
    global.fetch = originalFetch;
  }
}

async function testGetArrivalsFallsBackToScheduledRows() {
  const originalFetch = global.fetch;
  const storage = core.memoryStorage();
  const settings = core.parseSettings({ MaxArrivals: 6 }, storage);

  global.fetch = function(url) {
    const textUrl = String(url);
    if (textUrl.indexOf('bus.gov.il') !== -1) {
      return Promise.resolve({ status: 200, text: () => Promise.resolve('[]') });
    }
    if (textUrl.indexOf('/gtfs_stops/list') !== -1) {
      return Promise.resolve({
        status: 200,
        text: () => Promise.resolve(JSON.stringify([
          { id: 123, code: 20004, name: 'HaMasger', gtfs_date: '2026-06-28' }
        ]))
      });
    }
    if (textUrl.indexOf('/siri_stops/list') !== -1) {
      return Promise.resolve({ status: 200, text: () => Promise.resolve('[]') });
    }
    if (textUrl.indexOf('/gtfs_ride_stops/list') !== -1) {
      const arrival = new Date(Date.now() + 10 * 60 * 1000).toISOString();
      return Promise.resolve({
        status: 200,
        text: () => Promise.resolve(JSON.stringify([
          {
            route_short_name: '480',
            destination_name: 'Jerusalem',
            arrival_time: arrival
          }
        ]))
      });
    }
    return Promise.reject(new Error('Unexpected fetch ' + textUrl));
  };

  try {
    const result = await core.getArrivalsForStop(storage, { code: 20004, name: 'HaMasger' }, settings);
    assert.strictEqual(result.meta.source, 'scheduled');
    assert.strictEqual(result.rows.length, 1);
    assert.strictEqual(result.rows[0].line, '480');
    assert.strictEqual(result.rows[0].destination, 'Jerusalem');
  } finally {
    global.fetch = originalFetch;
  }
}

async function testGetArrivalsFallsBackToCacheOnProviderFailure() {
  const originalFetch = global.fetch;
  const storage = core.memoryStorage();
  const settings = core.parseSettings({ MaxArrivals: 6 }, storage);
  storage.setItem(core.STORAGE.arrivalsPrefix + '20004:v1', JSON.stringify({
    savedAt: Date.now(),
    value: [
      { line: '5', destination: 'Central', minutes: 4, delayMin: 0, flags: 0, source: 'live' }
    ]
  }));

  global.fetch = function(url) {
    return Promise.reject({ type: 'network', url: String(url) });
  };

  try {
    const result = await core.getArrivalsForStop(storage, { code: 20004, name: 'HaMasger' }, settings);
    assert.strictEqual(result.meta.source, 'cache');
    assert.strictEqual(result.rows.length, 1);
    assert.strictEqual(result.rows[0].line, '5');
    assert.strictEqual(result.rows[0].source, 'cache');
  } finally {
    global.fetch = originalFetch;
  }
}

async function testProviderAuthAndRateStatusesWithoutCache() {
  const originalFetch = global.fetch;
  const settings = core.parseSettings({ MaxArrivals: 6 }, core.memoryStorage());

  async function runStatus(httpStatus, expectedStatus) {
    const storage = core.memoryStorage();
    global.fetch = function(url) {
      if (String(url).indexOf('bus.gov.il') !== -1) {
        return Promise.resolve({ status: httpStatus, text: () => Promise.resolve('provider denied') });
      }
      return Promise.reject(new Error('Should not retry non-cache fallback after provider backoff'));
    };
    const result = await core.getArrivalsForStop(storage, { code: 20004, name: 'HaMasger' }, settings);
    assert.strictEqual(result.rows.length, 0);
    assert.strictEqual(result.meta.status, expectedStatus);
    assert.strictEqual(result.meta.source, 'none');
  }

  try {
    await runStatus(403, core.STATUS_API_AUTH);
    await runStatus(429, core.STATUS_RATE_LIMIT);
  } finally {
    global.fetch = originalFetch;
  }
}

async function testProviderAuthUsesCacheWhenAvailable() {
  const originalFetch = global.fetch;
  const storage = core.memoryStorage();
  const settings = core.parseSettings({ MaxArrivals: 6 }, storage);
  storage.setItem(core.STORAGE.arrivalsPrefix + '20004:v1', JSON.stringify({
    savedAt: Date.now(),
    value: [
      { line: '83', destination: 'Terminal', minutes: 2, delayMin: 0, flags: 0, source: 'live' }
    ]
  }));

  global.fetch = function(url) {
    if (String(url).indexOf('bus.gov.il') !== -1) {
      return Promise.resolve({ status: 403, text: () => Promise.resolve('provider denied') });
    }
    return Promise.reject(new Error('Unexpected fetch ' + url));
  };

  try {
    const result = await core.getArrivalsForStop(storage, { code: 20004, name: 'HaMasger' }, settings);
    assert.strictEqual(result.meta.source, 'cache');
    assert.strictEqual(result.rows.length, 1);
    assert.strictEqual(result.rows[0].line, '83');
  } finally {
    global.fetch = originalFetch;
  }
}

async function testActiveRateBackoffStatusAndCache() {
  const storage = core.memoryStorage();
  const settings = core.parseSettings({ MaxArrivals: 6 }, storage);
  storage.setItem(core.STORAGE.rateBackoffUntil, String(Date.now() + 60000));

  let result = await core.getArrivalsForStop(storage, { code: 20004, name: 'HaMasger' }, settings);
  assert.strictEqual(result.rows.length, 0);
  assert.strictEqual(result.meta.status, core.STATUS_RATE_LIMIT);
  assert.strictEqual(result.meta.source, 'none');

  storage.setItem(core.STORAGE.arrivalsPrefix + '20004:v1', JSON.stringify({
    savedAt: Date.now(),
    value: [
      { line: '7', destination: 'Cached terminal', minutes: 6, delayMin: 0, flags: 0, source: 'live' }
    ]
  }));
  result = await core.getArrivalsForStop(storage, { code: 20004, name: 'HaMasger' }, settings);
  assert.strictEqual(result.meta.source, 'cache');
  assert.strictEqual(result.rows.length, 1);
  assert.strictEqual(result.rows[0].line, '7');
}

async function testFetchStopIndexByCityWritesMetadata() {
  const originalFetch = global.fetch;
  const storage = core.memoryStorage();

  global.fetch = function(url) {
    assert(String(url).indexOf('/gtfs_stops/list') !== -1);
    return Promise.resolve({
      status: 200,
      text: () => Promise.resolve(JSON.stringify([
        { id: 1, code: 20004, name: 'HaMasger', city: 'Tel Aviv-Yafo', lat: 32.061291, lon: 34.784847 },
        { id: 2, code: 0, name: 'Bad', city: 'Tel Aviv-Yafo', lat: 0, lon: 0 }
      ]))
    });
  };

  try {
    const stops = await core.fetchStopIndexByCity(storage, 'Tel Aviv-Yafo');
    assert.strictEqual(stops.length, 1);
    const meta = JSON.parse(storage.getItem(core.STORAGE.stopIndexMeta));
    assert.strictEqual(meta.city, 'Tel Aviv-Yafo');
    assert.strictEqual(meta.source, 'openbus_gtfs_stops');
    assert.strictEqual(meta.count, 1);
    assert(meta.savedAt > 0);
    assert(meta.expiresAt >= meta.savedAt);
  } finally {
    global.fetch = originalFetch;
  }
}

async function main() {
  testNormalizeSiriRows();
  testNormalizeScheduledRows();
  testNormalizeBusGovRows();
  testFavoriteLineOperatorMatching();
  testBusGovLiveFixture();
  testCurlbusLiveFixture();
  testNearbyStops();
  testPackArrivalRows();
  testOperatorColorPacking();
  testParseSettingsRecoversFromCorruptJson();
  testDefaultSettingsUseTelAvivStop();
  testStoredFavoriteStopsStayAsConfigured();
  testApplyConfigValuesAcceptsClayRawShape();
  testFavoriteLinesJsonPreservesOperator();
  testForceStopIndexRefreshOnlyClearsStopIndex();
  testToggleFavoriteLinePersistsAndRemoves();
  testExplicitFavoriteStopsOverrideStoredStops();
  testMemoryStorageKeyIteration();
  testNormalizeBusNearbyStop();
  testBusNearbyEnglishFixture();
  testSparseStopArrivalsFixtureDoesNotLookLive();
  testPackStopsHonorsDistanceSetting();
  testPackStopsCarriesDefaultScreenSummary();
  testPackDiagnostics();
  testProviderBackoffErrorPolicy();
  await testGetArrivalsForStopUsesCurlbusBeforeBusGov();
  await testGetArrivalsForStopUsesBusGovBeforeOpenBusLookup();
  await testFetchBusNearbyStopsUsesEnglishByDefault();
  await testGetArrivalsFallsBackToScheduledRows();
  await testGetArrivalsFallsBackToCacheOnProviderFailure();
  await testProviderAuthAndRateStatusesWithoutCache();
  await testProviderAuthUsesCacheWhenAvailable();
  await testActiveRateBackoffStatusAndCache();
  await testFetchStopIndexByCityWritesMetadata();
  console.log('core tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
