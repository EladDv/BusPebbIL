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
    firstMinutes: result.rows[0].minutes
  };
}

async function probeNearby() {
  const stops = await core.fetchBusNearbyStops(32.061291, 34.784847, 400, { language: 'auto' });
  if (!stops.length || stops[0].code !== 20004 || /[\u0590-\u05FF]/.test(stops[0].name)) {
    throw new Error(`Unexpected nearby result: ${JSON.stringify(stops.slice(0, 2))}`);
  }
  const packed = core.packStops(stops, 2, keys, { show_distance: true });
  return {
    rows: stops.length,
    firstStop: stops[0].code,
    firstName: packed[keys.StopName0]
  };
}

async function main() {
  const arrivalStops = [20004, 22947, 40679];
  const arrivals = [];
  for (const stopCode of arrivalStops) {
    arrivals.push(await probeArrivals(stopCode));
  }
  const nearby = await probeNearby();
  console.log(JSON.stringify({ arrivals, nearby }, null, 2));
}

main().catch((error) => {
  console.error(error && error.stack || error);
  process.exit(1);
});
