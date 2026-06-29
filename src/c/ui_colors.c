#include "ui_colors.h"

static bool s_dark_mode;

void ui_colors_set_dark_mode(bool dark_mode) {
  s_dark_mode = dark_mode;
}

GColor ui_color_blue(void) {
#ifdef PBL_COLOR
  return GColorFromHEX(0x0057B8);
#else
  return s_dark_mode ? GColorWhite : GColorBlack;
#endif
}

GColor ui_color_mint(void) {
#ifdef PBL_COLOR
  return GColorFromHEX(0x00A86B);
#else
  return s_dark_mode ? GColorWhite : GColorBlack;
#endif
}

GColor ui_color_amber(void) {
#ifdef PBL_COLOR
  return GColorFromHEX(0xFFB000);
#else
  return s_dark_mode ? GColorWhite : GColorBlack;
#endif
}

GColor ui_color_orange(void) {
#ifdef PBL_COLOR
  return GColorFromHEX(0xF26419);
#else
  return s_dark_mode ? GColorWhite : GColorBlack;
#endif
}

GColor ui_color_cyan(void) {
#ifdef PBL_COLOR
  return GColorFromHEX(0x00A6ED);
#else
  return s_dark_mode ? GColorWhite : GColorBlack;
#endif
}

GColor ui_color_magenta(void) {
#ifdef PBL_COLOR
  return GColorFromHEX(0xB5179E);
#else
  return s_dark_mode ? GColorWhite : GColorBlack;
#endif
}

GColor ui_color_red(void) {
#ifdef PBL_COLOR
  return GColorFromHEX(0xD7263D);
#else
  return s_dark_mode ? GColorWhite : GColorBlack;
#endif
}

GColor ui_color_deep_blue(void) {
#ifdef PBL_COLOR
  return GColorFromHEX(0x003E7E);
#else
  return s_dark_mode ? GColorWhite : GColorBlack;
#endif
}

GColor ui_color_egged_green(void) {
#ifdef PBL_COLOR
  return GColorFromHEX(0x0B8F3A);
#else
  return s_dark_mode ? GColorWhite : GColorBlack;
#endif
}

GColor ui_color_kavim_green(void) {
#ifdef PBL_COLOR
  return GColorFromHEX(0x8BB836);
#else
  return s_dark_mode ? GColorWhite : GColorBlack;
#endif
}

GColor ui_color_afikim_blue(void) {
#ifdef PBL_COLOR
  return GColorFromHEX(0x0085C5);
#else
  return s_dark_mode ? GColorWhite : GColorBlack;
#endif
}

GColor ui_color_tnufa_teal(void) {
#ifdef PBL_COLOR
  return GColorFromHEX(0x0F7AAD);
#else
  return s_dark_mode ? GColorWhite : GColorBlack;
#endif
}

GColor ui_color_paper(void) {
  return s_dark_mode ? GColorBlack : GColorWhite;
}

GColor ui_color_ink(void) {
#ifdef PBL_COLOR
  return s_dark_mode ? GColorWhite : GColorFromHEX(0x102A43);
#else
  return s_dark_mode ? GColorWhite : GColorBlack;
#endif
}

GColor ui_color_soft(void) {
#ifdef PBL_COLOR
  return s_dark_mode ? GColorFromHEX(0x14212E) : GColorFromHEX(0xF0F5F8);
#else
  return s_dark_mode ? GColorBlack : GColorWhite;
#endif
}

GColor ui_color_muted(void) {
#ifdef PBL_COLOR
  return s_dark_mode ? GColorFromHEX(0x9FB3C8) : GColorFromHEX(0x52616B);
#else
  return ui_color_ink();
#endif
}

GColor ui_color_accent_text(void) {
#ifdef PBL_COLOR
  return GColorWhite;
#else
  return s_dark_mode ? GColorBlack : GColorWhite;
#endif
}

GColor ui_color_route_text(GColor fill) {
#ifdef PBL_COLOR
  return gcolor_equal(fill, ui_color_amber()) ? GColorBlack : GColorWhite;
#else
  return s_dark_mode ? GColorBlack : GColorWhite;
#endif
}
