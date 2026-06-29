#include "ui_text.h"

#include <string.h>

bool ui_text_fits_width(const char *text, GFont font, int16_t width, int16_t height) {
  if (!text || !text[0]) return true;
  GSize size = graphics_text_layout_get_content_size(text, font, GRect(0, 0, 1000, height),
                                                     GTextOverflowModeTrailingEllipsis,
                                                     GTextAlignmentLeft);
  return size.w <= width;
}

static size_t utf8_next_offset(const char *text, size_t offset) {
  unsigned char c = (unsigned char)text[offset];
  size_t step = 1;
  if ((c & 0x80) == 0) step = 1;
  else if ((c & 0xE0) == 0xC0) step = 2;
  else if ((c & 0xF0) == 0xE0) step = 3;
  else if ((c & 0xF8) == 0xF0) step = 4;
  while (step > 1 && text[offset + step - 1] == '\0') {
    step -= 1;
  }
  return offset + step;
}

size_t ui_text_utf8_char_count(const char *text) {
  if (!text) return 0;
  size_t count = 0;
  for (size_t offset = 0; text[offset]; offset = utf8_next_offset(text, offset)) {
    count += 1;
  }
  return count;
}

static size_t utf8_byte_offset_for_char(const char *text, size_t char_index) {
  size_t offset = 0;
  for (size_t count = 0; text[offset] && count < char_index; count += 1) {
    offset = utf8_next_offset(text, offset);
  }
  return offset;
}

static void append_utf8_char(char *dest, size_t dest_size, size_t *written, const char *text, size_t char_index) {
  if (*written >= dest_size - 1) return;
  size_t start = utf8_byte_offset_for_char(text, char_index);
  if (!text[start]) return;
  size_t end = utf8_next_offset(text, start);
  size_t len = end - start;
  if (*written + len >= dest_size) return;
  memcpy(dest + *written, text + start, len);
  *written += len;
  dest[*written] = '\0';
}

void ui_text_copy_utf8_range(char *dest, size_t dest_size, const char *text, size_t start_char, size_t char_count) {
  size_t written = 0;
  dest[0] = '\0';
  for (size_t i = 0; i < char_count; i += 1) {
    append_utf8_char(dest, dest_size, &written, text, start_char + i);
  }
}

void ui_text_append_spaces(char *dest, size_t dest_size, uint8_t count) {
  size_t written = strlen(dest);
  while (count && written + 1 < dest_size) {
    dest[written++] = ' ';
    dest[written] = '\0';
    count -= 1;
  }
}

static uint32_t utf8_codepoint_at(const char *text, size_t *offset) {
  unsigned char c = (unsigned char)text[*offset];
  uint32_t codepoint = c;
  size_t next = utf8_next_offset(text, *offset);
  if ((c & 0xE0) == 0xC0 && text[*offset + 1]) {
    codepoint = ((uint32_t)(c & 0x1F) << 6) | ((uint32_t)((unsigned char)text[*offset + 1] & 0x3F));
  } else if ((c & 0xF0) == 0xE0 && text[*offset + 2]) {
    codepoint = ((uint32_t)(c & 0x0F) << 12) |
                ((uint32_t)((unsigned char)text[*offset + 1] & 0x3F) << 6) |
                ((uint32_t)((unsigned char)text[*offset + 2] & 0x3F));
  } else if ((c & 0xF8) == 0xF0 && text[*offset + 3]) {
    codepoint = ((uint32_t)(c & 0x07) << 18) |
                ((uint32_t)((unsigned char)text[*offset + 1] & 0x3F) << 12) |
                ((uint32_t)((unsigned char)text[*offset + 2] & 0x3F) << 6) |
                ((uint32_t)((unsigned char)text[*offset + 3] & 0x3F));
  }
  *offset = next;
  return codepoint;
}

bool ui_text_is_rtl(const char *text) {
  if (!text) return false;
  for (size_t offset = 0; text[offset];) {
    uint32_t codepoint = utf8_codepoint_at(text, &offset);
    if ((codepoint >= 0x0590 && codepoint <= 0x08FF) ||
        (codepoint >= 0xFB1D && codepoint <= 0xFDFF) ||
        (codepoint >= 0xFE70 && codepoint <= 0xFEFF)) {
      return true;
    }
  }
  return false;
}

uint8_t ui_text_visible_chars_for_width(const char *title, GFont font, int16_t width, int16_t height) {
  size_t total = ui_text_utf8_char_count(title);
  static char candidate[64];
  for (size_t keep = total; keep > 0; keep -= 1) {
    ui_text_copy_utf8_range(candidate, sizeof(candidate), title, 0, keep);
    if (ui_text_fits_width(candidate, font, width, height)) return keep;
  }
  return 1;
}

size_t ui_text_marquee_start(const char *title, uint8_t visible_chars, size_t phase) {
  size_t total = ui_text_utf8_char_count(title);
  if (visible_chars >= total) return 0;
  size_t max_offset = total - visible_chars;
  return phase > max_offset ? max_offset : phase;
}
