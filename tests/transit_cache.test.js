const assert = require('assert');
const cache = require('../src/pkjs/transit_cache');

function memoryStorage() {
  const values = {};
  return {
    getItem: (key) => Object.prototype.hasOwnProperty.call(values, key) ? values[key] : null,
    setItem: (key, value) => { values[key] = String(value); },
    removeItem: (key) => { delete values[key]; }
  };
}

async function testDailyRefreshIsAtomicAndRunsOnce() {
  const storage = memoryStorage();
  const now = Date.parse('2026-07-10T08:00:00+03:00');
  let scheduleLoads = 0;
  let routeLoads = 0;
  const settings = {
    favorite_stops: [{ code: 20004, name: 'HaMasger' }],
    favorite_lines: [{ line: '47', operator: '' }]
  };
  const loaders = {
    loadSchedule: async (stop) => {
      scheduleLoads += 1;
      return [{
        gtfs_stop__code: stop.code,
        gtfs_route__route_short_name: '47',
        gtfs_route__line_ref: 7700,
        gtfs_ride_id: 123,
        arrival_time: '2026-07-10T09:00:00+03:00'
      }];
    },
    loadRoute: async (candidate) => {
      routeLoads += 1;
      assert.strictEqual(candidate.routeRef, 7700);
      return {
        routeRef: 7700,
        line: '47',
        stops: [
          { code: 20004, name: 'HaMasger', city: 'Tel Aviv-Yafo' },
          { code: 23017, name: 'Israel Tal', city: 'Ramat Gan' }
        ]
      };
    }
  };

  const first = await cache.refreshDaily(storage, settings, loaders, now);
  assert.strictEqual(first.status, 'ready');
  assert.strictEqual(scheduleLoads, 1);
  assert.strictEqual(routeLoads, 1);
  assert.strictEqual(cache.findStop(storage, 20004).name, 'HaMasger');
  assert.strictEqual(cache.getSchedule(storage, 20004).length, 1);
  assert.strictEqual(cache.getRoute(storage, 7700, 23017, '47').stops.length, 2);
  assert.strictEqual(first.city, undefined);
  assert.strictEqual(first.stops, undefined);

  const second = await cache.refreshDaily(storage, settings, loaders, now + 60 * 60 * 1000);
  assert.strictEqual(second.savedAt, first.savedAt);
  assert.strictEqual(scheduleLoads, 1);
  assert.strictEqual(routeLoads, 1);
}

function testLearnedRoutesAndVisitedStopsSurviveRefresh() {
  const storage = memoryStorage();
  cache.writeSnapshot(storage, cache.createSnapshot({
    savedAt: 1,
    stations: [{ code: 20004, name: 'HaMasger' }]
  }));
  cache.rememberVisitedStop(storage, { code: 23017, name: 'Israel Tal' });
  cache.putSchedule(storage, 23017, [{ arrival_time: '2026-07-10T09:10:00+03:00' }]);
  cache.putRoute(storage, {
    routeRef: 7700,
    line: '47',
    stops: [{ code: 20004, name: 'HaMasger' }, { code: 23017, name: 'Israel Tal' }]
  });

  const route = cache.getRoute(storage, 7700, 23017, '47');
  assert.strictEqual(route.currentIndex, 1);
  assert.strictEqual(route.stops.length, 2);
  assert.strictEqual(cache.readSnapshot(storage).stations.length, 2);
}

function testFailedWriteKeepsPreviousSnapshot() {
  const backing = memoryStorage();
  cache.writeSnapshot(backing, cache.createSnapshot({
    savedAt: 10,
    stations: [{ code: 1, name: 'Old station' }]
  }));
  const failing = {
    getItem: backing.getItem,
    removeItem: backing.removeItem,
    setItem: () => { throw new Error('quota'); }
  };

  assert.throws(() => cache.writeSnapshot(failing, cache.createSnapshot({ savedAt: 20 })), /quota/);
  assert.strictEqual(cache.readSnapshot(backing).stations[0].name, 'Old station');
}

function testLegacyCitySnapshotMigratesOnlyRelevantData() {
  const storage = memoryStorage();
  storage.setItem('gtfsCache:snapshot:v1', JSON.stringify({
    version: 1,
    status: 'ready',
    savedAt: 10,
    expiresAt: 999999,
    city: 'Tel Aviv-Yafo',
    stops: [{ code: 1, name: 'City-wide stop' }],
    visited: [{ code: 20004, name: 'Learned station' }],
    schedules: { 20004: { savedAt: 10, rows: [] } },
    routes: {}
  }));

  const migrated = cache.readSnapshot(storage);
  assert.strictEqual(migrated.status, 'stale');
  assert.strictEqual(migrated.city, undefined);
  assert.strictEqual(migrated.stops, undefined);
  assert.deepStrictEqual(migrated.stations.map((stop) => stop.code), [20004]);
  assert.strictEqual(storage.getItem('gtfsCache:snapshot:v1'), null);
  assert(storage.getItem(cache.SNAPSHOT_KEY));
}

async function testFailedRefreshKeepsPreviousSnapshot() {
  const storage = memoryStorage();
  cache.writeSnapshot(storage, cache.createSnapshot({
    status: 'ready',
    savedAt: 10,
    expiresAt: 11,
    stations: [{ code: 20004, name: 'Old stop data' }]
  }));
  await assert.rejects(cache.refreshDaily(storage, {
    favorite_stops: [{ code: 20004, name: 'Old stop data' }],
    favorite_lines: []
  }, {
    loadSchedule: async () => { throw new Error('offline'); },
    loadRoute: async () => null
  }, 20), /offline/);
  const retained = cache.readSnapshot(storage);
  assert.strictEqual(retained.savedAt, 10);
  assert.strictEqual(retained.stations[0].name, 'Old stop data');
}

async function main() {
  await testDailyRefreshIsAtomicAndRunsOnce();
  testLearnedRoutesAndVisitedStopsSurviveRefresh();
  testFailedWriteKeepsPreviousSnapshot();
  testLegacyCitySnapshotMigratesOnlyRelevantData();
  await testFailedRefreshKeepsPreviousSnapshot();
  console.log('transit cache tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
