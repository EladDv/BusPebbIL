#include <string.h>

#include "ui_screens.h"
#include "ui_colors.h"
#include "ui_text.h"

static AppTimer *s_marquee_timer;
static uint8_t s_marquee_offset;

static MenuLayer *ui_menu_layer(BusPebbILUiState *ui) {
  return ui && ui->menu_layer ? *ui->menu_layer : NULL;
}

static uint16_t home_normal_row_count(BusPebbILUiState *ui) {
  return *ui->favorite_count + 2;
}

static int32_t manual_stop_code(BusPebbILUiState *ui) {
  int32_t code = 0;
  for (int i = 0; i < STOP_CODE_DIGITS; i += 1) {
    code = code * 10 + ui->manual_digits[i];
  }
  return code;
}

static int16_t round_row_inset(BusPebbILUiState *ui, uint16_t row) {
#ifdef PBL_ROUND
  MenuLayer *menu_layer = ui_menu_layer(ui);
  if (!menu_layer) return 0;
  MenuIndex selected = menu_layer_get_selected_index(menu_layer);
  int16_t delta = (int16_t)row - (int16_t)selected.row;
  if (delta < 0) delta = -delta;
  if (delta == 0) return 0;
  if (delta == 1) return 18;
  return 28;
#endif
  (void)ui;
  (void)row;
  return 0;
}

static GRect inset_rect(GRect rect, int16_t inset) {
  if (inset <= 0) return rect;
  rect.origin.x += inset;
  rect.size.w -= inset * 2;
  if (rect.size.w < 8) rect.size.w = 8;
  return rect;
}

static int line_digit(const char *line) {
  if (!line || !line[0]) return 0;
  for (size_t i = 0; line[i]; i += 1) {
    if (line[i] >= '0' && line[i] <= '9') return line[i] - '0';
  }
  return 0;
}

static GColor route_color(const char *line) {
  switch (line_digit(line) % 5) {
    case 0: return ui_color_blue();
    case 1: return ui_color_orange();
    case 2: return ui_color_magenta();
    case 3: return ui_color_cyan();
    default: return ui_color_mint();
  }
}

static GColor operator_chip_color(int32_t flags, const char *line) {
  uint8_t color_index = (flags & ARRIVAL_OPERATOR_COLOR_MASK) >> ARRIVAL_OPERATOR_COLOR_SHIFT;
  switch (color_index) {
    case 1: return ui_color_egged_green();
    case 2: return ui_color_blue();
    case 3: return ui_color_orange();
    case 4: return ui_color_kavim_green();
    case 5: return ui_color_deep_blue();
    case 6: return ui_color_afikim_blue();
    case 7: return ui_color_tnufa_teal();
    case 8: return ui_color_orange();
    default: return route_color(line);
  }
}

uint16_t ui_screens_get_num_sections_callback(MenuLayer *menu_layer, void *data) {
  (void)menu_layer;
  (void)data;
  return 1;
}

uint16_t ui_screens_get_num_rows_callback(MenuLayer *menu_layer, uint16_t section_index, void *data) {
  (void)menu_layer;
  (void)section_index;
  BusPebbILUiState *ui = data;
  if (*ui->loading) return 1;
  if (*ui->screen == ScreenTutorial) return 1;
  if (*ui->screen == ScreenHome) return home_normal_row_count(ui);
  if (*ui->screen == ScreenNearby) return *ui->nearby_count ? *ui->nearby_count : 1;
  if (*ui->screen == ScreenArrivals) return *ui->arrival_count ? *ui->arrival_count : 1;
  if (*ui->screen == ScreenStopCode) return STOP_CODE_DIGITS + 1;
  if (*ui->screen == ScreenDebug) return *ui->debug_count ? *ui->debug_count : 1;
  return 1;
}

int16_t ui_screens_get_header_height_callback(MenuLayer *menu_layer, uint16_t section_index, void *data) {
  (void)menu_layer;
  (void)section_index;
  BusPebbILUiState *ui = data;
  if (*ui->screen == ScreenHome || *ui->screen == ScreenTutorial) return 0;
  return HEADER_H;
}

static int16_t header_title_width(int16_t bounds_w) {
#ifdef PBL_ROUND
  return bounds_w - 72;
#endif
  return bounds_w - HEADER_TITLE_X - HEADER_CODE_W - HEADER_CODE_RIGHT_PAD - HEADER_TITLE_CODE_GAP;
}

static int16_t home_title_width(int16_t bounds_w) {
  return bounds_w - HOME_TITLE_X - HOME_TITLE_RIGHT_PAD;
}

static bool header_title_fits_width(const char *title, int16_t width) {
  return ui_text_fits_width(title, fonts_get_system_font(FONT_KEY_GOTHIC_18_BOLD), width, HEADER_H);
}

static int16_t arrival_dest_width_for_screen(int16_t bounds_w, int16_t safe_inset) {
  int16_t left = safe_inset;
  int16_t right = bounds_w - safe_inset;
  int16_t time_x = right - ARRIVAL_TIME_W - 5;
  int16_t dest_x = left + ARRIVAL_DEST_X;
  int16_t width = time_x - dest_x - ARRIVAL_DEST_TIME_GAP;
  if (width < 18) width = 18;
  return width;
}

static bool header_should_scroll(BusPebbILUiState *ui) {
  if (*ui->screen != ScreenArrivals || !ui->selected_stop_name[0]) return false;
  int16_t width = 144;
  MenuLayer *menu_layer = ui_menu_layer(ui);
  if (menu_layer) {
    width = layer_get_bounds(menu_layer_get_layer(menu_layer)).size.w;
  }
  return !header_title_fits_width(ui->selected_stop_name, header_title_width(width));
}

static bool selected_arrival_dest_should_scroll(BusPebbILUiState *ui) {
  MenuLayer *menu_layer = ui_menu_layer(ui);
  if (*ui->screen != ScreenArrivals || !menu_layer || !*ui->arrival_count) return false;
  MenuIndex selected = menu_layer_get_selected_index(menu_layer);
  if (selected.row >= *ui->arrival_count) return false;
  const char *dest = ui->arrivals[selected.row].dest[0] ? ui->arrivals[selected.row].dest : "No destination";
  int16_t width = layer_get_bounds(menu_layer_get_layer(menu_layer)).size.w;
  return !ui_text_fits_width(dest, fonts_get_system_font(FONT_KEY_GOTHIC_14), arrival_dest_width_for_screen(width, 0), 18);
}

static const char *home_title_for_row(BusPebbILUiState *ui, uint16_t row) {
  if (row < *ui->favorite_count) return ui->favorite_stops[row].name;
  if (row == *ui->favorite_count) return "Nearby";
  if (row == *ui->favorite_count + 1) return "Stop code";
  return "Debug";
}

static bool selected_home_title_should_scroll(BusPebbILUiState *ui) {
  MenuLayer *menu_layer = ui_menu_layer(ui);
  if (*ui->screen != ScreenHome || !menu_layer) return false;
  MenuIndex selected = menu_layer_get_selected_index(menu_layer);
  if (selected.row >= ui_screens_get_num_rows_callback(NULL, 0, ui)) return false;
  int16_t width = layer_get_bounds(menu_layer_get_layer(menu_layer)).size.w;
  return !ui_text_fits_width(home_title_for_row(ui, selected.row),
                             fonts_get_system_font(FONT_KEY_GOTHIC_18_BOLD),
                             home_title_width(width), HOME_TITLE_H);
}

static bool selected_nearby_title_should_scroll(BusPebbILUiState *ui) {
  MenuLayer *menu_layer = ui_menu_layer(ui);
  if (*ui->screen != ScreenNearby || !menu_layer || !*ui->nearby_count) return false;
  MenuIndex selected = menu_layer_get_selected_index(menu_layer);
  if (selected.row >= *ui->nearby_count) return false;
  int16_t width = layer_get_bounds(menu_layer_get_layer(menu_layer)).size.w;
  return !ui_text_fits_width(ui->nearby_stops[selected.row].name,
                             fonts_get_system_font(FONT_KEY_GOTHIC_18_BOLD),
                             width - NAV_TITLE_W_RIGHT_PAD, HOME_TITLE_H);
}

static bool marquee_should_scroll(BusPebbILUiState *ui) {
  return header_should_scroll(ui) || selected_arrival_dest_should_scroll(ui) ||
         selected_home_title_should_scroll(ui) || selected_nearby_title_should_scroll(ui);
}

static uint8_t marquee_visible_chars(const char *title, GFont font, int16_t width, int16_t height, bool rtl) {
  (void)rtl;
  uint8_t visible_chars = ui_text_visible_chars_for_width(title, font, width, height);
  if (visible_chars > MARQUEE_EDGE_PAD_CHARS + 1) {
    visible_chars -= MARQUEE_EDGE_PAD_CHARS;
  }
  return visible_chars;
}

static size_t marquee_end_phase_for_title(const char *title, int16_t width) {
  GFont font = fonts_get_system_font(FONT_KEY_GOTHIC_18_BOLD);
  bool rtl = ui_text_is_rtl(title);
  size_t total = ui_text_utf8_char_count(title);
  uint8_t visible_chars = marquee_visible_chars(title, font, width, HOME_TITLE_H, rtl);
  if (visible_chars >= total) return 0;
  size_t max_offset = total - visible_chars;
  return max_offset + MARQUEE_EXTRA_CHARS;
}

static size_t selected_row_title_end_phase(BusPebbILUiState *ui) {
  MenuLayer *menu_layer = ui_menu_layer(ui);
  if (!menu_layer) return 0;
  MenuIndex selected = menu_layer_get_selected_index(menu_layer);
  int16_t width = layer_get_bounds(menu_layer_get_layer(menu_layer)).size.w;
  if (*ui->screen == ScreenHome && selected_home_title_should_scroll(ui)) {
    return marquee_end_phase_for_title(home_title_for_row(ui, selected.row), home_title_width(width));
  }
  if (*ui->screen == ScreenNearby && selected_nearby_title_should_scroll(ui)) {
    return marquee_end_phase_for_title(ui->nearby_stops[selected.row].name, width - NAV_TITLE_W_RIGHT_PAD);
  }
  return 0;
}

static size_t selected_arrival_dest_end_phase(BusPebbILUiState *ui) {
  MenuLayer *menu_layer = ui_menu_layer(ui);
  if (!menu_layer || *ui->screen != ScreenArrivals || !*ui->arrival_count) return 0;
  MenuIndex selected = menu_layer_get_selected_index(menu_layer);
  if (selected.row >= *ui->arrival_count) return 0;
  int16_t width = layer_get_bounds(menu_layer_get_layer(menu_layer)).size.w;
  int16_t dest_width = arrival_dest_width_for_screen(width, 0);
  return marquee_end_phase_for_title(ui->arrivals[selected.row].dest, dest_width);
}

void ui_screens_cancel_marquee(void) {
  if (s_marquee_timer) {
    app_timer_cancel(s_marquee_timer);
    s_marquee_timer = NULL;
  }
}

void ui_screens_reset_marquee(void) {
  s_marquee_offset = 0;
}

static void header_scroll_callback(void *data) {
  BusPebbILUiState *ui = data;
  s_marquee_timer = NULL;
  if (!marquee_should_scroll(ui)) {
    s_marquee_offset = 0;
    return;
  }
  s_marquee_offset += 1;
  MenuLayer *menu_layer = ui_menu_layer(ui);
  if (menu_layer) {
    layer_mark_dirty(menu_layer_get_layer(menu_layer));
  }
  size_t end_phase = selected_row_title_end_phase(ui);
  if (!end_phase) end_phase = selected_arrival_dest_end_phase(ui);
  uint32_t delay = (end_phase && s_marquee_offset % (end_phase + 1) == end_phase) ?
                   MARQUEE_END_PAUSE_MS : MARQUEE_STEP_MS;
  s_marquee_timer = app_timer_register(delay, header_scroll_callback, ui);
}

void ui_screens_restart_marquee(BusPebbILUiState *ui) {
  ui_screens_cancel_marquee();
  s_marquee_offset = 0;
  MenuLayer *menu_layer = ui_menu_layer(ui);
  if (menu_layer) layer_mark_dirty(menu_layer_get_layer(menu_layer));
  if (marquee_should_scroll(ui)) {
    s_marquee_timer = app_timer_register(MARQUEE_START_DELAY_MS, header_scroll_callback, ui);
  }
}

static const char *header_title_text(BusPebbILUiState *ui, const char *title) {
  static char visible[72];
  if (!header_should_scroll(ui)) return title;
  MenuLayer *menu_layer = ui_menu_layer(ui);
  if (!menu_layer) return title;

  int16_t screen_width = layer_get_bounds(menu_layer_get_layer(menu_layer)).size.w;
  int16_t width = header_title_width(screen_width);
  GFont font = fonts_get_system_font(FONT_KEY_GOTHIC_18_BOLD);
  bool rtl = ui_text_is_rtl(title);
  size_t total = ui_text_utf8_char_count(title);
  uint8_t visible_chars = marquee_visible_chars(title, font, width, HEADER_H, rtl);
  if (visible_chars >= total) return title;

  size_t end_phase = (total - visible_chars) + MARQUEE_EXTRA_CHARS;
  size_t phase = end_phase ? s_marquee_offset % (end_phase + 1) : 0;
  size_t start = ui_text_marquee_start(title, visible_chars, phase);
  size_t max_offset = total - visible_chars;

  while (visible_chars > 1) {
    ui_text_copy_utf8_range(visible, sizeof(visible), title, start, visible_chars);
    if (start == max_offset) {
      ui_text_append_spaces(visible, sizeof(visible), MARQUEE_TRAILING_SPACES);
      if (ui_text_fits_width(visible, font, width, HEADER_H)) return visible;
      ui_text_copy_utf8_range(visible, sizeof(visible), title, start, visible_chars);
    }
    if (ui_text_fits_width(visible, font, width, HEADER_H)) return visible;
    visible_chars -= 1;
  }

  return title;
}

static const char *arrival_dest_text(const char *dest, bool highlighted, int16_t width) {
  static char visible[72];
  static char clipped[64];
  const char *title = dest && dest[0] ? dest : "No destination";
  GFont font = fonts_get_system_font(FONT_KEY_GOTHIC_14);
  bool rtl = ui_text_is_rtl(title);
  if (ui_text_fits_width(title, font, width, 18)) {
    return title;
  }
  if (!highlighted) {
    size_t total = ui_text_utf8_char_count(title);
    for (size_t keep = total; keep > 0; keep -= 1) {
      ui_text_copy_utf8_range(clipped, sizeof(clipped), title, 0, keep);
      if (rtl) {
        snprintf(visible, sizeof(visible), "...%s", clipped);
      } else {
        snprintf(visible, sizeof(visible), "%s...", clipped);
      }
      if (ui_text_fits_width(visible, font, width, 18)) return visible;
    }
    return "...";
  }

  size_t total = ui_text_utf8_char_count(title);
  uint8_t visible_chars = marquee_visible_chars(title, font, width, 18, rtl);
  if (visible_chars >= total) return title;
  size_t end_phase = (total - visible_chars) + MARQUEE_EXTRA_CHARS;
  size_t phase = end_phase ? s_marquee_offset % (end_phase + 1) : 0;
  size_t start = ui_text_marquee_start(title, visible_chars, phase);
  size_t max_offset = total - visible_chars;

  while (visible_chars > 1) {
    ui_text_copy_utf8_range(visible, sizeof(visible), title, start, visible_chars);
    if (start == max_offset) {
      ui_text_append_spaces(visible, sizeof(visible), MARQUEE_TRAILING_SPACES);
      if (ui_text_fits_width(visible, font, width, 18)) return visible;
      ui_text_copy_utf8_range(visible, sizeof(visible), title, start, visible_chars);
    }
    if (ui_text_fits_width(visible, font, width, 18)) return visible;
    visible_chars -= 1;
  }

  return title;
}

static const char *home_static_title_text(const char *title, int16_t width) {
  static char visible[72];
  static char clipped[64];
  GFont font = fonts_get_system_font(FONT_KEY_GOTHIC_18_BOLD);
  bool rtl = ui_text_is_rtl(title);
  if (ui_text_fits_width(title, font, width, HOME_TITLE_H)) return title;

  size_t total = ui_text_utf8_char_count(title);
  for (size_t keep = total; keep > 0; keep -= 1) {
    ui_text_copy_utf8_range(clipped, sizeof(clipped), title, 0, keep);
    if (rtl) {
      snprintf(visible, sizeof(visible), "...%s", clipped);
    } else {
      snprintf(visible, sizeof(visible), "%s...", clipped);
    }
    if (ui_text_fits_width(visible, font, width, HOME_TITLE_H)) return visible;
  }

  return "...";
}

static const char *home_marquee_title_text(const char *title, int16_t width) {
  static char visible[72];
  GFont font = fonts_get_system_font(FONT_KEY_GOTHIC_18_BOLD);
  if (ui_text_fits_width(title, font, width, HOME_TITLE_H)) return title;
  bool rtl = ui_text_is_rtl(title);
  size_t total = ui_text_utf8_char_count(title);
  uint8_t visible_chars = marquee_visible_chars(title, font, width, HOME_TITLE_H, rtl);
  if (visible_chars >= total) return title;

  size_t end_phase = marquee_end_phase_for_title(title, width);
  size_t phase = end_phase ? s_marquee_offset % (end_phase + 1) : 0;
  size_t start = ui_text_marquee_start(title, visible_chars, phase);
  size_t max_offset = total - visible_chars;

  while (visible_chars > 1) {
    ui_text_copy_utf8_range(visible, sizeof(visible), title, start, visible_chars);
    if (start == max_offset) {
      ui_text_append_spaces(visible, sizeof(visible), MARQUEE_TRAILING_SPACES);
      if (ui_text_fits_width(visible, font, width, HOME_TITLE_H)) return visible;
      ui_text_copy_utf8_range(visible, sizeof(visible), title, start, visible_chars);
    }
    if (ui_text_fits_width(visible, font, width, HOME_TITLE_H)) return visible;
    visible_chars -= 1;
  }

  return home_static_title_text(title, width);
}

static const char *screen_title(BusPebbILUiState *ui) {
  if (*ui->screen == ScreenHome) {
    return "BusPebbIL";
  } else if (*ui->screen == ScreenNearby) {
    return "Nearby stops";
  } else if (*ui->screen == ScreenStopCode) {
    return "Stop code";
  } else if (*ui->screen == ScreenDebug) {
    return "Debug";
  }
  return ui->selected_stop_name;
}

void ui_screens_draw_header_callback(GContext *ctx, const Layer *cell_layer, uint16_t section_index, void *data) {
  (void)section_index;
  BusPebbILUiState *ui = data;
  GRect bounds = layer_get_bounds(cell_layer);
  const char *title = screen_title(ui);
  graphics_context_set_fill_color(ctx, ui_color_paper());
  graphics_fill_rect(ctx, bounds, 0, GCornerNone);
  graphics_context_set_fill_color(ctx, *ui->screen == ScreenArrivals ? ui_color_mint() : ui_color_blue());
  graphics_fill_rect(ctx, GRect(0, 0, 5, bounds.size.h), 0, GCornerNone);
  graphics_context_set_fill_color(ctx, ui_color_amber());
  graphics_fill_rect(ctx, GRect(5, bounds.size.h - 3, bounds.size.w - 5, 3), 0, GCornerNone);
  graphics_context_set_text_color(ctx, ui_color_ink());
  bool scrolling_title = header_should_scroll(ui);
  const char *display_title = *ui->screen == ScreenHome ? "TLV BUS" : (scrolling_title ? header_title_text(ui, title) : title);
  GFont title_font = fonts_get_system_font(FONT_KEY_GOTHIC_18_BOLD);
#ifdef PBL_ROUND
  graphics_draw_text(ctx, display_title,
                     title_font,
                     GRect(36, 1, header_title_width(bounds.size.w), bounds.size.h - 2),
                     GTextOverflowModeTrailingEllipsis, GTextAlignmentCenter, NULL);
  if (*ui->screen == ScreenHome) {
    graphics_context_set_fill_color(ctx, ui_color_blue());
    graphics_fill_rect(ctx, GRect(bounds.size.w / 2 + 32, 5, 25, 18), 4, GCornersAll);
    graphics_context_set_text_color(ctx, ui_color_accent_text());
    graphics_draw_text(ctx, "IL", fonts_get_system_font(FONT_KEY_GOTHIC_14_BOLD),
                       GRect(bounds.size.w / 2 + 34, 3, 21, 20),
                       GTextOverflowModeTrailingEllipsis, GTextAlignmentCenter, NULL);
  }
  return;
#endif
  graphics_draw_text(ctx, display_title,
                     title_font,
                     GRect(HEADER_TITLE_X, 1, header_title_width(bounds.size.w), bounds.size.h - 2),
                     GTextOverflowModeTrailingEllipsis,
                     ui_text_is_rtl(title) ? GTextAlignmentRight : GTextAlignmentLeft, NULL);

  if (*ui->screen == ScreenArrivals && *ui->selected_stop_code) {
    static char code[16];
    snprintf(code, sizeof(code), "%ld", (long)*ui->selected_stop_code);
    graphics_context_set_fill_color(ctx, ui_color_soft());
    graphics_fill_rect(ctx, GRect(bounds.size.w - HEADER_CODE_W - HEADER_CODE_RIGHT_PAD, 5, HEADER_CODE_W, 18), 4, GCornersAll);
    graphics_context_set_text_color(ctx, ui_color_ink());
    graphics_draw_text(ctx, code, fonts_get_system_font(FONT_KEY_GOTHIC_14_BOLD),
                       GRect(bounds.size.w - HEADER_CODE_W - HEADER_CODE_RIGHT_PAD + 2, 3, HEADER_CODE_W - 4, 20),
                       GTextOverflowModeTrailingEllipsis, GTextAlignmentCenter, NULL);
  } else if (*ui->screen == ScreenHome) {
    graphics_context_set_fill_color(ctx, ui_color_blue());
    graphics_fill_rect(ctx, GRect(bounds.size.w - 34, 5, 29, 18), 4, GCornersAll);
    graphics_context_set_text_color(ctx, ui_color_accent_text());
    graphics_draw_text(ctx, "IL", fonts_get_system_font(FONT_KEY_GOTHIC_14_BOLD),
                       GRect(bounds.size.w - 32, 3, 25, 20),
                       GTextOverflowModeTrailingEllipsis, GTextAlignmentCenter, NULL);
  }
}

static void draw_text_row(BusPebbILUiState *ui, GContext *ctx, const Layer *cell_layer, uint16_t row, const char *title, const char *subtitle) {
  GRect bounds = layer_get_bounds(cell_layer);
  bool highlighted = menu_cell_layer_is_highlighted(cell_layer);
  int16_t safe_inset = round_row_inset(ui, row);
  graphics_context_set_fill_color(ctx, ui_color_paper());
  graphics_fill_rect(ctx, bounds, 0, GCornerNone);
  graphics_context_set_fill_color(ctx, ui_color_soft());
  GRect card = inset_rect(GRect(7, 7, bounds.size.w - 14, bounds.size.h - 10), safe_inset);
  graphics_fill_rect(ctx, card, 4, GCornersAll);
  if (highlighted) {
    graphics_context_set_fill_color(ctx, ui_color_amber());
    graphics_fill_rect(ctx, GRect(card.origin.x, card.origin.y, 4, card.size.h), 0, GCornerNone);
  }
  graphics_context_set_text_color(ctx, ui_color_ink());

  GFont font = fonts_get_system_font(FONT_KEY_GOTHIC_18);
  GRect title_box = GRect(card.origin.x + 6, 6, card.size.w - 12, subtitle && subtitle[0] ? 24 : bounds.size.h - 8);
  graphics_draw_text(ctx, title ? title : "", font, title_box, GTextOverflowModeTrailingEllipsis, GTextAlignmentLeft, NULL);

  if (subtitle && subtitle[0]) {
    GRect subtitle_box = GRect(card.origin.x + 6, 27, card.size.w - 12, bounds.size.h - 29);
    graphics_draw_text(ctx, subtitle, fonts_get_system_font(FONT_KEY_GOTHIC_14),
                       subtitle_box, GTextOverflowModeTrailingEllipsis, GTextAlignmentLeft, NULL);
  }
}

static GColor notice_color(BusPebbILUiState *ui) {
  switch (*ui->notice_kind) {
    case NoticeLoading: return ui_color_amber();
    case NoticeLive: return ui_color_mint();
    case NoticeScheduled: return ui_color_blue();
    case NoticeWarning: return ui_color_orange();
    case NoticeError: return ui_color_red();
    default: return ui_color_cyan();
  }
}

static void draw_loading_row(BusPebbILUiState *ui, GContext *ctx, const Layer *cell_layer) {
  GRect bounds = layer_get_bounds(cell_layer);
  GColor accent = notice_color(ui);
  int16_t left = 6;
  int16_t right = bounds.size.w;

  graphics_context_set_fill_color(ctx, ui_color_paper());
  graphics_fill_rect(ctx, bounds, 0, GCornerNone);

  graphics_context_set_fill_color(ctx, accent);
  graphics_fill_rect(ctx, GRect(left, 10, 4, 45), 0, GCornerNone);
  graphics_fill_rect(ctx, GRect(left + 8, 18, 42, 26), 6, GCornersAll);
  graphics_context_set_text_color(ctx, ui_color_route_text(accent));
  graphics_draw_text(ctx, "--", fonts_get_system_font(FONT_KEY_GOTHIC_24_BOLD),
                     GRect(left + 10, 14, 38, 27), GTextOverflowModeTrailingEllipsis,
                     GTextAlignmentCenter, NULL);
  graphics_context_set_text_color(ctx, ui_color_ink());
  graphics_draw_text(ctx, ui->notice[0] ? ui->notice : "Checking arrivals",
                     fonts_get_system_font(FONT_KEY_GOTHIC_18_BOLD),
                     GRect(left + 57, 11, right - left - 80, 24),
                     GTextOverflowModeTrailingEllipsis, GTextAlignmentLeft, NULL);
  graphics_draw_text(ctx, screen_title(ui),
                     fonts_get_system_font(FONT_KEY_GOTHIC_14),
                     GRect(left + 57, 32, right - left - 80, 18),
                     GTextOverflowModeTrailingEllipsis, GTextAlignmentLeft, NULL);
  graphics_context_set_text_color(ctx, accent);
  graphics_draw_text(ctx, "...", fonts_get_system_font(FONT_KEY_GOTHIC_24_BOLD),
                     GRect(right - 52, 18, 48, 28),
                     GTextOverflowModeTrailingEllipsis, GTextAlignmentCenter, NULL);
}

static void draw_structured_row_base(BusPebbILUiState *ui, GContext *ctx, const Layer *cell_layer, bool highlighted, int16_t safe_inset) {
  (void)ui;
  GRect bounds = layer_get_bounds(cell_layer);
  graphics_context_set_fill_color(ctx, ui_color_paper());
  graphics_fill_rect(ctx, bounds, 0, GCornerNone);
  graphics_context_set_fill_color(ctx, ui_color_soft());
  GRect card = inset_rect(GRect(6, 5, bounds.size.w - 12, bounds.size.h - 8), safe_inset);
  graphics_fill_rect(ctx, card, 4, GCornersAll);
  if (highlighted) {
    graphics_context_set_fill_color(ctx, ui_color_amber());
    graphics_fill_rect(ctx, GRect(card.origin.x, card.origin.y, 5, card.size.h), 0, GCornerNone);
  }
  graphics_context_set_text_color(ctx, ui_color_ink());
}

static void draw_nav_row(BusPebbILUiState *ui, GContext *ctx, const Layer *cell_layer, uint16_t row, const char *title, const char *meta, const char *subtitle) {
  GRect bounds = layer_get_bounds(cell_layer);
  bool highlighted = menu_cell_layer_is_highlighted(cell_layer);
  int16_t safe_inset = round_row_inset(ui, row);
  int16_t left = 14 + safe_inset;
  int16_t right = bounds.size.w - safe_inset;
  draw_structured_row_base(ui, ctx, cell_layer, highlighted, safe_inset);

  graphics_context_set_text_color(ctx, ui_color_ink());
  GRect title_box = GRect(left, 7, right - left - 64, HOME_TITLE_H);
  bool rtl = ui_text_is_rtl(title);
  const char *display_title = highlighted ? home_marquee_title_text(title, title_box.size.w) :
                                            home_static_title_text(title, title_box.size.w);
  graphics_draw_text(ctx, display_title, fonts_get_system_font(FONT_KEY_GOTHIC_18_BOLD),
                     title_box, GTextOverflowModeTrailingEllipsis,
                     rtl ? GTextAlignmentRight : GTextAlignmentLeft, NULL);
  graphics_context_set_fill_color(ctx, highlighted ? ui_color_ink() : ui_color_blue());
  GRect meta_box = GRect(right - 47, 13, 43, 20);
  graphics_fill_rect(ctx, meta_box, 5, GCornersAll);
  graphics_context_set_text_color(ctx, highlighted ? ui_color_paper() : ui_color_accent_text());
  graphics_draw_text(ctx, meta, fonts_get_system_font(FONT_KEY_GOTHIC_14_BOLD),
                     GRect(meta_box.origin.x + 2, 10, meta_box.size.w - 4, 22),
                     GTextOverflowModeTrailingEllipsis, GTextAlignmentCenter, NULL);
  graphics_context_set_text_color(ctx, ui_color_muted());
  graphics_draw_text(ctx, subtitle, fonts_get_system_font(FONT_KEY_GOTHIC_14),
                     GRect(left, 29, right - left - 4, 18),
                     GTextOverflowModeTrailingEllipsis, GTextAlignmentLeft, NULL);
}

static void draw_home_plain_row(BusPebbILUiState *ui, GContext *ctx, const Layer *cell_layer, uint16_t row, const char *title, const char *subtitle, GColor accent) {
  GRect bounds = layer_get_bounds(cell_layer);
  bool highlighted = menu_cell_layer_is_highlighted(cell_layer);
  int16_t safe_inset = round_row_inset(ui, row);
  graphics_context_set_fill_color(ctx, ui_color_paper());
  graphics_fill_rect(ctx, bounds, 0, GCornerNone);

  GRect card = inset_rect(GRect(6, 5, bounds.size.w - 12, bounds.size.h - 8), safe_inset);
  graphics_context_set_fill_color(ctx, ui_color_soft());
  graphics_fill_rect(ctx, card, 4, GCornersAll);
  graphics_context_set_fill_color(ctx, accent);
  graphics_fill_rect(ctx, GRect(card.origin.x, card.origin.y, highlighted ? 8 : 5, card.size.h), 0, GCornerNone);
  graphics_fill_rect(ctx, GRect(card.origin.x + 16, card.origin.y + 15, highlighted ? 10 : 8, highlighted ? 10 : 8), 3, GCornersAll);

  graphics_context_set_text_color(ctx, ui_color_ink());
  int16_t title_x = card.origin.x + 29;
  GRect title_box = GRect(title_x, 7, card.size.w - 34, HOME_TITLE_H);
  bool rtl = ui_text_is_rtl(title);
  const char *display_title = highlighted ? home_marquee_title_text(title, title_box.size.w) :
                                            home_static_title_text(title, title_box.size.w);
  graphics_draw_text(ctx, display_title, fonts_get_system_font(FONT_KEY_GOTHIC_18_BOLD),
                     title_box, GTextOverflowModeTrailingEllipsis,
                     rtl ? GTextAlignmentRight : GTextAlignmentLeft, NULL);
  graphics_context_set_text_color(ctx, ui_color_muted());
  graphics_draw_text(ctx, subtitle, fonts_get_system_font(FONT_KEY_GOTHIC_14),
                     GRect(title_x, 29, card.size.w - 34, 18),
                     GTextOverflowModeTrailingEllipsis, GTextAlignmentLeft, NULL);
}

static const char *tutorial_title(BusPebbILUiState *ui) {
  switch (*ui->tutorial_page) {
    case 0: return "Buttons";
    case 1: return "Select";
    case 2: return "Refresh";
    case 3: return "Favorites";
    case 4: return "Back";
    default: return "Done";
  }
}

static const char *tutorial_body(BusPebbILUiState *ui) {
  switch (*ui->tutorial_page) {
    case 0: return "UP/DOWN moves between rows and between these guide pages.";
    case 1: return "SELECT opens the highlighted stop, Nearby, or Stop code row.";
    case 2: return "On arrivals, SELECT refreshes the current stop.";
    case 3: return "In Nearby, LONG SELECT saves a stop as a favorite.";
    case 4: return "On arrivals, LONG SELECT toggles that line as a favorite.";
    default: return "BACK returns to the previous screen. SELECT starts the app.";
  }
}

static void draw_tutorial_row(BusPebbILUiState *ui, GContext *ctx, const Layer *cell_layer) {
  GRect bounds = layer_get_bounds(cell_layer);
  graphics_context_set_fill_color(ctx, ui_color_paper());
  graphics_fill_rect(ctx, bounds, 0, GCornerNone);
  graphics_context_set_text_color(ctx, ui_color_ink());
  graphics_draw_text(ctx, tutorial_title(ui), fonts_get_system_font(FONT_KEY_GOTHIC_24_BOLD),
                     GRect(10, 18, bounds.size.w - 20, 32),
                     GTextOverflowModeTrailingEllipsis, GTextAlignmentCenter, NULL);
  graphics_draw_text(ctx, tutorial_body(ui), fonts_get_system_font(FONT_KEY_GOTHIC_18),
                     GRect(12, 56, bounds.size.w - 24, bounds.size.h - 92),
                     GTextOverflowModeWordWrap, GTextAlignmentCenter, NULL);
  static char progress[16];
  snprintf(progress, sizeof(progress), "%d/%d", *ui->tutorial_page + 1, TUTORIAL_PAGE_COUNT);
  graphics_context_set_text_color(ctx, ui_color_muted());
  graphics_draw_text(ctx, progress, fonts_get_system_font(FONT_KEY_GOTHIC_14),
                     GRect(10, bounds.size.h - 30, bounds.size.w - 20, 18),
                     GTextOverflowModeTrailingEllipsis, GTextAlignmentCenter, NULL);
}

static void draw_home_favorite_row(BusPebbILUiState *ui, GContext *ctx, const Layer *cell_layer, uint16_t row, StopRow *stop) {
  static char subtitle[64];
  snprintf(subtitle, sizeof(subtitle), "favorite stop %ld", (long)stop->code);
  draw_home_plain_row(ui, ctx, cell_layer, row, stop->name, subtitle, ui_color_mint());
}

static void draw_home_row(BusPebbILUiState *ui, GContext *ctx, const Layer *cell_layer, uint16_t row) {
  if (row < *ui->favorite_count) {
    static char code[16];
    snprintf(code, sizeof(code), "%ld", (long)ui->favorite_stops[row].code);
    if (row == 0) {
      draw_home_favorite_row(ui, ctx, cell_layer, row, &ui->favorite_stops[row]);
    } else {
      static char subtitle[64];
      snprintf(subtitle, sizeof(subtitle), "favorite stop %s", code);
      draw_home_plain_row(ui, ctx, cell_layer, row, ui->favorite_stops[row].name, subtitle, ui_color_mint());
    }
  } else if (row == *ui->favorite_count) {
    draw_home_plain_row(ui, ctx, cell_layer, row, "Nearby", "closest stops around you", ui_color_cyan());
  } else if (row == *ui->favorite_count + 1) {
    draw_home_plain_row(ui, ctx, cell_layer, row, "Stop code", "manual lookup", ui_color_orange());
  }
}

static void draw_stop_code_row(BusPebbILUiState *ui, GContext *ctx, const Layer *cell_layer, uint16_t row) {
  static char title[64];
  static char subtitle[64];
  if (row < STOP_CODE_DIGITS) {
    snprintf(title, sizeof(title), "Digit %d", row + 1);
    snprintf(subtitle, sizeof(subtitle), "%d", ui->manual_digits[row]);
    draw_text_row(ui, ctx, cell_layer, row, title, subtitle);
  } else {
    snprintf(title, sizeof(title), "Open %05ld", (long)manual_stop_code(ui));
    draw_text_row(ui, ctx, cell_layer, row, title, "Fetch arrivals");
  }
}

static void draw_stop_row(BusPebbILUiState *ui, GContext *ctx, const Layer *cell_layer, uint16_t row, StopRow *stop) {
  static char subtitle[64];
  static char meta[16];
  if (stop->distance_m > 0) {
    snprintf(meta, sizeof(meta), "%ldm", (long)stop->distance_m);
    snprintf(subtitle, sizeof(subtitle), "stop %ld", (long)stop->code);
  } else {
    snprintf(meta, sizeof(meta), "%ld", (long)stop->code);
    snprintf(subtitle, sizeof(subtitle), "Stop %ld", (long)stop->code);
  }
  draw_nav_row(ui, ctx, cell_layer, row, stop->name, meta, subtitle);
}

static void draw_arrival_row(BusPebbILUiState *ui, GContext *ctx, const Layer *cell_layer, uint16_t row, ArrivalRow *arrival) {
  GRect bounds = layer_get_bounds(cell_layer);
  bool highlighted = menu_cell_layer_is_highlighted(cell_layer);
  int16_t safe_inset = round_row_inset(ui, row);
  int16_t left = safe_inset;
  int16_t right = bounds.size.w - safe_inset;
  draw_structured_row_base(ui, ctx, cell_layer, highlighted, safe_inset);

  static char minutes[16];
  if (arrival->minutes <= 0) {
    snprintf(minutes, sizeof(minutes), "Now");
  } else {
    snprintf(minutes, sizeof(minutes), "%ldm", (long)arrival->minutes);
  }

  if (arrival->flags & 1) {
    graphics_context_set_fill_color(ctx, ui_color_amber());
    graphics_fill_rect(ctx, GRect(6 + safe_inset, 5, 5, bounds.size.h - 8), 5, GCornersLeft);
  }

  GColor chip_color = highlighted ? ui_color_amber() : operator_chip_color(arrival->flags, arrival->line);
  graphics_context_set_fill_color(ctx, chip_color);
  graphics_fill_rect(ctx, GRect(left + ARRIVAL_CHIP_X, 11, 42, 26), 6, GCornersAll);
  graphics_context_set_text_color(ctx, ui_color_route_text(chip_color));
  GFont line_font = strlen(arrival->line) > 2 ? fonts_get_system_font(FONT_KEY_GOTHIC_24_BOLD) :
                                                fonts_get_system_font(FONT_KEY_GOTHIC_28_BOLD);
  graphics_draw_text(ctx, arrival->line, line_font,
                     GRect(left + ARRIVAL_CHIP_TEXT_X, strlen(arrival->line) > 2 ? 8 : 5, 38, 32), GTextOverflowModeTrailingEllipsis,
                     GTextAlignmentCenter, NULL);

  bool is_live = *ui->source == 1;
  GColor time_color = is_live ? ui_color_mint() : ui_color_ink();
  GFont time_font = fonts_get_system_font(FONT_KEY_GOTHIC_18_BOLD);
  graphics_context_set_text_color(ctx, ui_color_ink());
  int16_t time_x = right - ARRIVAL_TIME_W - 5;
  int16_t dest_x = left + ARRIVAL_DEST_X;
  int16_t dest_width = arrival_dest_width_for_screen(bounds.size.w, safe_inset);
  bool dest_rtl = ui_text_is_rtl(arrival->dest);
  graphics_draw_text(ctx, arrival_dest_text(arrival->dest, highlighted, dest_width),
                     fonts_get_system_font(FONT_KEY_GOTHIC_14),
                     GRect(dest_x, 15, dest_width, 18),
                     GTextOverflowModeTrailingEllipsis,
                     dest_rtl ? GTextAlignmentRight : GTextAlignmentLeft, NULL);
  graphics_context_set_text_color(ctx, time_color);
  graphics_draw_text(ctx, minutes, time_font,
                     GRect(time_x, 11, ARRIVAL_TIME_W, 24),
                     GTextOverflowModeTrailingEllipsis,
                     GTextAlignmentRight, NULL);
}

int16_t ui_screens_get_cell_height_callback(MenuLayer *menu_layer, MenuIndex *cell_index, void *data) {
  BusPebbILUiState *ui = data;
  if (*ui->loading) {
    return ROW_ARRIVAL_H;
  }
  if (*ui->screen == ScreenTutorial) {
    return layer_get_bounds(menu_layer_get_layer(menu_layer)).size.h;
  }
  if (*ui->screen == ScreenArrivals && *ui->arrival_count) return ROW_ARRIVAL_H;
  if (*ui->screen == ScreenHome || *ui->screen == ScreenNearby) return ROW_HOME_H;
  (void)cell_index;
  return ROW_COMPACT_H;
}

void ui_screens_draw_row_callback(GContext *ctx, const Layer *cell_layer, MenuIndex *cell_index, void *data) {
  BusPebbILUiState *ui = data;
  uint16_t row = cell_index->row;
  if (*ui->loading) {
    draw_loading_row(ui, ctx, cell_layer);
    return;
  }

  if (*ui->screen == ScreenHome) {
    draw_home_row(ui, ctx, cell_layer, row);
  } else if (*ui->screen == ScreenTutorial) {
    draw_tutorial_row(ui, ctx, cell_layer);
  } else if (*ui->screen == ScreenNearby) {
    if (!*ui->nearby_count) {
      draw_text_row(ui, ctx, cell_layer, row, "No nearby stops", "Try refresh");
    } else {
      draw_stop_row(ui, ctx, cell_layer, row, &ui->nearby_stops[row]);
    }
  } else if (*ui->screen == ScreenArrivals) {
    if (!*ui->arrival_count) {
      draw_text_row(ui, ctx, cell_layer, row, ui->notice[0] ? ui->notice : "No arrivals soon", "Select to refresh");
    } else {
      draw_arrival_row(ui, ctx, cell_layer, row, &ui->arrivals[row]);
    }
  } else if (*ui->screen == ScreenStopCode) {
    draw_stop_code_row(ui, ctx, cell_layer, row);
  } else if (*ui->screen == ScreenDebug) {
    if (!*ui->debug_count) {
      draw_text_row(ui, ctx, cell_layer, row, "No diagnostics", "Select to refresh");
    } else {
      draw_text_row(ui, ctx, cell_layer, row, ui->debug_lines[row], "");
    }
  }
}
