#ifndef BABY_BADGE_PROTOCOL_H
#define BABY_BADGE_PROTOCOL_H

#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

#define BBP_VERSION 1
#define BBP_MIN_FRAME_BUFFER_SIZE 256

typedef enum {
    BBP_CMD_NONE = 0,
    BBP_CMD_START,
    BBP_CMD_STOP
} bbp_command_t;

uint16_t bbp_crc16_ccitt_false(const uint8_t *data, size_t len);

size_t bbp_build_sample_frame(
    char *out,
    size_t out_len,
    uint32_t seq,
    uint32_t uptime_ms,
    int16_t temperature_centi,
    uint16_t humidity_tenth,
    const char *posture,
    uint8_t battery_pct,
    const char *device_status,
    const char *alarm
);

size_t bbp_build_event_frame(
    char *out,
    size_t out_len,
    uint32_t seq,
    uint32_t event_id,
    uint32_t uptime_ms,
    const char *type,
    const char *level,
    const char *value
);

bbp_command_t bbp_parse_command(const uint8_t *data, size_t len);

#ifdef __cplusplus
}
#endif

#endif
