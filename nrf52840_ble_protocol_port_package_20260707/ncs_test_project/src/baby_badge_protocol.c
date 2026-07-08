#include "baby_badge_protocol.h"

#include <stdbool.h>
#include <stdio.h>
#include <string.h>


uint16_t bbp_crc16_ccitt_false(const uint8_t *data, size_t len)
{
    uint16_t crc = 0xFFFF;

    for (size_t i = 0; i < len; ++i) {
        crc ^= (uint16_t)data[i] << 8;
        for (uint8_t bit = 0; bit < 8; ++bit) {
            crc = (crc & 0x8000) ? (uint16_t)((crc << 1) ^ 0x1021) : (uint16_t)(crc << 1);
        }
    }

    return crc;
}


static bool fixed2(char *out, size_t out_len, int32_t centi)
{
    const bool negative = centi < 0;
    const uint32_t abs_value = negative ? (uint32_t)(-centi) : (uint32_t)centi;
    const int written = snprintf(
        out,
        out_len,
        "%s%lu.%02lu",
        negative ? "-" : "",
        (unsigned long)(abs_value / 100),
        (unsigned long)(abs_value % 100)
    );
    return written > 0 && (size_t)written < out_len;
}


static bool fixed1(char *out, size_t out_len, uint32_t tenth)
{
    const int written = snprintf(
        out,
        out_len,
        "%lu.%lu",
        (unsigned long)(tenth / 10),
        (unsigned long)(tenth % 10)
    );
    return written > 0 && (size_t)written < out_len;
}


static size_t wrap_with_crc(char *out, size_t out_len, int json_len)
{
    if (json_len <= 0 || (size_t)json_len >= out_len - 1) {
        return 0;
    }

    const uint16_t crc = bbp_crc16_ccitt_false((const uint8_t *)&out[1], (size_t)json_len);
    const int suffix_len = snprintf(&out[1 + json_len], out_len - 1 - (size_t)json_len, "*%04X\n", crc);
    if (suffix_len <= 0 || (size_t)suffix_len >= out_len - 1 - (size_t)json_len) {
        return 0;
    }

    return 1 + (size_t)json_len + (size_t)suffix_len;
}


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
)
{
    char temperature[16];
    char humidity[16];
    char alarms[48];

    if (!out || out_len < BBP_MIN_FRAME_BUFFER_SIZE || !posture || !device_status) {
        return 0;
    }
    if (!fixed2(temperature, sizeof(temperature), temperature_centi) ||
        !fixed1(humidity, sizeof(humidity), humidity_tenth)) {
        return 0;
    }

    if (alarm && alarm[0]) {
        const int alarms_len = snprintf(alarms, sizeof(alarms), "[\"%s\"]", alarm);
        if (alarms_len <= 0 || (size_t)alarms_len >= sizeof(alarms)) {
            return 0;
        }
    } else {
        strcpy(alarms, "[]");
    }

    out[0] = '@';
    const int json_len = snprintf(
        &out[1],
        out_len - 1,
        "{\"msg\":\"sample\",\"ver\":%d,\"seq\":%lu,\"uptime_ms\":%lu,"
        "\"temperature_c\":%s,\"humidity_pct\":%s,\"posture\":\"%s\","
        "\"battery_pct\":%u,\"device_status\":\"%s\",\"alarms\":%s}",
        BBP_VERSION,
        (unsigned long)seq,
        (unsigned long)uptime_ms,
        temperature,
        humidity,
        posture,
        (unsigned int)battery_pct,
        device_status,
        alarms
    );

    return wrap_with_crc(out, out_len, json_len);
}


size_t bbp_build_event_frame(
    char *out,
    size_t out_len,
    uint32_t seq,
    uint32_t event_id,
    uint32_t uptime_ms,
    const char *type,
    const char *level,
    const char *value
)
{
    if (!out || out_len < BBP_MIN_FRAME_BUFFER_SIZE || !type || !level || !value) {
        return 0;
    }

    out[0] = '@';
    const int json_len = snprintf(
        &out[1],
        out_len - 1,
        "{\"msg\":\"event\",\"ver\":%d,\"seq\":%lu,\"event_id\":%lu,"
        "\"uptime_ms\":%lu,\"type\":\"%s\",\"level\":\"%s\",\"value\":\"%s\"}",
        BBP_VERSION,
        (unsigned long)seq,
        (unsigned long)event_id,
        (unsigned long)uptime_ms,
        type,
        level,
        value
    );

    return wrap_with_crc(out, out_len, json_len);
}


bbp_command_t bbp_parse_command(const uint8_t *data, size_t len)
{
    if (!data) {
        return BBP_CMD_NONE;
    }

    while (len && (data[len - 1] == '\n' || data[len - 1] == '\r' || data[len - 1] == ' ')) {
        --len;
    }
    while (len && (*data == ' ' || *data == '\t')) {
        ++data;
        --len;
    }

    if (len == 5 && memcmp(data, "START", 5) == 0) {
        return BBP_CMD_START;
    }
    if (len == 4 && memcmp(data, "STOP", 4) == 0) {
        return BBP_CMD_STOP;
    }
    return BBP_CMD_NONE;
}
