#include <stdio.h>
#include <string.h>

#include "baby_badge_protocol.h"


int main(void)
{
    char frame[BBP_MIN_FRAME_BUFFER_SIZE];
    size_t len;

    if (bbp_crc16_ccitt_false((const uint8_t *)"123456789", 9) != 0x29B1) {
        puts("CRC vector failed");
        return 1;
    }

    len = bbp_build_sample_frame(
        frame,
        sizeof(frame),
        12,
        53000,
        3650,
        582,
        "supine",
        87,
        "monitoring",
        ""
    );
    if (!len || frame[0] != '@' || frame[len - 1] != '\n' || strstr(frame, "\"msg\":\"sample\"") == NULL) {
        puts("sample frame failed");
        return 1;
    }

    len = bbp_build_event_frame(
        frame,
        sizeof(frame),
        13,
        3,
        54000,
        "kick",
        "warning",
        "-2.1C"
    );
    if (!len || frame[0] != '@' || frame[len - 1] != '\n' || strstr(frame, "\"msg\":\"event\"") == NULL) {
        puts("event frame failed");
        return 1;
    }

    if (bbp_parse_command((const uint8_t *)"START\n", 6) != BBP_CMD_START) {
        puts("START parse failed");
        return 1;
    }
    if (bbp_parse_command((const uint8_t *)"STOP\n", 5) != BBP_CMD_STOP) {
        puts("STOP parse failed");
        return 1;
    }

    puts("protocol smoke test passed");
    return 0;
}
