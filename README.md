# BusPebbIL

BusPebbIL is an independent Pebble watch app for Israeli bus arrivals. The
watch UI stays compact: favorite stops, nearby stops, arrival rows, automatic
refresh, route-stop navigation, and long-press favorite actions. PebbleKit JS on the paired phone owns
the realtime overlay, geolocation, settings, a daily local GTFS snapshot, normalization, and
fallback behavior.

No backend or hosted settings service is required.

## Features

- Favorite stops on launch.
- Default favorite stop is Tel Aviv-Yafo stop `20004`
  `HaMasger/Yad Harutsim`.
- Manual stop-code add from Pebble app settings.
- Watch-side manual stop-code picker for fallback lookups.
- Daily atomic phone snapshot containing favorite-station schedules and
  favorite/learned complete route patterns.
- Nearby stop search using phone GPS and BusNearby. Results are shown first,
  then their full-day schedules and complete line routes warm in the background.
- Arrival rows packed as line, destination, minutes, delay, and flags.
- Select an arrival to open its ordered route stops, focused on the originating
  station; that station stays bold while scrolling the route.
- Select any route station to open that station's arrivals. Back restores the
  same route row, and Back again restores the original station and arrival row.
- Honest source labels: `LIVE`, `SCHED`, or `CACHED`.
- Curlbus live stop-arrival predictions first. If live data is unavailable,
  scheduled rows are served from the phone snapshot before any network fallback.
- Route and stop lookups are local after first use; learned route patterns remain
  complete even when they cross city boundaries.
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
  alerts, cache clearing, and debug mode.
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
| Arrivals | Select | Open the selected line's ordered route stops. |
| Arrivals | Long Select | Toggle the selected line as a favorite line. |
| Route stops | Up / Down | Scroll through stations; the originating station remains bold. |
| Route stops | Select | Open arrivals for the selected station. |
| Route stops | Back | Return to the same selected arrival. |
| Arrivals opened from route | Back | Return to the same route station. |
| Stop code | Up / Down | Move between digits and the Open row. |
| Stop code | Select on digit | Increment that digit. |
| Stop code | Select / Long Select on Open row | Fetch arrivals for the entered stop code. |
| Arrivals | Back | Return to the screen that opened arrivals. |
| Nearby / Stop code / Debug | Back | Return to Home. |

## Data Source

The app refreshes a reduced, relevant GTFS snapshot at most once every 24 hours.
This PBW-only cache intentionally stores the data BusPebbIL uses instead of the
official nationwide archive, which is too large for PebbleKit JS localStorage.

The phone uses these direct public transit endpoints:

- Curlbus's JSON API for primary live stop-arrival predictions.
- OpenBus `/gtfs_stops/list` only for individual manual/favorite stop-code lookup.
- OpenBus `/siri_stops/list` and `/siri_ride_stops/list` as a bounded
  secondary realtime candidate path.
- OpenBus `/gtfs_ride_stops/list` during daily favorite-station refresh,
  nearby-mode warming, and when learning or refreshing a route.
- OpenBus `/gtfs_ride_stops/list` also resolves a selected Curlbus route ref
  into its ordered station sequence.
- OpenBus `/stop_arrivals/list` is intentionally not used for the main row
  display because the currently observed response can be too sparse.

Nearby stop discovery always uses BusNearby's unauthenticated
`/directions/index/stops` radius endpoint. It does not download or persist a
city-wide GTFS stop index. Once the nearby list is visible, OpenBus warms the
relevant station schedules and deduplicated complete routes asynchronously.
BusNearby stop-time and route endpoints are not used because they currently
require a protected session token.

The atomic relevant-only snapshot is stored as `gtfsCache:snapshot:v2`; a failed
daily update keeps the previous complete value. The old city-wide v1 snapshot
is not carried forward, except for individually learned stations and routes.

The app does not label scheduled fallback data as live.

## Build And Test

```sh
npm install
npm test
pebble build
```

Optional network-backed live probe (including first daily cache bootstrap and
same-day snapshot reuse):

```sh
npm run test:live
```

This verifies Curlbus live rows for known stop codes, a live route-ref-to-stop
sequence lookup, and BusNearby's Tel Aviv nearby-stop response. It is
intentionally separate from `npm test` because it depends on current public API
availability.

Optional emulator smoke matrix:

```sh
npm run test:emu
```

This installs the current PBW into the Emery emulator, injects representative
settings, arrival, route, and route-station AppMessages, verifies Back-stack
navigation, and writes screenshots to
`build/emulator-smoke/` for quick visual review.

The latest local SDK is active on this machine:

```sh
pebble --version
# Pebble Tool v5.0.39 (active SDK: v4.17)
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
