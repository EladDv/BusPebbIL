# Changelog

## 1.4.0 - 2026-07-15

### Fixed

- Made route lookup bounded and route-reference-first so route navigation completes before the watch timeout.
- Prevented ambiguous line-number fallbacks from selecting an unrelated operator's route.
- Fixed stale cached routes overwriting newly refreshed route data.
- Preserved distinct route patterns while retiring obsolete cached patterns.
- Kept incomplete route refreshes retryable instead of treating them as fresh for 24 hours.
- Added regression coverage for Dan line 60 from Tel Aviv and route-cache refresh behavior.
