#include <pebble.h>
#include <string.h>

#include "BusPebbIL.h"
#include "ui_colors.h"
#include "ui_screens.h"
#include "ui_text.h"

static Window *s_window;
static MenuLayer *s_menu_layer;
static AppTimer *s_refresh_timer;
static AppTimer *s_loading_timer;

static AppScreen s_screen = ScreenHome;
static StopRow s_favorite_stops[MAX_FAVORITES];
static StopRow s_nearby_stops[MAX_STOP_ITEMS];
static ArrivalRow s_arrivals[MAX_ARRIVAL_ITEMS];
static char s_debug_lines[4][64];
static uint8_t s_manual_digits[STOP_CODE_DIGITS];
static uint8_t s_favorite_count;
static uint8_t s_nearby_count;
static uint8_t s_arrival_count;
static uint8_t s_debug_count;
static int32_t s_selected_stop_code;
static char s_selected_stop_name[64];
static uint8_t s_source;
static int32_t s_updated_ago_sec;
static int32_t s_refresh_sec = 30;
static AppScreen s_arrivals_back_screen = ScreenHome;
static MenuIndex s_arrivals_back_index = { .section = 0, .row = 0 };
static char s_notice[64] = "Starting...";
static NoticeKind s_notice_kind = NoticeInfo;
static uint8_t s_tutorial_page;
static bool s_debug_enabled;
static bool s_loading;
static bool s_settings_syncing;
static bool s_apply_default_screen_on_settings;
static bool s_dark_mode;
static bool s_show_tutorial;

static BusPebbILUiState s_ui = {
  .menu_layer = &s_menu_layer,
  .screen = &s_screen,
  .favorite_stops = s_favorite_stops,
  .nearby_stops = s_nearby_stops,
  .arrivals = s_arrivals,
  .debug_lines = s_debug_lines,
  .manual_digits = s_manual_digits,
  .favorite_count = &s_favorite_count,
  .nearby_count = &s_nearby_count,
  .arrival_count = &s_arrival_count,
  .debug_count = &s_debug_count,
  .selected_stop_code = &s_selected_stop_code,
  .selected_stop_name = s_selected_stop_name,
  .source = &s_source,
  .notice = s_notice,
  .notice_kind = &s_notice_kind,
  .tutorial_page = &s_tutorial_page,
  .loading = &s_loading,
  .debug_enabled = &s_debug_enabled
};

static void request_arrivals(int32_t stop_code, const char *stop_name);
static void request_settings(void);
static void request_stop_code(void);
static void request_debug(void);
static void update_screen_notice(void);
static void start_loading_timer(void);
static void cancel_loading_timer(void);
static void set_default_favorites(void);
static void apply_menu_layer_theme(void);
static void dismiss_tutorial(void);

static void apply_menu_layer_theme(void) {
  if (!s_menu_layer) return;
  menu_layer_set_normal_colors(s_menu_layer, ui_color_paper(), ui_color_ink());
  menu_layer_set_highlight_colors(s_menu_layer, ui_color_ink(), ui_color_paper());
}

static const char *source_label(uint8_t source) {
  switch(source) {
    case 1: return "LIVE";
    case 2: return "SCHED";
    case 3: return "SCHED";
    default: return "DATA";
  }
}

static void set_notice(const char *text, NoticeKind kind) {
  snprintf(s_notice, sizeof(s_notice), "%s", text ? text : "");
  s_notice_kind = kind;
  if (s_menu_layer && !s_loading) {
    menu_layer_reload_data(s_menu_layer);
  }
}

static void set_status(const char *text) {
  set_notice(text, NoticeInfo);
}

static void set_status_colored(const char *text, GColor bg, GColor fg) {
  (void)bg;
  (void)fg;
  NoticeKind kind = NoticeInfo;
  if (text && (strstr(text, "error") || strstr(text, "disconnected") ||
      strstr(text, "timeout") || strstr(text, "dropped") ||
      strstr(text, "Rate") || strstr(text, "auth"))) {
    kind = NoticeError;
  } else if (text && strstr(text, "No ")) {
    kind = NoticeWarning;
  }
  set_notice(text, kind);
}

static void set_loading(const char *text) {
  s_loading = true;
  set_notice(text, NoticeLoading);
  start_loading_timer();
  if (s_menu_layer) {
    menu_layer_reload_data(s_menu_layer);
  }
}

static void cancel_refresh_timer(void) {
  if (s_refresh_timer) {
    app_timer_cancel(s_refresh_timer);
    s_refresh_timer = NULL;
  }
}

static void refresh_timer_callback(void *data) {
  s_refresh_timer = NULL;
  if (s_screen == ScreenArrivals && !s_loading && s_selected_stop_code) {
    request_arrivals(s_selected_stop_code, s_selected_stop_name);
  }
}

static void schedule_refresh_timer(void) {
  cancel_refresh_timer();
  if (s_screen == ScreenArrivals && s_arrival_count && s_refresh_sec > 0) {
    s_refresh_timer = app_timer_register((uint32_t)s_refresh_sec * 1000, refresh_timer_callback, NULL);
  }
}

static void clear_loading(void) {
  cancel_loading_timer();
  s_loading = false;
  if (s_menu_layer) {
    menu_layer_reload_data(s_menu_layer);
  }
}

static void copy_tuple_string(DictionaryIterator *iter, uint32_t key, char *dest, size_t dest_size) {
  Tuple *tuple = dict_find(iter, key);
  if (!tuple || dest_size == 0) {
    if (dest_size) dest[0] = '\0';
    return;
  }
  snprintf(dest, dest_size, "%s", tuple->value->cstring);
}

static int32_t tuple_int(DictionaryIterator *iter, uint32_t key, int32_t fallback) {
  Tuple *tuple = dict_find(iter, key);
  if (!tuple) return fallback;
  return tuple->value->int32;
}

static void set_manual_digits_from_code(int32_t code) {
  if (code <= 0) code = 20004;
  for (int i = STOP_CODE_DIGITS - 1; i >= 0; i -= 1) {
    s_manual_digits[i] = code % 10;
    code /= 10;
  }
}

static int32_t manual_stop_code(void) {
  int32_t code = 0;
  for (uint8_t i = 0; i < STOP_CODE_DIGITS; i += 1) {
    code = code * 10 + s_manual_digits[i];
  }
  return code;
}

static void set_selected_stop_name(int32_t stop_code, const char *stop_name) {
  if (stop_name && stop_name[0]) {
    if (stop_name != s_selected_stop_name) {
      snprintf(s_selected_stop_name, sizeof(s_selected_stop_name), "%s", stop_name);
    }
  } else {
    snprintf(s_selected_stop_name, sizeof(s_selected_stop_name), "Stop %ld", (long)stop_code);
  }
  ui_screens_reset_marquee();
}

static bool load_cached_arrivals(int32_t stop_code, const char *stop_name) {
  if (!persist_exists(PERSIST_CACHE_COUNT) || !persist_exists(PERSIST_CACHE_STOP_CODE)) {
    return false;
  }
  int32_t cached_stop_code = persist_read_int(PERSIST_CACHE_STOP_CODE);
  if (stop_code && cached_stop_code != stop_code) {
    return false;
  }
  int32_t cached_at = persist_exists(PERSIST_CACHE_UPDATED_AT) ? persist_read_int(PERSIST_CACHE_UPDATED_AT) : 0;
  int32_t age_sec = cached_at ? (int32_t)(time(NULL) - cached_at) : 0;
  if (age_sec < 0) age_sec = 0;
  if (age_sec > CACHE_MAX_AGE_SEC) {
    return false;
  }

  s_selected_stop_code = cached_stop_code;
  if (stop_name && stop_name[0]) {
    set_selected_stop_name(cached_stop_code, stop_name);
  } else {
    s_selected_stop_name[0] = '\0';
    persist_read_string(PERSIST_CACHE_STOP_NAME, s_selected_stop_name, sizeof(s_selected_stop_name));
    if (!s_selected_stop_name[0]) snprintf(s_selected_stop_name, sizeof(s_selected_stop_name), "Stop %ld", (long)cached_stop_code);
    ui_screens_reset_marquee();
  }
  s_arrival_count = 0;
  int32_t count = persist_read_int(PERSIST_CACHE_COUNT);
  int32_t elapsed_min = age_sec / 60;
  for (int32_t i = 0; i < count && i < MAX_ARRIVAL_ITEMS; i += 1) {
    persist_read_string(PERSIST_CACHE_LINE_BASE + i, s_arrivals[s_arrival_count].line, sizeof(s_arrivals[s_arrival_count].line));
    persist_read_string(PERSIST_CACHE_DEST_BASE + i, s_arrivals[s_arrival_count].dest, sizeof(s_arrivals[s_arrival_count].dest));
    int32_t minutes = persist_read_int(PERSIST_CACHE_MIN_BASE + i) - elapsed_min;
    s_arrivals[s_arrival_count].minutes = minutes > 0 ? minutes : 0;
    s_arrivals[s_arrival_count].delay_min = persist_read_int(PERSIST_CACHE_DELAY_BASE + i);
    s_arrivals[s_arrival_count].flags = persist_read_int(PERSIST_CACHE_FLAGS_BASE + i);
    s_arrival_count += 1;
  }
  if (!s_arrival_count) {
    return false;
  }
  s_screen = ScreenArrivals;
  ui_screens_restart_marquee(&s_ui);
  s_source = 3;
  s_updated_ago_sec = age_sec;
  s_loading = false;
  if (s_menu_layer) menu_layer_reload_data(s_menu_layer);
  update_screen_notice();
  return true;
}

static void cancel_loading_timer(void) {
  if (s_loading_timer) {
    app_timer_cancel(s_loading_timer);
    s_loading_timer = NULL;
  }
}

static void loading_timeout_callback(void *data) {
  s_loading_timer = NULL;
  if (!s_loading && !s_settings_syncing) return;
  if (s_settings_syncing) {
    s_settings_syncing = false;
    s_loading = false;
    set_status_colored("Phone disconnected", ui_color_red(), GColorWhite);
    if (s_menu_layer) {
      menu_layer_reload_data(s_menu_layer);
    }
    return;
  }
  s_loading = false;
  if (s_screen == ScreenArrivals && load_cached_arrivals(s_selected_stop_code, s_selected_stop_name)) {
    return;
  }
  set_status_colored("Request timeout", ui_color_red(), GColorWhite);
  if (s_menu_layer) {
    menu_layer_reload_data(s_menu_layer);
  }
}

static void start_loading_timer(void) {
  cancel_loading_timer();
  s_loading_timer = app_timer_register(LOADING_TIMEOUT_MS, loading_timeout_callback, NULL);
}

static void persist_arrivals_cache(void) {
  if (!s_arrival_count || !s_selected_stop_code) return;
  persist_write_int(PERSIST_CACHE_STOP_CODE, s_selected_stop_code);
  persist_write_string(PERSIST_CACHE_STOP_NAME, s_selected_stop_name);
  persist_write_int(PERSIST_CACHE_COUNT, s_arrival_count);
  persist_write_int(PERSIST_CACHE_SOURCE, s_source);
  persist_write_int(PERSIST_CACHE_UPDATED_AT, (int32_t)time(NULL));
  for (uint8_t i = 0; i < s_arrival_count && i < MAX_ARRIVAL_ITEMS; i += 1) {
    persist_write_string(PERSIST_CACHE_LINE_BASE + i, s_arrivals[i].line);
    persist_write_string(PERSIST_CACHE_DEST_BASE + i, s_arrivals[i].dest);
    persist_write_int(PERSIST_CACHE_MIN_BASE + i, s_arrivals[i].minutes);
    persist_write_int(PERSIST_CACHE_DELAY_BASE + i, s_arrivals[i].delay_min);
    persist_write_int(PERSIST_CACHE_FLAGS_BASE + i, s_arrivals[i].flags);
  }
}

static void persist_favorite_stops(void) {
  persist_write_int(PERSIST_FAV_COUNT, s_favorite_count);
  for (uint8_t i = 0; i < s_favorite_count && i < MAX_FAVORITES; i += 1) {
    persist_write_int(PERSIST_FAV_CODE_BASE + i, s_favorite_stops[i].code);
    persist_write_int(PERSIST_FAV_DIST_BASE + i, s_favorite_stops[i].distance_m);
    persist_write_string(PERSIST_FAV_NAME_BASE + i, s_favorite_stops[i].name);
  }
}

static void set_selected_name_from_favorites(void) {
  for (uint8_t i = 0; i < s_favorite_count; i += 1) {
    if (s_favorite_stops[i].code == s_selected_stop_code) {
      snprintf(s_selected_stop_name, sizeof(s_selected_stop_name), "%s", s_favorite_stops[i].name);
      return;
    }
  }
  if (s_favorite_count) {
    snprintf(s_selected_stop_name, sizeof(s_selected_stop_name), "%s", s_favorite_stops[0].name);
  } else {
    snprintf(s_selected_stop_name, sizeof(s_selected_stop_name), "Stop %ld", (long)s_selected_stop_code);
  }
}

static bool load_persisted_favorites(void) {
  if (!persist_exists(PERSIST_FAV_COUNT)) return false;
  int32_t count = persist_read_int(PERSIST_FAV_COUNT);
  if (count <= 0) return false;

  s_favorite_count = 0;
  for (int32_t i = 0; i < count && i < MAX_FAVORITES; i += 1) {
    if (!persist_exists(PERSIST_FAV_CODE_BASE + i)) continue;
    s_favorite_stops[s_favorite_count].code = persist_read_int(PERSIST_FAV_CODE_BASE + i);
    s_favorite_stops[s_favorite_count].distance_m = persist_exists(PERSIST_FAV_DIST_BASE + i) ? persist_read_int(PERSIST_FAV_DIST_BASE + i) : 0;
    persist_read_string(PERSIST_FAV_NAME_BASE + i, s_favorite_stops[s_favorite_count].name, sizeof(s_favorite_stops[s_favorite_count].name));
    if (!s_favorite_stops[s_favorite_count].name[0]) {
      snprintf(s_favorite_stops[s_favorite_count].name, sizeof(s_favorite_stops[s_favorite_count].name), "Stop %ld", (long)s_favorite_stops[s_favorite_count].code);
    }
    if (s_favorite_stops[s_favorite_count].code) {
      s_favorite_count += 1;
    }
  }

  if (!s_favorite_count) return false;
  s_selected_stop_code = persist_exists(PERSIST_LAST_STOP_CODE) ? persist_read_int(PERSIST_LAST_STOP_CODE) : s_favorite_stops[0].code;
  set_selected_name_from_favorites();
  return true;
}

static void select_first_favorite_if_current_missing(void) {
  if (!s_favorite_count) return;
  for (uint8_t i = 0; i < s_favorite_count; i += 1) {
    if (s_favorite_stops[i].code == s_selected_stop_code) {
      snprintf(s_selected_stop_name, sizeof(s_selected_stop_name), "%s", s_favorite_stops[i].name);
      return;
    }
  }
  s_selected_stop_code = s_favorite_stops[0].code;
  snprintf(s_selected_stop_name, sizeof(s_selected_stop_name), "%s", s_favorite_stops[0].name);
  persist_write_int(PERSIST_LAST_STOP_CODE, s_selected_stop_code);
}

static bool send_request(int req_type, int32_t stop_code, const char *line, int favorite_action) {
  DictionaryIterator *iter;
  AppMessageResult result = app_message_outbox_begin(&iter);
  if (result != APP_MSG_OK || !iter) {
    set_status_colored("Phone disconnected", ui_color_red(), GColorWhite);
    return false;
  }

  dict_write_int(iter, MESSAGE_KEY_ReqType, &req_type, sizeof(int), true);
  if (stop_code) {
    dict_write_int32(iter, MESSAGE_KEY_StopCode, stop_code);
  }
  if (favorite_action) {
    dict_write_int(iter, MESSAGE_KEY_FavoriteAction, &favorite_action, sizeof(int), true);
  }
  if (line && line[0]) {
    dict_write_cstring(iter, MESSAGE_KEY_Line0, line);
  }

  result = app_message_outbox_send();
  if (result != APP_MSG_OK) {
    set_status_colored("Phone disconnected", ui_color_red(), GColorWhite);
    return false;
  }
  return true;
}

static void request_settings(void) {
  cancel_refresh_timer();
  s_apply_default_screen_on_settings = s_screen == ScreenHome;
  if (s_screen == ScreenHome && s_favorite_count) {
    s_settings_syncing = true;
    s_loading = false;
    set_status("Syncing settings...");
    start_loading_timer();
    if (s_menu_layer) {
      menu_layer_reload_data(s_menu_layer);
    }
  } else {
    set_loading("Syncing settings...");
  }
  if (!send_request(REQ_SYNC_SETTINGS, 0, NULL, 0)) {
    s_settings_syncing = false;
  }
}

static void request_arrivals(int32_t stop_code, const char *stop_name) {
  cancel_refresh_timer();
  cancel_loading_timer();
  s_settings_syncing = false;
  s_apply_default_screen_on_settings = false;
  if (s_screen != ScreenArrivals) {
    s_arrivals_back_screen = s_screen;
    s_arrivals_back_index = s_menu_layer ? menu_layer_get_selected_index(s_menu_layer) : (MenuIndex) { .section = 0, .row = 0 };
  }
  s_selected_stop_code = stop_code;
  persist_write_int(PERSIST_LAST_STOP_CODE, stop_code);
  set_selected_stop_name(stop_code, stop_name);
  s_screen = ScreenArrivals;
  ui_screens_restart_marquee(&s_ui);
  bool showing_cached_rows = load_cached_arrivals(stop_code, s_selected_stop_name);
  if (showing_cached_rows) {
    set_notice("Updating...", NoticeInfo);
  } else {
    s_arrival_count = 0;
    set_loading("Checking");
  }
  if (!send_request(REQ_ARRIVALS, stop_code, NULL, 0)) {
    if (!showing_cached_rows && !load_cached_arrivals(stop_code, stop_name)) {
      set_status("Phone disconnected");
    }
  }
}

static void request_nearby(void) {
  cancel_refresh_timer();
  cancel_loading_timer();
  s_settings_syncing = false;
  s_apply_default_screen_on_settings = false;
  s_screen = ScreenNearby;
  ui_screens_restart_marquee(&s_ui);
  s_nearby_count = 0;
  set_loading("Checking GPS");
  send_request(REQ_NEARBY, 0, NULL, 0);
}

static void request_stop_code(void) {
  cancel_refresh_timer();
  cancel_loading_timer();
  s_settings_syncing = false;
  s_apply_default_screen_on_settings = false;
  set_manual_digits_from_code(s_selected_stop_code);
  s_screen = ScreenStopCode;
  ui_screens_restart_marquee(&s_ui);
  s_loading = false;
  set_status("Select edits, Open row");
  if (s_menu_layer) {
    menu_layer_reload_data(s_menu_layer);
  }
}

static void request_debug(void) {
  cancel_refresh_timer();
  s_screen = ScreenDebug;
  ui_screens_restart_marquee(&s_ui);
  s_debug_count = 0;
  set_loading("Checking");
  send_request(REQ_DEBUG, 0, NULL, 0);
}

static void set_default_favorites(void) {
  s_favorite_count = 1;
  snprintf(s_favorite_stops[0].name, sizeof(s_favorite_stops[0].name), "HaMasger/Yad Harutsim");
  s_favorite_stops[0].code = 20004;
  s_favorite_stops[0].distance_m = 0;
  s_selected_stop_code = persist_exists(PERSIST_LAST_STOP_CODE) ? persist_read_int(PERSIST_LAST_STOP_CODE) : 20004;
  snprintf(s_selected_stop_name, sizeof(s_selected_stop_name), "HaMasger/Yad Harutsim");
}

static void init_default_favorites(void) {
  if (!load_persisted_favorites()) {
    set_default_favorites();
  }
}

static void dismiss_tutorial(void) {
  if (!s_show_tutorial) return;
  s_show_tutorial = false;
  persist_write_bool(PERSIST_TUTORIAL_SEEN, true);
  s_screen = ScreenHome;
  s_tutorial_page = 0;
  ui_screens_restart_marquee(&s_ui);
  update_screen_notice();
  if (s_menu_layer) {
    menu_layer_reload_data(s_menu_layer);
  }
  request_settings();
}

static void update_screen_notice(void) {
  static char status[64];
  if (s_screen == ScreenArrivals && s_arrival_count) {
    if (s_source == 0) {
      set_notice("Select to refresh", NoticeInfo);
      return;
    } else if (s_source == 3) {
      snprintf(status, sizeof(status), "%s", source_label(s_source));
      set_notice(status, NoticeScheduled);
      return;
    } else if (s_source == 1) {
      snprintf(status, sizeof(status), "%s %lds", source_label(s_source), (long)s_updated_ago_sec);
      set_notice(status, NoticeLive);
      return;
    } else {
      snprintf(status, sizeof(status), "%s", source_label(s_source));
      set_notice(status, NoticeScheduled);
      return;
    }
  } else if (s_screen == ScreenNearby) {
    set_notice("Select stop  Long: save", NoticeInfo);
  } else if (s_screen == ScreenArrivals) {
    set_notice("No arrivals soon", NoticeWarning);
  } else if (s_screen == ScreenStopCode) {
    set_notice("Select edits  Open row", NoticeInfo);
  } else if (s_screen == ScreenTutorial) {
    set_notice("UP/DOWN pages  SELECT next", NoticeInfo);
  } else if (s_screen == ScreenDebug) {
    set_notice("Select to refresh", NoticeInfo);
  } else {
    set_notice("Select: open  Long: save", NoticeInfo);
  }
}

static void menu_select_callback(MenuLayer *menu_layer, MenuIndex *cell_index, void *data) {
  uint16_t row = cell_index->row;
  if (s_loading) return;

  if (s_screen == ScreenHome) {
    if (row < s_favorite_count) {
      request_arrivals(s_favorite_stops[row].code, s_favorite_stops[row].name);
    } else if (row == s_favorite_count) {
      request_nearby();
    } else if (row == s_favorite_count + 1) {
      request_stop_code();
    }
  } else if (s_screen == ScreenNearby) {
    if (row < s_nearby_count) {
      request_arrivals(s_nearby_stops[row].code, s_nearby_stops[row].name);
    } else {
      request_nearby();
    }
  } else if (s_screen == ScreenArrivals) {
    request_arrivals(s_selected_stop_code, s_selected_stop_name);
  } else if (s_screen == ScreenStopCode) {
    if (row < STOP_CODE_DIGITS) {
      s_manual_digits[row] = (s_manual_digits[row] + 1) % 10;
      menu_layer_reload_data(s_menu_layer);
      update_screen_notice();
    } else {
      request_arrivals(manual_stop_code(), "Manual stop");
    }
  } else if (s_screen == ScreenDebug) {
    request_debug();
  } else if (s_screen == ScreenTutorial) {
    if (s_tutorial_page + 1 >= TUTORIAL_PAGE_COUNT) {
      dismiss_tutorial();
    } else {
      s_tutorial_page += 1;
      menu_layer_reload_data(s_menu_layer);
      update_screen_notice();
    }
  }
}

static void menu_select_long_callback(MenuLayer *menu_layer, MenuIndex *cell_index, void *data) {
  MenuIndex selected = *cell_index;
  if (s_loading) return;

  if (s_screen == ScreenTutorial) {
    dismiss_tutorial();
  } else if (s_screen == ScreenNearby && selected.row < s_nearby_count) {
    vibes_short_pulse();
    set_status("Saving stop...");
    send_request(REQ_FAVORITE_STOP, s_nearby_stops[selected.row].code, NULL, 1);
  } else if (s_screen == ScreenArrivals && selected.row < s_arrival_count) {
    vibes_short_pulse();
    set_status("Toggling line...");
    send_request(REQ_FAVORITE_LINE, 0, s_arrivals[selected.row].line, 0);
  } else if (s_screen == ScreenHome && selected.row < s_favorite_count) {
    vibes_short_pulse();
    set_status("Removing stop...");
    send_request(REQ_FAVORITE_STOP, s_favorite_stops[selected.row].code, NULL, -1);
  } else if (s_screen == ScreenStopCode) {
    request_arrivals(manual_stop_code(), "Manual stop");
  }
}

static void up_click_handler(ClickRecognizerRef recognizer, void *context) {
  if (!s_loading) {
    if (s_screen == ScreenTutorial) {
      if (s_tutorial_page > 0) s_tutorial_page -= 1;
      menu_layer_reload_data(s_menu_layer);
      update_screen_notice();
    } else {
      menu_layer_set_selected_next(s_menu_layer, true, MenuRowAlignCenter, true);
      ui_screens_restart_marquee(&s_ui);
    }
  }
}

static void down_click_handler(ClickRecognizerRef recognizer, void *context) {
  if (!s_loading) {
    if (s_screen == ScreenTutorial) {
      if (s_tutorial_page + 1 < TUTORIAL_PAGE_COUNT) s_tutorial_page += 1;
      menu_layer_reload_data(s_menu_layer);
      update_screen_notice();
    } else {
      menu_layer_set_selected_next(s_menu_layer, false, MenuRowAlignCenter, true);
      ui_screens_restart_marquee(&s_ui);
    }
  }
}

static void select_click_handler(ClickRecognizerRef recognizer, void *context) {
  MenuIndex selected = menu_layer_get_selected_index(s_menu_layer);
  menu_select_callback(s_menu_layer, &selected, NULL);
}

static void select_long_click_handler(ClickRecognizerRef recognizer, void *context) {
  MenuIndex selected = menu_layer_get_selected_index(s_menu_layer);
  menu_select_long_callback(s_menu_layer, &selected, NULL);
}

static void back_click_handler(ClickRecognizerRef recognizer, void *context) {
  if (s_screen == ScreenTutorial) {
    dismiss_tutorial();
  } else if (s_screen == ScreenArrivals || s_screen == ScreenNearby || s_screen == ScreenStopCode || s_screen == ScreenDebug) {
    cancel_refresh_timer();
    cancel_loading_timer();
    s_loading = false;
    s_settings_syncing = false;
    if (s_screen == ScreenArrivals &&
        (s_arrivals_back_screen == ScreenNearby || s_arrivals_back_screen == ScreenStopCode)) {
      s_screen = s_arrivals_back_screen;
    } else {
      s_screen = ScreenHome;
    }
    ui_screens_restart_marquee(&s_ui);
    update_screen_notice();
    menu_layer_reload_data(s_menu_layer);
    if (s_screen == s_arrivals_back_screen) {
      menu_layer_set_selected_index(s_menu_layer, s_arrivals_back_index, MenuRowAlignCenter, false);
    }
  } else {
    window_stack_pop(true);
  }
}

static void click_config_provider(void *context) {
  window_single_click_subscribe(BUTTON_ID_UP, up_click_handler);
  window_single_click_subscribe(BUTTON_ID_DOWN, down_click_handler);
  window_single_click_subscribe(BUTTON_ID_SELECT, select_click_handler);
  window_long_click_subscribe(BUTTON_ID_SELECT, 700, select_long_click_handler, NULL);
  window_single_click_subscribe(BUTTON_ID_BACK, back_click_handler);
}

static void parse_stop_rows(DictionaryIterator *iter, StopRow *rows, uint8_t *count, uint8_t max_rows) {
  *count = 0;
  for (uint8_t i = 0; i < max_rows; i += 1) {
    uint32_t name_key = MESSAGE_KEY_StopName0 + i;
    uint32_t code_key = MESSAGE_KEY_StopCodeList0 + i;
    Tuple *code_tuple = dict_find(iter, code_key);
    if (!code_tuple) continue;
    rows[*count].code = code_tuple->value->int32;
    rows[*count].distance_m = tuple_int(iter, MESSAGE_KEY_StopDistM0 + i, 0);
    copy_tuple_string(iter, name_key, rows[*count].name, sizeof(rows[*count].name));
    if (!rows[*count].name[0]) {
      snprintf(rows[*count].name, sizeof(rows[*count].name), "Stop %ld", (long)rows[*count].code);
    }
    *count += 1;
  }
}

static void parse_arrival_rows(DictionaryIterator *iter) {
  s_arrival_count = 0;
  for (uint8_t i = 0; i < MAX_ARRIVAL_ITEMS; i += 1) {
    Tuple *line_tuple = dict_find(iter, MESSAGE_KEY_Line0 + i);
    if (!line_tuple) continue;
    snprintf(s_arrivals[s_arrival_count].line, sizeof(s_arrivals[s_arrival_count].line), "%s", line_tuple->value->cstring);
    copy_tuple_string(iter, MESSAGE_KEY_Dest0 + i, s_arrivals[s_arrival_count].dest, sizeof(s_arrivals[s_arrival_count].dest));
    s_arrivals[s_arrival_count].minutes = tuple_int(iter, MESSAGE_KEY_Minutes0 + i, 0);
    s_arrivals[s_arrival_count].delay_min = tuple_int(iter, MESSAGE_KEY_DelayMin0 + i, 0);
    s_arrivals[s_arrival_count].flags = tuple_int(iter, MESSAGE_KEY_Flags0 + i, 0);
    s_arrival_count += 1;
  }
}

static void parse_debug_rows(DictionaryIterator *iter) {
  s_debug_count = 0;
  for (uint8_t i = 0; i < 4; i += 1) {
    uint32_t key = MESSAGE_KEY_DebugLine0 + i;
    Tuple *line_tuple = dict_find(iter, key);
    if (!line_tuple) continue;
    snprintf(s_debug_lines[s_debug_count], sizeof(s_debug_lines[s_debug_count]), "%s", line_tuple->value->cstring);
    s_debug_count += 1;
  }
}

static void inbox_received_callback(DictionaryIterator *iter, void *context) {
  int32_t status = tuple_int(iter, MESSAGE_KEY_Status, STATUS_OK);
  int32_t req_type = tuple_int(iter, MESSAGE_KEY_ReqType, 0);
  s_source = tuple_int(iter, MESSAGE_KEY_Source, 0);
  s_updated_ago_sec = tuple_int(iter, MESSAGE_KEY_UpdatedAgoSec, 0);
  bool apply_default_screen = req_type == REQ_SYNC_SETTINGS &&
                              s_apply_default_screen_on_settings &&
                              s_screen == ScreenHome;
  if (req_type == REQ_SYNC_SETTINGS) {
    s_settings_syncing = false;
    s_apply_default_screen_on_settings = false;
  }

  if (status != STATUS_OK) {
    s_settings_syncing = false;
    if (req_type == REQ_SYNC_SETTINGS) {
      s_apply_default_screen_on_settings = false;
    }
    if (req_type == REQ_ARRIVALS) {
      s_screen = ScreenArrivals;
      if (!s_arrival_count) {
        s_source = 0;
        s_updated_ago_sec = 0;
      }
    }
    clear_loading();
    if (status == 12) set_status_colored("GPS unavailable", ui_color_red(), GColorWhite);
    else if (status == STATUS_NO_DATA) set_status_colored("No provider data", ui_color_amber(), GColorBlack);
    else if (status == STATUS_API_AUTH) set_status_colored("API auth error", ui_color_red(), GColorWhite);
    else if (status == STATUS_RATE_LIMIT) set_status_colored("Rate limited", ui_color_red(), GColorWhite);
    else if (status == 10 || status == 11) set_status_colored("Data error", ui_color_red(), GColorWhite);
    else set_status_colored("Phone error", ui_color_red(), GColorWhite);
    return;
  }

  if (req_type == REQ_SYNC_SETTINGS) {
    int32_t default_screen = tuple_int(iter, MESSAGE_KEY_SettingsUpdated, SETTINGS_DEFAULT_FAVORITES);
    s_refresh_sec = tuple_int(iter, MESSAGE_KEY_RefreshSec, 30);
    s_debug_enabled = tuple_int(iter, MESSAGE_KEY_DebugEnabled, 0) ? true : false;
    bool was_dark_mode = s_dark_mode;
    s_dark_mode = tuple_int(iter, MESSAGE_KEY_DarkMode, s_dark_mode ? 1 : 0) ? true : false;
    ui_colors_set_dark_mode(s_dark_mode);
    persist_write_int(PERSIST_DARK_MODE, s_dark_mode ? 1 : 0);
    if (was_dark_mode != s_dark_mode) {
      apply_menu_layer_theme();
      menu_layer_reload_data(s_menu_layer);
    }
    parse_stop_rows(iter, s_favorite_stops, &s_favorite_count, MAX_FAVORITES);
    if (!s_favorite_count) {
      set_default_favorites();
    }
    select_first_favorite_if_current_missing();
    persist_favorite_stops();
    if (apply_default_screen && default_screen == SETTINGS_DEFAULT_NEARBY) {
      request_nearby();
      return;
    }
    if (apply_default_screen) {
      s_screen = ScreenHome;
      ui_screens_restart_marquee(&s_ui);
    }
  } else if (req_type == REQ_NEARBY) {
    parse_stop_rows(iter, s_nearby_stops, &s_nearby_count, MAX_STOP_ITEMS);
    s_screen = ScreenNearby;
    ui_screens_restart_marquee(&s_ui);
  } else if (req_type == REQ_ARRIVALS) {
    parse_arrival_rows(iter);
    s_screen = ScreenArrivals;
    ui_screens_restart_marquee(&s_ui);
    if (s_arrival_count) {
      if (s_source != 3) {
        persist_arrivals_cache();
      }
      for (uint8_t i = 0; i < s_arrival_count; i += 1) {
        if (s_arrivals[i].flags & ARRIVAL_FLAG_URGENT) {
          vibes_double_pulse();
          break;
        }
      }
    }
  } else if (req_type == REQ_FAVORITE_LINE) {
    request_arrivals(s_selected_stop_code, s_selected_stop_name);
    return;
  } else if (req_type == REQ_FAVORITE_STOP) {
    request_settings();
    return;
  } else if (req_type == REQ_DEBUG) {
    parse_debug_rows(iter);
    s_screen = ScreenDebug;
    ui_screens_restart_marquee(&s_ui);
  }

  clear_loading();
  update_screen_notice();
  schedule_refresh_timer();
}

static void inbox_dropped_callback(AppMessageResult reason, void *context) {
  clear_loading();
  set_status_colored("Message dropped", ui_color_red(), GColorWhite);
}

static void outbox_failed_callback(DictionaryIterator *iter, AppMessageResult reason, void *context) {
  s_settings_syncing = false;
  clear_loading();
  if (s_screen == ScreenArrivals && load_cached_arrivals(s_selected_stop_code, s_selected_stop_name)) {
    return;
  }
  set_status_colored("Phone disconnected", ui_color_red(), GColorWhite);
}

static void window_load(Window *window) {
  Layer *window_layer = window_get_root_layer(window);
  GRect bounds = layer_get_bounds(window_layer);

  s_menu_layer = menu_layer_create(bounds);
  apply_menu_layer_theme();
  menu_layer_set_callbacks(s_menu_layer, &s_ui, (MenuLayerCallbacks) {
    .get_num_sections = ui_screens_get_num_sections_callback,
    .get_num_rows = ui_screens_get_num_rows_callback,
    .get_header_height = ui_screens_get_header_height_callback,
    .draw_header = ui_screens_draw_header_callback,
    .get_cell_height = ui_screens_get_cell_height_callback,
    .draw_row = ui_screens_draw_row_callback,
    .select_click = menu_select_callback,
    .select_long_click = menu_select_long_callback
  });
  layer_add_child(window_layer, menu_layer_get_layer(s_menu_layer));
  window_set_click_config_provider(window, click_config_provider);
}

static void window_unload(Window *window) {
  cancel_refresh_timer();
  cancel_loading_timer();
  ui_screens_cancel_marquee();
  menu_layer_destroy(s_menu_layer);
  s_menu_layer = NULL;
}

static void init(void) {
  s_dark_mode = persist_exists(PERSIST_DARK_MODE) ? persist_read_int(PERSIST_DARK_MODE) != 0 : false;
  ui_colors_set_dark_mode(s_dark_mode);
  s_show_tutorial = !persist_exists(PERSIST_TUTORIAL_SEEN);
  if (s_show_tutorial) {
    s_screen = ScreenTutorial;
    s_tutorial_page = 0;
  }
  init_default_favorites();
  s_window = window_create();
  window_set_window_handlers(s_window, (WindowHandlers) {
    .load = window_load,
    .unload = window_unload
  });

  app_message_register_inbox_received(inbox_received_callback);
  app_message_register_inbox_dropped(inbox_dropped_callback);
  app_message_register_outbox_failed(outbox_failed_callback);
  app_message_open(8192, 256);

  window_stack_push(s_window, true);
  if (s_show_tutorial) {
    update_screen_notice();
  } else {
    request_settings();
  }
}

static void deinit(void) {
  window_destroy(s_window);
}

int main(void) {
  init();
  app_event_loop();
  deinit();
}
