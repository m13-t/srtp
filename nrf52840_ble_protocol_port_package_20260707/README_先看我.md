# nRF52840 BLE 协议移植包

这个包发给 nRF52840 主程序开发同事使用。目标是把 nRF52840 开发板通过 Nordic UART Service 向电脑端 Python 后端发送带 CRC 的 JSON 数据帧。

## 如果只是想先烧板测试

直接使用完整 nRF Connect SDK 测试工程：

```text
ncs_test_project
```

在 nRF Connect SDK Toolchain 终端中进入该目录后执行：

```bat
west build -p always -b nrf52840dk_nrf52840 .
west flash
```

也可以双击：

```text
ncs_test_project\一键编译烧录_nrf52840dk.bat
```

烧录后设备广播名是 `BabyBadge-NUS`，不需要真实传感器，收到电脑端 `START\n` 后会发送模拟温湿度、睡姿、电量和事件。

## 你需要直接放进工程的文件

必须加入主工程：

```text
include/baby_badge_protocol.h
src/baby_badge_protocol.c
```

这两个文件只负责：

- 生成 `sample` 数据帧。
- 生成 `event` 事件帧。
- 计算 CRC16-CCITT-FALSE。
- 解析电脑端下发的 `START\n` / `STOP\n` 命令。

可选参考：

```text
examples/nrf5_sdk_s140_nus_hooks.h
examples/nrf5_sdk_s140_nus_hooks.c
tests/protocol_host_smoke_test.c
ncs_test_project
```

`examples` 里的两个文件是 nRF5 SDK + S140 + Nordic UART Service 的接入示例。不要盲目原样覆盖你的主程序；里面的 `m_nus`、`m_conn_handle`、BLE 事件分发、timer 初始化名称可能和你的工程不同。按里面的逻辑合入即可。

`tests/protocol_host_smoke_test.c` 是电脑端 C 语法和协议函数 smoke test，不需要放进固件工程。

`ncs_test_project` 是完整 nRF Connect SDK 测试工程，可以直接用于 nRF52840DK 编译烧录。

## 推荐阅读顺序

1. `docs/移植操作说明.md`
2. `docs/协议字段与联调检查清单.md`
3. `include/baby_badge_protocol.h`
4. `examples/nrf5_sdk_s140_nus_hooks.c`

## 电脑端协议

BLE 使用 Nordic UART Service：

```text
Service:  6E400001-B5A3-F393-E0A9-E50E24DCCA9E
Write/RX: 6E400002-B5A3-F393-E0A9-E50E24DCCA9E
Notify/TX:6E400003-B5A3-F393-E0A9-E50E24DCCA9E
```

上行帧：

```text
@<json_payload>*<crc16>\n
```

下行命令：

```text
START\n
STOP\n
```

## 第一阶段联调目标

先不要接真实传感器也可以。主程序先用模拟数据每秒发送一条 `sample`，电脑端页面能显示温度、湿度、睡姿、电量和曲线后，再替换真实数据源。

真实数据接入时只替换：

- SHT45 -> `temperature_centi`、`humidity_tenth`
- JY61P -> `posture`
- 电池采样 -> `battery_pct`
- 报警算法 -> `bbp_build_event_frame(...)`

BLE UUID、帧格式、CRC 和电脑端后端不需要改。
