# BusPebbIL

BusPebbIL is an independent Pebble watch app for Israeli bus arrivals. The
watch UI stays compact: favorite stops, nearby stops, arrival rows, manual
refresh, and long-press favorite actions. PebbleKit JS on the paired phone owns
live API calls, geolocation, settings, localStorage caches, normalization, and
fallback behavior.

No backend or hosted settings service is required.

## Features

- Favorite stops on launch.
- Default favorite stop is Tel Aviv-Yafo stop `20004`
  `HaMasger/Yad Harutsim`.
- Manual stop-code add from Pebble app settings.
- Watch-side manual stop-code picker for fallback lookups.
- Nearby stop search using phone GPS, a city stop-index cache, bounding-box
  filtering, and Haversine sorting.
- Stop-index metadata cache recording city coverage, source, count, and expiry.
- Arrival rows packed as line, destination, minutes, delay, and flags.
- Honest source labels: `LIVE`, `SCHED`, or `CACHED`.
- `bus.gov.il` live stop-arrival predictions first, with scheduled/cache
  fallback when live rows are empty or unavailable.
- Last-good arrival cache for network failure.
- Short provider backoff for auth/rate-limit responses (`401`, `403`, `429`)
  so refreshes use cache instead of retrying immediately, with distinct
  no-cache watch labels for API auth and rate-limit failures.
- Watch-side last-arrivals cache for phone-disconnected refresh failures.
- Watch-side favorite-stop cache for fast launch and no-phone startup; settings
  sync no longer hides cached favorites.
- A 12-second watch-side request timeout, with cached-arrival fallback where
  possible.
- Clay settings for radius, refresh interval, language, default screen, max
  arrivals, manual stop-code add, favorite stop JSON, favorite line CSV,
  operator-capable favorite line JSON, display toggles, favorite-line-only
  alerts, cache clearing, stop-index refresh, and debug mode.
- Long-select on nearby stops to favorite them.
- Long-select on arrival rows to toggle favorite lines.
- Favorite-line JSON can include an optional operator, for example
  `[{"line":"480","operator":"Egged"}]`; operator-qualified favorites only
  match rows from that operator.

## Watch Button Interactions

| Screen | Button | Action |
|---|---|---|
| First-run tutorial | Up / Down | Move between tutorial pages. |
| First-run tutorial | Select | Advance; on the last page, start the app. |
| First-run tutorial | Long Select / Back | Dismiss the tutorial. |
| Home | Up / Down | Move between favorite stops, Nearby, and Stop code. |
| Home | Select | Open the selected favorite stop, Nearby, or Stop code. |
| Home | Long Select on favorite stop | Remove that stop from favorites. |
| Nearby | Up / Down | Move between nearby stops. |
| Nearby | Select | Open arrivals for the selected stop. |
| Nearby | Long Select | Save the selected stop as a favorite. |
| Arrivals | Up / Down | Move between arrival rows. |
| Arrivals | Select | Refresh the current stop. |
| Arrivals | Long Select | Toggle the selected line as a favorite line. |
| Stop code | Up / Down | Move between digits and the Open row. |
| Stop code | Select on digit | Increment that digit. |
| Stop code | Select / Long Select on Open row | Fetch arrivals for the entered stop code. |
| Arrivals | Back | Return to the screen that opened arrivals. |
| Nearby / Stop code / Debug | Back | Return to Home. |

## Data Source

The app uses direct public transit endpoints from PebbleKit JS:

- `bus.gov.il` `GetRealtimeBusLineListByBustop` for primary live stop-arrival
  predictions. This endpoint returned live Tel Aviv rows for stop `20004`.
- OpenBus `/gtfs_stops/list` for stop lookup and stop-index chunks.
- OpenBus `/siri_stops/list` and `/siri_ride_stops/list` as a bounded
  secondary realtime candidate path.
- OpenBus `/gtfs_ride_stops/list` as scheduled fallback with line and
  destination data.
- OpenBus `/stop_arrivals/list` is intentionally not used for the main row
  display because the currently observed response can be too sparse.

For nearby stop discovery, the app first tries BusNearby's unauthenticated
`/directions/index/stops` radius endpoint and falls back to the OpenBus city
stop-index cache if that request fails. BusNearby stop-time and route endpoints
are not used because they currently require a protected session token.

When the OpenBus city stop-index fallback is refreshed, the app writes
`stopindex:meta:v1` with the city, source, row count, saved time, and expiry.

The app does not label scheduled fallback data as live.

## Build And Test

```sh
npm install
npm test
pebble build
```

Optional network-backed live probe:

```sh
npm run test:live
```

This verifies bus.gov live rows for known stop codes and BusNearby's Tel Aviv
nearby-stop response. It is intentionally separate from `npm test` because it
depends on current public API availability.

Optional emulator smoke matrix:

```sh
npm run test:emu
```

This installs the current PBW into the Emery emulator, injects representative
settings/arrival/error AppMessages, and writes screenshots to
`build/emulator-smoke/` for quick visual review.

The latest local SDK is active on this machine:

```sh
pebble --version
# Pebble Tool v5.0.38 (active SDK: v4.17)
```

The build artifact is:

```sh
build/BusPebbIL.pbw
```

## Install

```sh
pebble install --emulator emery
pebble install --phone <ip>
```

## Target Platforms

The package target list supports `basalt`, `chalk`, `diorite`, `emery`, and
`obelix`.

`flint` and `gabbro` are not enabled while the app depends on Clay because the
Pebble build rejects that dependency for those platforms.

## Project Layout

```text
src/c/BusPebbIL.c          Watch screen flow, menu handlers, AppMessage handling
src/c/BusPebbIL.h          Shared watch app constants and row models
src/c/ui_screens.*         Menu rendering, row layout, tutorial, and marquee state
src/c/ui_colors.*          Watch palette and dark-mode color mapping
src/c/ui_text.*            UTF-8, RTL, fit, and marquee text helpers
src/pkjs/index.js          PebbleKit JS event wiring and Clay bridge
src/pkjs/buspebble_core.js OpenBus provider, cache, settings, normalize, pack
src/pkjs/config.js         Clay settings schema
tests/core.test.js         Normalization, nearby, packing, settings tests
tests/live_probe.js        Optional network-backed live provider probe
tests/emulator_smoke.py    Optional emulator screenshot smoke matrix
package.json               Pebble metadata and message-key contract
wscript                    Pebble build rules
```

## License

Apache License 2.0. See [LICENSE](LICENSE).
