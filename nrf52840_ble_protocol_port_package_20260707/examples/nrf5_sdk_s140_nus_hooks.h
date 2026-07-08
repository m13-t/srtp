#ifndef NRF5_SDK_S140_NUS_HOOKS_H
#define NRF5_SDK_S140_NUS_HOOKS_H

#include <stdint.h>

#include "ble.h"

#ifdef __cplusplus
extern "C" {
#endif

void baby_badge_protocol_demo_init(void);
void baby_badge_on_nus_rx(uint8_t const *data, uint16_t len);
void baby_badge_on_ble_evt(ble_evt_t const *p_ble_evt, void *p_context);

#ifdef __cplusplus
}
#endif

#endif
