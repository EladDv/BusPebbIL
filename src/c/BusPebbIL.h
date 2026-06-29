#pragma once

#include <pebble.h>

#define MAX_FAVORITES 8
#define MAX_STOP_ITEMS 12
#define MAX_ARRIVAL_ITEMS 24
#define STOP_CODE_DIGITS 5

#define REQ_ARRIVALS 1
#define REQ_NEARBY 2
#define REQ_FAVORITE_STOP 3
#define REQ_FAVORITE_LINE 4
#define REQ_SYNC_SETTINGS 5
#define REQ_DEBUG 6

#define STATUS_OK 0
#define STATUS_NO_PHONE 30
#define STATUS_DATA_ERROR 31
#define STATUS_NO_DATA 32
#define STATUS_API_AUTH 33
#define STATUS_RATE_LIMIT 34

#define PERSIST_LAST_STOP_CODE 1
#define PERSIST_CACHE_STOP_CODE 20
#define PERSIST_CACHE_STOP_NAME 21
#define PERSIST_CACHE_COUNT 22
#define PERSIST_CACHE_SOURCE 23
#define PERSIST_CACHE_UPDATED_AT 24
#define PERSIST_CACHE_LINE_BASE 100
#define PERSIST_CACHE_DEST_BASE 130
#define PERSIST_CACHE_MIN_BASE 160
#define PERSIST_CACHE_DELAY_BASE 190
#define PERSIST_CACHE_FLAGS_BASE 220
#define PERSIST_FAV_COUNT 300
#define PERSIST_FAV_CODE_BASE 310
#define PERSIST_FAV_DIST_BASE 320
#define PERSIST_FAV_NAME_BASE 330
#define PERSIST_DARK_MODE 400
#define PERSIST_TUTORIAL_SEEN 402

#define CACHE_MAX_AGE_SEC 1800
#define LOADING_TIMEOUT_MS 7000
#define ARRIVAL_FLAG_URGENT 8
#define ARRIVAL_OPERATOR_COLOR_SHIFT 8
#define ARRIVAL_OPERATOR_COLOR_MASK (15 << ARRIVAL_OPERATOR_COLOR_SHIFT)

#define HEADER_TITLE_X 10
#define HEADER_CODE_W 44
#define HEADER_CODE_RIGHT_PAD 5
#define HEADER_TITLE_CODE_GAP 3
#define HOME_TITLE_X 35
#define HOME_TITLE_RIGHT_PAD 4
#define HOME_TITLE_H 24
#define NAV_TITLE_W_RIGHT_PAD 78

#define MARQUEE_START_DELAY_MS 1000
#define MARQUEE_STEP_MS 650
#define MARQUEE_END_PAUSE_MS 500
#define MARQUEE_EXTRA_CHARS 1
#define MARQUEE_TRAILING_SPACES 2
#define MARQUEE_EDGE_PAD_CHARS 1

#define ARRIVAL_CHIP_X 13
#define ARRIVAL_CHIP_TEXT_X 15
#define ARRIVAL_DEST_X 58
#define ARRIVAL_TIME_W 33
#define ARRIVAL_DEST_TIME_GAP 2
#define ARRIVAL_DEST_RIGHT_PAD (ARRIVAL_TIME_W + ARRIVAL_DEST_TIME_GAP + 5)

#define SETTINGS_DEFAULT_FAVORITES 1
#define SETTINGS_DEFAULT_NEARBY 2

#define HEADER_H 28
#define ROW_HOME_H 50
#define ROW_ARRIVAL_H 50
#define ROW_COMPACT_H 46
#define TUTORIAL_PAGE_COUNT 6

typedef enum {
  NoticeInfo,
  NoticeLoading,
  NoticeLive,
  NoticeScheduled,
  NoticeWarning,
  NoticeError
} NoticeKind;

typedef enum {
  ScreenHome,
  ScreenNearby,
  ScreenArrivals,
  ScreenStopCode,
  ScreenTutorial,
  ScreenDebug
} AppScreen;

typedef struct {
  char name[64];
  int32_t code;
  int32_t distance_m;
} StopRow;

typedef struct {
  char line[64];
  char dest[64];
  int32_t minutes;
  int32_t delay_min;
  int32_t flags;
} ArrivalRow;
