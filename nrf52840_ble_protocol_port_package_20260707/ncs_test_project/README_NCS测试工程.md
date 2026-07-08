# nRF Connect SDK 测试工程

这是一个完整的 nRF Connect SDK / Zephyr 应用工程，用于 nRF52840DK 直接烧录测试 BLE 协议链路。

工程默认行为：

- 广播设备名：`BabyBadge-NUS`
- 使用 Nordic UART Service
- 收到电脑端 `START\n` 后开始每秒发送模拟 `sample`
- 收到电脑端 `STOP\n` 后停止发送
- 每 30 秒模拟一次 `kick` 事件，并重复发送 3 次
- 不需要 SHT45、JY61P 或电池采样硬件

## 工程文件

```text
ncs_test_project
├─ CMakeLists.txt
├─ prj.conf
├─ sample.yaml
├─ include
│  └─ baby_badge_protocol.h
└─ src
   ├─ baby_badge_protocol.c
   └─ main.c
```

## 编译

建议先把 `ncs_test_project` 复制到纯英文路径，例如：

```text
D:\ncs_projects\baby_badge_nus_test
```

不建议直接在含中文的路径下构建，例如项目包所在的 `微光造物项目`、`发给nrf主程序同事...` 目录。nRF Connect SDK 本身一般能处理路径，但 VS Code 插件、Kconfig Language Server、Python 子进程在 Windows 中文路径下更容易出问题。

请在 nRF Connect SDK Toolchain 终端中进入本目录：

```bat
cd /d D:\ncs_projects\baby_badge_nus_test
west build -p always -b nrf52840dk_nrf52840 .
```

## 烧录

开发板连接电脑后执行：

```bat
west flash
```

也可以双击本目录下的：

```text
一键编译烧录_nrf52840dk.bat
```

如果中文文件名脚本在某些 Windows 环境里显示异常，请改用英文脚本：

```text
build_flash_nrf52840dk.cmd
```

这两个脚本内容等价。

如果提示找不到 `west`，说明当前命令行不是 nRF Connect SDK Toolchain 环境。请从 nRF Connect for Desktop 的 Toolchain Manager 里打开 SDK 终端，再运行脚本或命令。普通双击 Windows 命令行一般不会自动带上 `west` 的 PATH。

## VS Code 插件设置

使用 nRF Connect for VS Code 插件创建 Build Configuration 时：

```text
Application: ncs_test_project
Board: nrf52840dk_nrf52840
Base configuration: prj.conf
Extra configuration: 留空
Extra CMake arguments: 留空
```

不要把 `prj.conf` 放到 Extra configuration。它是这个应用的 Base configuration。

## Kconfig Language Server 报错

如果 VS Code 弹出：

```text
Kconfig Language Server cannot start for build 'build'
```

按下面顺序处理：

1. 先把工程复制到纯英文短路径，例如 `D:\ncs_projects\baby_badge_nus_test`。
2. VS Code 只打开 `ncs_test_project` 这个应用目录，不要打开压缩包根目录或上级中文目录。
3. 删除旧的 `build` 文件夹，或者在插件里选择 pristine/clean build。
4. 确认插件选择的是 nRF Connect SDK，不是纯 Zephyr SDK。
5. 在 nRF Connect SDK Toolchain 终端运行：

```bat
west build -p always -b nrf52840dk_nrf52840 .
```

判断结果：

- 如果命令行 `west build` 能过，只是 VS Code 的 Kconfig Language Server 报错，通常是插件语言服务缓存/路径问题；重启 VS Code 或重新创建 build configuration。
- 如果命令行 `west build` 也失败，以命令行里第一条 CMake/Kconfig 报错为准继续排查。

常见原因：

- 工程路径包含中文或特殊字符。
- `build` 目录是上一次失败配置留下的半成品。
- VS Code 打开的不是应用根目录，导致找不到 `CMakeLists.txt` / `prj.conf`。
- 没有从 nRF Connect SDK Toolchain 环境启动，`west`、Python 或 SDK 路径不对。
- 使用了纯 Zephyr 环境，找不到 nRF Connect SDK 的 `CONFIG_BT_NUS`。

## BT_LE_ADV_CONN 编译错误

如果旧包或手动改代码时遇到：

```text
'BT_LE_ADV_CONN' undeclared
```

请使用当前包里的新版 `src/main.c`。新版已经改为：

```c
bt_le_adv_start(BT_LE_ADV_CONN_FAST_1, ad, ARRAY_SIZE(ad), sd, ARRAY_SIZE(sd));
```

不要再使用 `BT_LE_ADV_CONN`。不同 NCS/Zephyr 版本对这个快捷宏支持不一致。

## 电脑端联调

1. 烧录本工程。
2. 启动电脑端联调包。
3. 网页扫描 BLE 设备。
4. 连接 `BabyBadge-NUS`。
5. 点击“开始监测”。
6. 页面应显示模拟温湿度、睡姿、电量、曲线。
7. 等待 30 秒左右，页面应出现一次 `疑似踢被` 事件。
8. 点击“停止并导出”，设备停止发送数据。

## 真实传感器接入

真实传感器接入时，只替换 `src/main.c` 中这些模拟值来源：

```c
temperature_centi
humidity_tenth
posture
battery_pct
send_repeated_event(...)
```

不要修改：

- BLE UUID
- `@<json>*<crc>\n` 帧格式
- CRC16-CCITT-FALSE 算法
- `START\n` / `STOP\n` 命令
- JSON 字段名和枚举字符串
