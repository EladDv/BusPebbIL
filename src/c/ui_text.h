#pragma once

#include <pebble.h>
#include <stddef.h>

bool ui_text_fits_width(const char *text, GFont font, int16_t width, int16_t height);
bool ui_text_is_rtl(const char *text);
size_t ui_text_utf8_char_count(const char *text);
void ui_text_copy_utf8_range(char *dest, size_t dest_size, const char *text, size_t start_char, size_t char_count);
void ui_text_append_spaces(char *dest, size_t dest_size, uint8_t count);
uint8_t ui_text_visible_chars_for_width(const char *title, GFont font, int16_t width, int16_t height);
size_t ui_text_marquee_start(const char *title, uint8_t visible_chars, size_t phase);
