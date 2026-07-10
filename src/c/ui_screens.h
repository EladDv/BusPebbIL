#pragma once

#include <pebble.h>

#include "BusPebbIL.h"

typedef struct {
  MenuLayer **menu_layer;
  AppScreen *screen;
  StopRow *favorite_stops;
  StopRow *nearby_stops;
  ArrivalRow *arrivals;
  RouteStopRow *route_stops;
  char (*debug_lines)[64];
  uint8_t *manual_digits;
  uint8_t *favorite_count;
  uint8_t *nearby_count;
  uint8_t *arrival_count;
  uint8_t *route_stop_count;
  uint8_t *route_current_index;
  uint8_t *debug_count;
  int32_t *selected_stop_code;
  char *selected_stop_name;
  char *route_line;
  uint8_t *source;
  char *notice;
  NoticeKind *notice_kind;
  uint8_t *tutorial_page;
  bool *loading;
  bool *debug_enabled;
} BusPebbILUiState;

void ui_screens_restart_marquee(BusPebbILUiState *ui);
void ui_screens_cancel_marquee(void);
void ui_screens_reset_marquee(void);

uint16_t ui_screens_get_num_sections_callback(MenuLayer *menu_layer, void *data);
uint16_t ui_screens_get_num_rows_callback(MenuLayer *menu_layer, uint16_t section_index, void *data);
int16_t ui_screens_get_header_height_callback(MenuLayer *menu_layer, uint16_t section_index, void *data);
void ui_screens_draw_header_callback(GContext *ctx, const Layer *cell_layer, uint16_t section_index, void *data);
int16_t ui_screens_get_cell_height_callback(MenuLayer *menu_layer, MenuIndex *cell_index, void *data);
void ui_screens_draw_row_callback(GContext *ctx, const Layer *cell_layer, MenuIndex *cell_index, void *data);
