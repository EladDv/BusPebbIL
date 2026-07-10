const core = require('../src/pkjs/buspebble_core');

const keys = {
  ReqType: 0,
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
  Flags0: 141
};

async function probeArrivals(stopCode) {
  const storage = core.memoryStorage();
  const settings = core.parseSettings({ MaxArrivals: 8 }, storage);
  const result = await core.getArrivalsForStop(storage, { code: stopCode, name: `Stop ${stopCode}` }, settings);
  const packet = core.packArrivalRows(result.rows, result.meta, keys, settings);
  if (result.meta.source !== 'live' || packet[keys.Source] !== 1 || !result.rows.length) {
    throw new Error(`Stop ${stopCode} did not return live rows: ${JSON.stringify(result.meta)}`);
  }
  return {
    stopCode,
    rows: result.rows.length,
    source: result.meta.source,
    firstLine: result.rows[0].line,
    firstMinutes: result.rows[0].minutes,
    firstRouteRef: result.rows[0].routeRef
  };
}

async function probeRoute(stopCode, routeRef, line) {
  const result = await core.getRouteStops(routeRef, stopCode, null, line);
  if (!result.stops.length || result.currentIndex < 0 || result.stops[result.currentIndex].code !== stopCode) {
    throw new Error(`Route ${routeRef} did not focus stop ${stopCode}: ${JSON.stringify(result)}`);
  }
  return {
    routeRef,
    stops: result.stops.length,
    currentIndex: result.currentIndex,
    currentName: result.stops[result.currentIndex].name
  };
}

async function probeNearby() {
  const storage = core.memoryStorage();
  const stops = await core.fetchBusNearbyStops(32.061291, 34.784847, 400, { language: 'auto' });
  if (!stops.length || stops[0].code !== 20004 || /[\u0590-\u05FF]/.test(stops[0].name)) {
    throw new Error(`Unexpected nearby result: ${JSON.stringify(stops.slice(0, 2))}`);
  }
  const packed = core.packStops(stops, 2, keys, { show_distance: true });
  const cache = await core.warmNearbyTransitCache(storage, stops.slice(0, 1), { favorite_lines: [] }, Date.now());
  if (cache.stationCount < 1 || cache.scheduleCount < 1 || cache.routeCount < 1) {
    throw new Error(`Nearby GTFS warm failed: ${JSON.stringify(cache)}`);
  }
  return {
    rows: stops.length,
    firstStop: stops[0].code,
    firstName: packed[keys.StopName0],
    cache
  };
}

async function probeDailyCache() {
  const storage = core.memoryStorage();
  const settings = core.parseSettings({
    FavoriteStopsJson: JSON.stringify([{ code: 20004, name: 'Ibn Gabirol/Arlozorov' }])
  }, storage);
  const first = await core.refreshDailyTransitCache(storage, settings, Date.now());
  const second = await core.refreshDailyTransitCache(storage, settings, Date.now() + 60 * 60 * 1000);
  const status = core.getTransitCacheStatus(storage);
  if (first.savedAt !== second.savedAt || status.status !== 'ready' ||
      status.stopCount < 1 || status.scheduleCount < 1) {
    throw new Error(`Daily cache was not populated and reused: ${JSON.stringify(status)}`);
  }
  return status;
}

async function main() {
  const cache = await probeDailyCache();
  const arrivalStops = [20004, 22947, 40679];
  const arrivals = [];
  for (const stopCode of arrivalStops) {
    arrivals.push(await probeArrivals(stopCode));
  }
  const route = await probeRoute(arrivals[0].stopCode, arrivals[0].firstRouteRef, arrivals[0].firstLine);
  const nearby = await probeNearby();
  console.log(JSON.stringify({ cache, arrivals, route, nearby }, null, 2));
}

main().catch((error) => {
  console.error(error && error.stack || error);
  process.exit(1);
});
