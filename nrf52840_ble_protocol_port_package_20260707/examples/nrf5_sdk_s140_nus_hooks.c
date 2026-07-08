#include <stdbool.h>
#include <stdint.h>
#include <string.h>

#include "app_timer.h"
#include "app_error.h"
#include "ble_nus.h"
#include "nrf_log.h"
#include "nrf_sdh_ble.h"
#include "baby_badge_protocol.h"
#include "nrf5_sdk_s140_nus_hooks.h"


#define SAMPLE_INTERVAL_TICKS APP_TIMER_TICKS(1000)
#define NUS_CHUNK_SIZE 20
#define TX_QUEUE_DEPTH 4

APP_TIMER_DEF(m_sample_timer);

extern ble_nus_t m_nus;
extern uint16_t m_conn_handle;

static bool s_monitoring;
static uint32_t s_seq;
static uint32_t s_event_id;
static uint32_t s_uptime_ms;
static uint32_t s_sample_count;
static uint8_t s_battery_pct = 96;
static char s_frame[BBP_MIN_FRAME_BUFFER_SIZE];
static char s_tx_queue[TX_QUEUE_DEPTH][BBP_MIN_FRAME_BUFFER_SIZE];
static size_t s_tx_len[TX_QUEUE_DEPTH];
static size_t s_tx_offset;
static uint8_t s_tx_head;
static uint8_t s_tx_tail;
static uint8_t s_tx_count;


static void nus_flush_pending(void)
{
    while (s_tx_count && m_conn_handle != BLE_CONN_HANDLE_INVALID) {
        uint16_t chunk = (uint16_t)(s_tx_len[s_tx_head] - s_tx_offset);
        if (chunk > NUS_CHUNK_SIZE) {
            chunk = NUS_CHUNK_SIZE;
        }

        ret_code_t err = ble_nus_data_send(&m_nus, (uint8_t *)&s_tx_queue[s_tx_head][s_tx_offset], &chunk, m_conn_handle);
        if (err == NRF_SUCCESS) {
            s_tx_offset += chunk;
            if (s_tx_offset == s_tx_len[s_tx_head]) {
                s_tx_head = (uint8_t)((s_tx_head + 1) % TX_QUEUE_DEPTH);
                --s_tx_count;
                s_tx_offset = 0;
            }
            continue;
        }
        if (err == NRF_ERROR_RESOURCES || err == NRF_ERROR_BUSY) {
            return;
        }
        if (err != NRF_ERROR_INVALID_STATE && err != NRF_ERROR_NOT_FOUND) {
            APP_ERROR_CHECK(err);
        }
        s_tx_head = (uint8_t)((s_tx_head + 1) % TX_QUEUE_DEPTH);
        --s_tx_count;
        s_tx_offset = 0;
    }
}


static bool nus_queue_frame(const char *frame, size_t len)
{
    if (!frame || !len || len >= BBP_MIN_FRAME_BUFFER_SIZE) {
        return false;
    }
    if (s_tx_count == TX_QUEUE_DEPTH) {
        NRF_LOG_WARNING("NUS TX queue full, frame skipped");
        return false;
    }

    memcpy(s_tx_queue[s_tx_tail], frame, len);
    s_tx_len[s_tx_tail] = len;
    s_tx_tail = (uint8_t)((s_tx_tail + 1) % TX_QUEUE_DEPTH);
    ++s_tx_count;
    nus_flush_pending();
    return true;
}


void baby_badge_on_ble_evt(ble_evt_t const *p_ble_evt, void *p_context)
{
    (void)p_context;

    if (!p_ble_evt) {
        return;
    }
    if (p_ble_evt->header.evt_id == BLE_GATTS_EVT_HVN_TX_COMPLETE) {
        nus_flush_pending();
    }
}


static const char *simulated_posture(uint32_t sample_count)
{
    switch ((sample_count / 20) % 4) {
        case 0: return "supine";
        case 1: return "side";
        case 2: return "prone";
        default: return "moving";
    }
}


static void send_sample(void)
{
    const int16_t temp_centi = (int16_t)(3640 + (int16_t)((s_sample_count % 16) - 8) * 3);
    const uint16_t humidity_tenth = (uint16_t)(580 + (s_sample_count % 20));
    const char *posture = simulated_posture(s_sample_count);
    const char *alarm = strcmp(posture, "prone") == 0 && (s_sample_count % 30) == 0 ? "prone_alarm" : "";

    const size_t len = bbp_build_sample_frame(
        s_frame,
        sizeof(s_frame),
        ++s_seq,
        s_uptime_ms,
        temp_centi,
        humidity_tenth,
        posture,
        s_battery_pct,
        s_monitoring ? "monitoring" : "idle",
        alarm
    );

    if (len) {
        nus_queue_frame(s_frame, len);
    }
}


static void send_repeated_event(const char *type, const char *value)
{
    const uint32_t event_id = ++s_event_id;

    for (uint8_t repeat = 0; repeat < 3; ++repeat) {
        const size_t len = bbp_build_event_frame(
            s_frame,
            sizeof(s_frame),
            ++s_seq,
            event_id,
            s_uptime_ms,
            type,
            "warning",
            value
        );
        if (len) {
            nus_queue_frame(s_frame, len);
        }
    }
}


static void sample_timer_handler(void *context)
{
    (void)context;

    if (!s_monitoring) {
        return;
    }

    s_uptime_ms += 1000;
    ++s_sample_count;
    if (s_sample_count && s_sample_count % 60 == 0 && s_battery_pct > 1) {
        --s_battery_pct;
    }

    send_sample();

    if (s_sample_count && s_sample_count % 30 == 0) {
        send_repeated_event("kick", "-2.1C");
    }
}


void baby_badge_protocol_demo_init(void)
{
    ret_code_t err = app_timer_create(&m_sample_timer, APP_TIMER_MODE_REPEATED, sample_timer_handler);
    APP_ERROR_CHECK(err);

    err = app_timer_start(m_sample_timer, SAMPLE_INTERVAL_TICKS, NULL);
    APP_ERROR_CHECK(err);
}


void baby_badge_on_nus_rx(uint8_t const *data, uint16_t len)
{
    switch (bbp_parse_command(data, len)) {
        case BBP_CMD_START:
            s_monitoring = true;
            NRF_LOG_INFO("Monitor start");
            break;

        case BBP_CMD_STOP:
            s_monitoring = false;
            NRF_LOG_INFO("Monitor stop");
            break;

        default:
            NRF_LOG_WARNING("Unknown command");
            break;
    }
}
