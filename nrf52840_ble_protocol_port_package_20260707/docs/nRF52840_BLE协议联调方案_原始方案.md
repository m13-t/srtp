# nRF52840 BLE 协议联调版方案

## Summary

第一版目标是跑通 `nRF52840 开发板 -> BLE -> Python Bleak 后端 -> 网页上位机` 的实机链路。即使 nRF52840 端数据来源暂时是模拟数据，也由单片机通过 BLE 发出，前后端新版本不再使用内置 mock 数据源作为主流程。

协议采用 Nordic UART Service，载荷为带 CRC 的 JSON 行。上行覆盖周期样本、报警事件；下行先只支持 `START` / `STOP`。

## Protocol Contract

- BLE UUID 沿用现有后端默认值：
  - Service: `6E400001-B5A3-F393-E0A9-E50E24DCCA9E`
  - Write/RX: `6E400002-B5A3-F393-E0A9-E50E24DCCA9E`
  - Notify/TX: `6E400003-B5A3-F393-E0A9-E50E24DCCA9E`
- 上行帧格式：

```text
@<json_payload>*<crc16>\n
```

- `crc16` 使用 CRC16-CCITT-FALSE，参数为 `poly=0x1021`、`init=0xFFFF`，输出 4 位大写十六进制。
- CRC 计算范围只包含 `<json_payload>` 的 UTF-8 字节，不包含 `@`、`*`、CRC 字符和换行。
- `sample` 每 1 秒发送一条，用于实时卡片和曲线。
- `event` 只在事件发生时发送；关键事件连续重复 3 次，每次使用新的 `seq`，但保持相同 `event_id`，后端按 `event_id + type` 去重。
- 下行命令保持简单：`START\n`、`STOP\n`。

## Data Fields

`sample` 字段：

```json
{"msg":"sample","ver":1,"seq":12,"uptime_ms":53000,"temperature_c":36.5,"humidity_pct":58.2,"posture":"supine","battery_pct":87,"device_status":"normal","alarms":[]}
```

`event` 字段：

```json
{"msg":"event","ver":1,"seq":13,"event_id":3,"uptime_ms":54000,"type":"kick","level":"warning","value":"-2.1C"}
```

枚举映射：

- `posture`: `supine`=正睡, `side`=侧卧, `prone`=趴睡, `moving`=运动中, `invalid`=数据异常
- `event.type`: `kick`=疑似踢被, `low_temp`=低温预警, `prone_alarm`=持续趴睡, `low_battery`=电量过低, `sensor_error`=传感器异常
- `device_status`: `normal`, `idle`, `monitoring`, `sensor_error`, `low_battery`

后端接收时补充系统时间戳；nRF52840 不要求具备 RTC，只上报 `uptime_ms`。设备侧 `seq` 保存为 `device_seq`，后端 REST 轮询仍使用自己的递增 `seq`。

## Implementation Changes

- 新建对应版本目录，保留原版本不覆盖：
  - `04_网页程序\前段代码\nrf52840_BLE协议联调版`
  - `04_网页程序\后端代码\nrf52840_BLE协议联调版`
- 新版本前端不再显示“启动 Mock 测试”作为主功能，设备连接、开始监测、停止监测仍调用现有 REST API。
- 新版本后端不再把 mock 设备插入 BLE 扫描结果，不再自动启动 `MockSource`。
- `parser.py` 支持 `@json*crc16` 帧校验、枚举映射、事件帧生成，并保留旧 `{...}\n` JSON 行解析作为测试兼容路径。
- `state.py` 检测 `device_seq` 跳号并写日志，按 `device_event_id + type` 去重重复事件。
- nRF52840 端先搭最小 NUS 外设框架，先用板端模拟数据源生成温湿度、睡姿、电量和事件。

## Test Plan

- CRC 测试：合法 CRC 正常入库；错误 CRC 被丢弃并记录日志。
- 分片测试：强制按 20 字节 Notify 分片，后端必须等到 `\n` 后再校验和解析。
- START/STOP 测试：`START` 后 nRF52840 每秒上报；`STOP` 后停止上报但保持 BLE 连接。
- 事件可靠性测试：同一 `event_id` 重复发送 3 次，网页事件列表只显示一次。
- 序号测试：后端发现 `device_seq` 跳号时写日志，不阻塞后续数据。
- 版本隔离测试：原前端、原后端目录保持可运行，新联调版在新目录内运行。
- 实机联调：nRF52840 模拟数据上屏后，再接入 SHT45/JY61P 真实数据，确认字段和网页显示不变。

## Assumptions

- 第一版不做完整 ACK/重传协议；样本丢一帧可接受，事件通过重复发送和去重提高可靠性。
- 第一版不做参数配置下发；阈值、采样间隔、趴睡持续时间先写在固件侧。
- 第一版不做二进制协议；JSON + CRC 跑稳后再评估是否需要升级。
