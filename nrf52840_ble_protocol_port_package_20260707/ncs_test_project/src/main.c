#include <errno.h>
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#include <zephyr/bluetooth/bluetooth.h>
#include <zephyr/bluetooth/conn.h>
#include <zephyr/bluetooth/hci.h>
#include <zephyr/kernel.h>
#include <zephyr/logging/log.h>
#include <zephyr/sys/util.h>
#include <bluetooth/services/nus.h>

#include "baby_badge_protocol.h"

LOG_MODULE_REGISTER(baby_badge_nus_test, LOG_LEVEL_INF);

#define DEVICE_NAME CONFIG_BT_DEVICE_NAME
#define DEVICE_NAME_LEN (sizeof(DEVICE_NAME) - 1)
#define SAMPLE_INTERVAL K_SECONDS(1)
#define NUS_CHUNK_SIZE 20
#define TX_RETRY_COUNT 20
#define TX_RETRY_DELAY K_MSEC(20)

static struct bt_conn *current_conn;
static bool monitoring;
static uint32_t seq;
static uint32_t event_id;
static uint32_t uptime_ms;
static uint32_t sample_count;
static uint8_t battery_pct = 96;
static char frame[BBP_MIN_FRAME_BUFFER_SIZE];

static const struct bt_data ad[] = {
    BT_DATA_BYTES(BT_DATA_FLAGS, (BT_LE_AD_GENERAL | BT_LE_AD_NO_BREDR)),
    BT_DATA(BT_DATA_NAME_COMPLETE, DEVICE_NAME, DEVICE_NAME_LEN),
};

static const struct bt_data sd[] = {
    BT_DATA_BYTES(BT_DATA_UUID128_ALL, BT_UUID_NUS_VAL),
};

static int advertising_start(void)
{
    int err = bt_le_adv_start(BT_LE_ADV_CONN_FAST_1, ad, ARRAY_SIZE(ad), sd, ARRAY_SIZE(sd));

    if (err == -EALREADY) {
        return 0;
    }
    if (err) {
        LOG_ERR("Advertising failed to start: %d", err);
        return err;
    }

    LOG_INF("Advertising as %s", DEVICE_NAME);
    return 0;
}

static void connected(struct bt_conn *conn, uint8_t err)
{
    if (err) {
        LOG_ERR("Connection failed: 0x%02x", err);
        return;
    }

    current_conn = bt_conn_ref(conn);
    monitoring = false;
    LOG_INF("Connected");
}

static void disconnected(struct bt_conn *conn, uint8_t reason)
{
    ARG_UNUSED(conn);
    ARG_UNUSED(reason);

    if (current_conn) {
        bt_conn_unref(current_conn);
        current_conn = NULL;
    }

    monitoring = false;
    LOG_INF("Disconnected: 0x%02x", reason);
    (void)advertising_start();
}

BT_CONN_CB_DEFINE(conn_callbacks) = {
    .connected = connected,
    .disconnected = disconnected,
};

static int nus_send_chunk(const uint8_t *data, uint16_t len)
{
    int err = -ENOTCONN;

    if (!current_conn) {
        return -ENOTCONN;
    }

    for (uint8_t attempt = 0; attempt < TX_RETRY_COUNT; ++attempt) {
        err = bt_nus_send(current_conn, data, len);
        if (!err) {
            return 0;
        }
        if (err != -ENOMEM && err != -EAGAIN && err != -EBUSY) {
            return err;
        }
        k_sleep(TX_RETRY_DELAY);
    }

    return err;
}

static int nus_send_frame(const char *data, size_t len)
{
    size_t offset = 0;

    while (offset < len) {
        uint16_t chunk_len = (uint16_t)MIN(len - offset, (size_t)NUS_CHUNK_SIZE);
        int err = nus_send_chunk((const uint8_t *)&data[offset], chunk_len);

        if (err) {
            LOG_WRN("NUS send failed at offset %u: %d", (unsigned int)offset, err);
            return err;
        }

        offset += chunk_len;
    }

    return 0;
}

static const char *simulated_posture(uint32_t count)
{
    switch ((count / 20) % 4) {
    case 0:
        return "supine";
    case 1:
        return "side";
    case 2:
        return "prone";
    default:
        return "moving";
    }
}

static void send_sample(void)
{
    int16_t temp_delta = (int16_t)((int32_t)(sample_count % 16) - 8);
    int16_t temperature_centi = (int16_t)(3640 + temp_delta * 3);
    uint16_t humidity_tenth = (uint16_t)(580 + (sample_count % 20));
    const char *posture = simulated_posture(sample_count);
    const char *alarm = (posture[0] == 'p' && (sample_count % 30) == 0) ? "prone_alarm" : "";
    size_t len = bbp_build_sample_frame(
        frame,
        sizeof(frame),
        ++seq,
        uptime_ms,
        temperature_centi,
        humidity_tenth,
        posture,
        battery_pct,
        monitoring ? "monitoring" : "idle",
        alarm
    );

    if (len) {
        (void)nus_send_frame(frame, len);
    }
}

static void send_repeated_event(const char *type, const char *value)
{
    uint32_t id = ++event_id;

    for (uint8_t repeat = 0; repeat < 3; ++repeat) {
        size_t len = bbp_build_event_frame(
            frame,
            sizeof(frame),
            ++seq,
            id,
            uptime_ms,
            type,
            "warning",
            value
        );

        if (len) {
            (void)nus_send_frame(frame, len);
        }
    }
}

static void sample_tick(void)
{
    if (!monitoring) {
        return;
    }

    uptime_ms += 1000;
    ++sample_count;

    if ((sample_count % 60) == 0 && battery_pct > 1) {
        --battery_pct;
    }

    send_sample();

    if ((sample_count % 30) == 0) {
        send_repeated_event("kick", "-2.1C");
    }
}

static void nus_received(struct bt_conn *conn, const uint8_t *const data, uint16_t len)
{
    ARG_UNUSED(conn);

    switch (bbp_parse_command(data, len)) {
    case BBP_CMD_START:
        monitoring = true;
        LOG_INF("Monitor start");
        break;

    case BBP_CMD_STOP:
        monitoring = false;
        LOG_INF("Monitor stop");
        break;

    default:
        LOG_WRN("Unknown command");
        break;
    }
}

static struct bt_nus_cb nus_callbacks = {
    .received = nus_received,
};

int main(void)
{
    int err = bt_enable(NULL);

    if (err) {
        LOG_ERR("Bluetooth init failed: %d", err);
        return err;
    }

    err = bt_nus_init(&nus_callbacks);
    if (err) {
        LOG_ERR("NUS init failed: %d", err);
        return err;
    }

    err = advertising_start();
    if (err) {
        return err;
    }

    LOG_INF("BabyBadge NUS protocol test is ready");

    while (true) {
        k_sleep(SAMPLE_INTERVAL);
        sample_tick();
    }

    return 0;
}
