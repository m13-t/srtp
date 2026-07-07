(function () {
  "use strict";

  const DEFAULT_CHART_HEIGHT = 260;
  const API_BASE = location.protocol === "file:" ? "http://127.0.0.1:8000" : "";
  const POLL_MS = 1000;
  const STATUS_TEXT = {
    normal: "正常",
    disconnected: "断连",
    timeout: "数据超时",
    data_timeout: "数据超时",
    low_battery: "低电量",
    sensor_error: "传感器异常",
    error: "异常",
  };

  const $ = (id) => document.getElementById(id);

  const els = {
    backendState: $("backendState"),
    modeLabel: $("modeLabel"),
    refreshTime: $("refreshTime"),
    modeBle: $("modeBle"),
    modeSerial: $("modeSerial"),
    blePanel: $("blePanel"),
    serialPanel: $("serialPanel"),
    btnScanBle: $("btnScanBle"),
    bleDeviceSelect: $("bleDeviceSelect"),
    btnBleConnect: $("btnBleConnect"),
    btnBleDisconnect: $("btnBleDisconnect"),
    bleDeviceName: $("bleDeviceName"),
    bleDeviceId: $("bleDeviceId"),
    bleRssi: $("bleRssi"),
    baud: $("baud"),
    btnSerialConnect: $("btnSerialConnect"),
    serialSupport: $("serialSupport"),
    metricTemp: $("metricTemp"),
    metricHumidity: $("metricHumidity"),
    metricPosture: $("metricPosture"),
    metricBattery: $("metricBattery"),
    metricStatus: $("metricStatus"),
    alarmBanner: $("alarmBanner"),
    chartMetric: $("chartMetric"),
    maxPoints: $("maxPoints"),
    btnStart: $("btnStart"),
    btnStop: $("btnStop"),
    btnClear: $("btnClear"),
    statSession: $("statSession"),
    statSamples: $("statSamples"),
    statSource: $("statSource"),
    eventList: $("eventList"),
    logBox: $("logBox"),
    canvas: $("chart"),
  };

  const ctx = els.canvas.getContext("2d");

  const state = {
    mode: "ble",
    backendOk: false,
    connected: false,
    measuring: false,
    source: "",
    selectedDeviceId: "",
    device: null,
    bleDevices: [],
    serialPort: null,
    serialReader: null,
    serialTextBuffer: "",
    sessionSamples: [],
    plotSamples: [],
    events: [],
    lastSampleSeq: 0,
    lastEventSeq: 0,
    lastLogSeq: 0,
    localSeq: 1,
    pollTimer: null,
    sessionStartedAt: "",
    latestSample: null,
  };

  function nowText() {
    return new Date().toLocaleTimeString();
  }

  function stampRefresh() {
    els.refreshTime.textContent = nowText();
  }

  function log(message, level) {
    const div = document.createElement("div");
    div.className =
      "log-entry" +
      (level === "error" ? " error" : level === "warn" ? " warn" : "");
    div.textContent = `[${nowText()}] ${message}`;
    els.logBox.appendChild(div);
    els.logBox.scrollTop = els.logBox.scrollHeight;
  }

  function setBackendState(ok) {
    state.backendOk = ok;
    els.backendState.textContent = ok ? "Python 后端正常" : "Python 后端未连接";
    els.backendState.className = ok ? "state-ok" : "state-bad";
  }

  function labelStatus(status) {
    return STATUS_TEXT[status] || status || "未连接";
  }

  function numeric(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function getMaxPoints() {
    return Math.max(50, parseInt(els.maxPoints.value, 10) || 600);
  }

  function normalizeAlarms(value) {
    if (!value) return [];
    if (Array.isArray(value)) return value.filter(Boolean).map(String);
    return [String(value)];
  }

  function normalizeSample(raw, source) {
    const sample = {
      seq: Number.isFinite(Number(raw.seq))
        ? Number(raw.seq)
        : state.localSeq++,
      timestamp: raw.timestamp || raw.time || new Date().toISOString(),
      source,
      temperature_c: numeric(
        raw.temperature_c ?? raw.temperature ?? raw.temp_c ?? raw.temp,
      ),
      humidity_pct: numeric(raw.humidity_pct ?? raw.humidity ?? raw.rh),
      posture: raw.posture || raw.pose || raw.sleep_posture || "--",
      battery_pct: numeric(raw.battery_pct ?? raw.battery ?? raw.batt),
      rssi: numeric(raw.rssi ?? state.device?.rssi),
      device_status: raw.device_status || raw.status || "normal",
      alarms: normalizeAlarms(raw.alarms || raw.alarm || raw.event),
    };
    return sample;
  }

  function normalizeEvent(raw) {
    return {
      seq: Number.isFinite(Number(raw.seq))
        ? Number(raw.seq)
        : state.localSeq++,
      timestamp: raw.timestamp || raw.time || new Date().toISOString(),
      type: raw.type || raw.event_type || "事件",
      message: raw.message || raw.detail || "",
      level: raw.level || "warning",
      value: raw.value ?? raw.trigger_value ?? "",
    };
  }

  function formatTime(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime())
      ? String(value || "--")
      : date.toLocaleTimeString();
  }

  function updateMetrics(sample) {
    if (!sample) return;
    els.metricTemp.textContent =
      sample.temperature_c === null
        ? "-- °C"
        : `${sample.temperature_c.toFixed(1)} °C`;
    els.metricHumidity.textContent =
      sample.humidity_pct === null
        ? "-- %RH"
        : `${sample.humidity_pct.toFixed(1)} %RH`;
    els.metricPosture.textContent = sample.posture || "--";
    els.metricBattery.textContent =
      sample.battery_pct === null
        ? "-- %"
        : `${Math.round(sample.battery_pct)} %`;
    els.metricStatus.textContent = labelStatus(sample.device_status);
    els.statSource.textContent = sample.source || "--";
    if (sample.rssi !== null) els.bleRssi.textContent = `${sample.rssi} dBm`;
    showAlarm(sample.alarms, sample.device_status);
    stampRefresh();
  }

  function showAlarm(alarms, status) {
    const statusAlarm =
      status && status !== "normal" ? labelStatus(status) : "";
    const text = alarms.length ? alarms.join("；") : statusAlarm;
    els.alarmBanner.textContent = text ? `报警提示：${text}` : "";
    els.alarmBanner.classList.toggle("is-hidden", !text);
  }

  function ingestSample(sample) {
    state.latestSample = sample;
    state.lastSampleSeq = Math.max(state.lastSampleSeq, sample.seq);
    updateMetrics(sample);
    if (!state.measuring) return;

    state.sessionSamples.push(sample);
    state.plotSamples.push(sample);
    while (state.plotSamples.length > getMaxPoints()) state.plotSamples.shift();
    els.statSamples.textContent = state.sessionSamples.length;
  }

  function renderEvents() {
    if (!state.events.length) {
      els.eventList.innerHTML = '<div class="empty-row">暂无事件</div>';
      return;
    }
    els.eventList.innerHTML = state.events
      .slice(-30)
      .reverse()
      .map((event) => {
        const cls =
          event.level === "danger" || event.level === "error"
            ? "danger"
            : "warning";
        return `<div class="event-row ${cls}">
            <span>${formatTime(event.timestamp)}</span>
            <strong>${escapeHtml(event.type)}</strong>
            <span>${escapeHtml(event.message)}</span>
            <span>${escapeHtml(String(event.value ?? ""))}</span>
        </div>`;
      })
      .join("");
  }

  function ingestEvents(events) {
    for (const raw of events) {
      const event = normalizeEvent(raw);
      state.lastEventSeq = Math.max(state.lastEventSeq, event.seq);
      state.events.push(event);
      els.alarmBanner.textContent = `报警提示：${event.type}${event.message ? "：" + event.message : ""}`;
      els.alarmBanner.classList.remove("is-hidden");
    }
    renderEvents();
  }

  function escapeHtml(value) {
    return value.replace(
      /[&<>"']/g,
      (ch) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[ch],
    );
  }

  function updateConnectionUi() {
    const isBle = state.mode === "ble";
    els.modeLabel.textContent = isBle ? "BLE 蓝牙" : "串口调试";
    els.modeBle.classList.toggle("active", isBle);
    els.modeSerial.classList.toggle("active", !isBle);
    els.blePanel.classList.toggle("is-hidden", !isBle);
    els.serialPanel.classList.toggle("is-hidden", isBle);

    els.btnBleConnect.disabled =
      !isBle || state.connected || !els.bleDeviceSelect.value;
    els.btnBleDisconnect.disabled = !isBle || !state.connected;
    els.btnScanBle.disabled = !isBle || state.connected;

    const serialAvailable = "serial" in navigator;
    els.btnSerialConnect.disabled = isBle || !serialAvailable;
    els.btnSerialConnect.textContent =
      state.connected && state.source === "serial" ? "断开串口" : "连接串口";
    els.btnSerialConnect.classList.toggle(
      "connected",
      state.connected && state.source === "serial",
    );
    els.serialSupport.textContent = serialAvailable
      ? "串口调试用于 PCB 阶段 JSON 行数据接入。"
      : "当前浏览器不支持 Web Serial，请使用 Chrome 或 Edge。";

    els.btnStart.disabled = !state.connected || state.measuring;
    els.btnStop.disabled = !state.measuring;
    els.statSession.textContent = state.measuring
      ? "监测中"
      : state.sessionStartedAt
        ? "已停止"
        : "未开始";
    els.metricStatus.textContent = state.connected
      ? labelStatus(state.latestSample?.device_status || "normal")
      : "未连接";
  }

  function setMode(mode) {
    if (state.connected) {
      log("请先断开当前连接，再切换连接方式。", "warn");
      return;
    }
    state.mode = mode;
    updateConnectionUi();
  }

  async function requestJson(path, options) {
    const res = await fetch(API_BASE + path, {
      headers: { "Content-Type": "application/json" },
      ...options,
    });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return res.json();
  }

  async function postJson(path, body) {
    return requestJson(path, {
      method: "POST",
      body: JSON.stringify(body || {}),
    });
  }

  async function checkBackend() {
    try {
      await requestJson("/api/health");
      setBackendState(true);
    } catch (error) {
      setBackendState(false);
      if (state.mode === "ble")
        log(`Python 后端不可用：${error.message}`, "warn");
    }
  }

  function renderBleDevices(devices) {
    state.bleDevices = devices;
    els.bleDeviceSelect.innerHTML = devices.length
      ? devices
          .map((device) => {
            const id = device.id || device.address || device.name;
            const label = `${device.name || "未命名设备"} | ${id || "--"} | RSSI ${device.rssi ?? "--"}`;
            return `<option value="${escapeHtml(String(id || ""))}">${escapeHtml(label)}</option>`;
          })
          .join("")
      : '<option value="">未发现设备</option>';
    els.bleDeviceSelect.dispatchEvent(new Event("change"));
    updateConnectionUi();
  }

  async function scanBle() {
    try {
      await checkBackend();
      const data = await postJson("/api/ble/scan");
      renderBleDevices(data.devices || []);
      log(`BLE 扫描完成，发现 ${(data.devices || []).length} 个设备。`);
    } catch (error) {
      renderBleDevices([]);
      log(`BLE 扫描失败：${error.message}`, "error");
    }
  }

  async function connectBle() {
    const deviceId = els.bleDeviceSelect.value;
    if (!deviceId) return;
    try {
      const data = await postJson("/api/ble/connect", { device_id: deviceId });
      state.connected = Boolean(data.connected ?? true);
      state.source = "ble";
      state.device = data.device ||
        state.bleDevices.find(
          (device) => (device.id || device.address || device.name) === deviceId,
        ) || { id: deviceId };
      els.bleDeviceName.textContent = state.device.name || "--";
      els.bleDeviceId.textContent =
        state.device.id || state.device.address || deviceId;
      els.bleRssi.textContent =
        state.device.rssi === undefined ? "--" : `${state.device.rssi} dBm`;
      log(`BLE 已连接：${els.bleDeviceId.textContent}`);
    } catch (error) {
      state.connected = false;
      log(`BLE 连接失败：${error.message}`, "error");
    }
    updateConnectionUi();
  }

  async function disconnectBle() {
    try {
      await postJson("/api/ble/disconnect");
      log("BLE 已断开。");
    } catch (error) {
      log(`BLE 断开请求失败：${error.message}`, "error");
    }
    resetConnection();
  }

  function resetConnection() {
    state.connected = false;
    state.measuring = false;
    state.source = "";
    state.device = null;
    els.bleDeviceName.textContent = "--";
    els.bleDeviceId.textContent = "--";
    els.bleRssi.textContent = "--";
    updateConnectionUi();
  }

  async function connectSerial() {
    if (state.connected && state.source === "serial") {
      await disconnectSerial();
      return;
    }
    if (!("serial" in navigator)) {
      log("当前浏览器不支持 Web Serial。", "error");
      return;
    }
    try {
      state.serialPort = await navigator.serial.requestPort();
      await state.serialPort.open({
        baudRate: parseInt(els.baud.value, 10),
        dataBits: 8,
        parity: "none",
        stopBits: 1,
      });
      state.connected = true;
      state.source = "serial";
      state.device = { name: "串口调试设备", id: `baud-${els.baud.value}` };
      log(`串口已连接，波特率 ${els.baud.value}。`);
      readSerialLoop();
    } catch (error) {
      log(`串口连接失败：${error.message}`, "error");
    }
    updateConnectionUi();
  }

  async function disconnectSerial() {
    state.measuring = false;
    try {
      if (state.serialReader) {
        await state.serialReader.cancel();
        state.serialReader = null;
      }
      if (state.serialPort) {
        await state.serialPort.close();
        state.serialPort = null;
      }
    } catch (error) {
      log(`串口断开异常：${error.message}`, "warn");
    }
    log("串口已断开。");
    resetConnection();
  }

  async function writeSerialCommand(command) {
    if (!state.serialPort?.writable) return;
    const writer = state.serialPort.writable.getWriter();
    try {
      await writer.write(new TextEncoder().encode(command + "\n"));
    } catch (error) {
      log(`串口命令发送失败：${error.message}`, "error");
    } finally {
      writer.releaseLock();
    }
  }

  async function readSerialLoop() {
    const decoder = new TextDecoder();
    try {
      while (state.serialPort?.readable) {
        state.serialReader = state.serialPort.readable.getReader();
        try {
          while (true) {
            const { value, done } = await state.serialReader.read();
            if (done) break;
            if (value) parseSerialText(decoder.decode(value, { stream: true }));
          }
        } finally {
          state.serialReader.releaseLock();
          state.serialReader = null;
        }
        break;
      }
    } catch (error) {
      if (state.connected) log(`串口读取失败：${error.message}`, "error");
    }
    if (state.connected && state.source === "serial") await disconnectSerial();
  }

  function parseSerialText(chunk) {
    state.serialTextBuffer += chunk;
    const lines = state.serialTextBuffer.split(/\r?\n/);
    state.serialTextBuffer = lines.pop() || "";
    for (const line of lines) {
      const text = line.trim();
      if (!text) continue;
      try {
        const raw = JSON.parse(text);
        ingestSample(normalizeSample(raw, "serial"));
        log(`串口样本：${text}`);
      } catch {
        log(`串口原始数据：${text}`, "warn");
      }
    }
  }

  async function startMonitor() {
    if (!state.connected || state.measuring) return;
    state.measuring = true;
    state.sessionStartedAt = new Date().toISOString();
    state.sessionSamples = [];
    state.plotSamples = [];
    state.events = [];
    els.statSamples.textContent = "0";
    renderEvents();
    if (state.source === "ble") {
      try {
        await postJson("/api/monitor/start");
      } catch (error) {
        log(`BLE 开始监测请求失败：${error.message}`, "error");
      }
    } else if (state.source === "serial") {
      await writeSerialCommand("START");
    }
    log("开始监测。");
    updateConnectionUi();
  }

  async function stopMonitor() {
    if (!state.measuring) return;
    state.measuring = false;
    if (state.source === "ble") {
      try {
        await postJson("/api/monitor/stop");
      } catch (error) {
        log(`BLE 停止监测请求失败：${error.message}`, "error");
      }
    } else if (state.source === "serial") {
      await writeSerialCommand("STOP");
    }
    log("停止监测。");
    if (state.sessionSamples.length) saveCsv();
    else log("本轮没有样本，未导出 CSV。", "warn");
    updateConnectionUi();
  }

  function clearPlot() {
    state.plotSamples = [];
    state.sessionSamples = [];
    els.statSamples.textContent = "0";
    log("曲线已清空。");
  }

  async function pollBackend() {
    if (state.mode !== "ble") return;
    await checkBackend();
    if (!state.backendOk) return;

    try {
      const status = await requestJson("/api/status");
      if (status.connected !== undefined)
        state.connected = Boolean(status.connected);
      if (status.monitoring !== undefined)
        state.measuring = Boolean(status.monitoring);
      if (status.device) state.device = status.device;
      if (status.device_status && state.latestSample) {
        state.latestSample.device_status = status.device_status;
        updateMetrics(state.latestSample);
      }
      updateConnectionUi();
    } catch (error) {
      log(`状态轮询失败：${error.message}`, "warn");
    }

    try {
      const data = await requestJson(
        `/api/samples?since=${state.lastSampleSeq}`,
      );
      for (const raw of data.samples || [])
        ingestSample(normalizeSample(raw, "ble"));
    } catch (error) {
      log(`样本轮询失败：${error.message}`, "warn");
    }

    try {
      const data = await requestJson(`/api/events?since=${state.lastEventSeq}`);
      ingestEvents(data.events || []);
    } catch (error) {
      log(`事件轮询失败：${error.message}`, "warn");
    }

    try {
      const data = await requestJson(`/api/logs?since=${state.lastLogSeq}`);
      for (const item of data.logs || []) {
        state.lastLogSeq = Math.max(state.lastLogSeq, Number(item.seq) || 0);
        log(item.message || String(item), item.level);
      }
    } catch (error) {
      log(`日志轮询失败：${error.message}`, "warn");
    }
  }

  function saveCsv() {
    const header =
      "timestamp,source,temperature_c,humidity_pct,posture,battery_pct,rssi,device_status,alarms";
    const rows = state.sessionSamples.map((sample) =>
      [
        sample.timestamp,
        sample.source,
        sample.temperature_c ?? "",
        sample.humidity_pct ?? "",
        sample.posture ?? "",
        sample.battery_pct ?? "",
        sample.rssi ?? "",
        sample.device_status ?? "",
        sample.alarms.join("|"),
      ]
        .map(csvCell)
        .join(","),
    );
    const blob = new Blob([[header, ...rows].join("\n")], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const stamp = new Date().toISOString().replace(/[:.]/g, "").slice(0, 15);
    link.href = url;
    link.download = `baby_badge_${state.source || "data"}_${stamp}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    log(`CSV 已导出：${link.download}`);
  }

  function csvCell(value) {
    const text = String(value ?? "");
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  }

  function getCanvasSize() {
    const canvasRect = els.canvas.getBoundingClientRect();
    const parentRect = els.canvas.parentElement.getBoundingClientRect();
    return {
      width: Math.max(1, canvasRect.width || parentRect.width),
      height: Math.max(1, canvasRect.height || DEFAULT_CHART_HEIGHT),
    };
  }

  function resizeCanvas() {
    const { width, height } = getCanvasSize();
    const dpr = window.devicePixelRatio || 1;
    const nextWidth = Math.round(width * dpr);
    const nextHeight = Math.round(height * dpr);
    if (els.canvas.width !== nextWidth) els.canvas.width = nextWidth;
    if (els.canvas.height !== nextHeight) els.canvas.height = nextHeight;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  const DESKTOP_MARGIN = { top: 18, right: 18, bottom: 38, left: 58 };

  function chartMargin(width) {
    return width < 420
      ? { top: 16, right: 12, bottom: 34, left: 46 }
      : DESKTOP_MARGIN;
  }

  function drawChart() {
    resizeCanvas();
    const W = els.canvas.width / (window.devicePixelRatio || 1);
    const H = els.canvas.height / (window.devicePixelRatio || 1);
    const margin = chartMargin(W);
    const plotW = Math.max(1, W - margin.left - margin.right);
    const plotH = Math.max(1, H - margin.top - margin.bottom);
    const metric = els.chartMetric.value;
    const unit = metric === "temperature_c" ? "°C" : "%RH";
    const label = metric === "temperature_c" ? "温度" : "湿度";

    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = "#0f172a";
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "#111c2f";
    ctx.fillRect(margin.left, margin.top, plotW, plotH);

    const points = state.plotSamples
      .map((sample) => ({
        t: new Date(sample.timestamp).getTime(),
        y: sample[metric],
      }))
      .filter((point) => Number.isFinite(point.t) && Number.isFinite(point.y));

    if (points.length < 2) {
      ctx.fillStyle = "#718096";
      ctx.font = "14px Arial";
      ctx.textAlign = "center";
      ctx.fillText("等待监测数据...", W / 2, H / 2);
      requestAnimationFrame(drawChart);
      return;
    }

    const t0 = points[0].t;
    const xs = points.map((point) => (point.t - t0) / 1000);
    let yMin = Math.min(...points.map((point) => point.y));
    let yMax = Math.max(...points.map((point) => point.y));
    if (yMin === yMax) {
      yMin -= 1;
      yMax += 1;
    }
    const yPad = Math.max(
      (yMax - yMin) * 0.12,
      metric === "temperature_c" ? 0.2 : 1,
    );
    yMin -= yPad;
    yMax += yPad;
    const xMin = 0;
    const xMax = Math.max(xs[xs.length - 1], 1);

    const toX = (x) => margin.left + ((x - xMin) / (xMax - xMin)) * plotW;
    const toY = (y) =>
      margin.top + plotH - ((y - yMin) / (yMax - yMin)) * plotH;

    ctx.strokeStyle = "#27415f";
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    for (const xt of niceScale(xMin, xMax, 6)) {
      const x = toX(xt);
      ctx.moveTo(x, margin.top);
      ctx.lineTo(x, margin.top + plotH);
    }
    for (const yt of niceScale(yMin, yMax, 5)) {
      const y = toY(yt);
      ctx.moveTo(margin.left, y);
      ctx.lineTo(margin.left + plotW, y);
    }
    ctx.stroke();

    ctx.fillStyle = "#8ea0b4";
    ctx.font = "11px Arial";
    ctx.textAlign = "center";
    for (const xt of niceScale(xMin, xMax, 6))
      ctx.fillText(xt.toFixed(0), toX(xt), margin.top + plotH + 16);
    ctx.textAlign = "right";
    for (const yt of niceScale(yMin, yMax, 5))
      ctx.fillText(
        yt.toFixed(metric === "temperature_c" ? 1 : 0),
        margin.left - 8,
        toY(yt) + 4,
      );

    ctx.fillStyle = "#cbd5e1";
    ctx.font = "13px Arial";
    ctx.textAlign = "center";
    ctx.fillText("时间 (s)", margin.left + plotW / 2, H - 8);
    ctx.save();
    ctx.translate(16, margin.top + plotH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText(`${label} (${unit})`, 0, 0);
    ctx.restore();

    ctx.beginPath();
    ctx.strokeStyle = metric === "temperature_c" ? "#2dd4bf" : "#38bdf8";
    ctx.lineWidth = 1.8;
    points.forEach((point, index) => {
      const x = toX(xs[index]);
      const y = toY(point.y);
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();

    ctx.strokeStyle = "#39506b";
    ctx.lineWidth = 1;
    ctx.strokeRect(margin.left, margin.top, plotW, plotH);
    requestAnimationFrame(drawChart);
  }

  function niceScale(min, max, targetTicks) {
    const range = max - min;
    if (range <= 0) return [min];
    const roughStep = range / targetTicks;
    const mag = Math.pow(10, Math.floor(Math.log10(roughStep)));
    const residual = roughStep / mag;
    const step =
      residual <= 1.5
        ? mag
        : residual <= 3
          ? 2 * mag
          : residual <= 7
            ? 5 * mag
            : 10 * mag;
    const ticks = [];
    for (let tick = Math.ceil(min / step) * step; tick <= max; tick += step)
      ticks.push(tick);
    return ticks;
  }

  function bindEvents() {
    els.modeBle.addEventListener("click", () => setMode("ble"));
    els.modeSerial.addEventListener("click", () => setMode("serial"));
    els.bleDeviceSelect.addEventListener("change", () => {
      state.selectedDeviceId = els.bleDeviceSelect.value;
      const device = state.bleDevices.find(
        (item) =>
          (item.id || item.address || item.name) === state.selectedDeviceId,
      );
      els.bleDeviceName.textContent = device?.name || "--";
      els.bleDeviceId.textContent =
        device?.id || device?.address || state.selectedDeviceId || "--";
      els.bleRssi.textContent =
        device?.rssi === undefined ? "--" : `${device.rssi} dBm`;
      updateConnectionUi();
    });
    els.btnScanBle.addEventListener("click", scanBle);
    els.btnBleConnect.addEventListener("click", connectBle);
    els.btnBleDisconnect.addEventListener("click", disconnectBle);
    els.btnSerialConnect.addEventListener("click", connectSerial);
    els.btnStart.addEventListener("click", startMonitor);
    els.btnStop.addEventListener("click", stopMonitor);
    els.btnClear.addEventListener("click", clearPlot);
    els.chartMetric.addEventListener("change", () =>
      log(`曲线切换为${els.chartMetric.selectedOptions[0].textContent}。`),
    );
    window.addEventListener("resize", resizeCanvas);
    document.addEventListener("keydown", (event) => {
      if (["INPUT", "SELECT", "BUTTON"].includes(event.target.tagName)) return;
      if (event.key === "s" || event.key === "S") startMonitor();
      if (event.key === "e" || event.key === "E") stopMonitor();
      if (event.key === "c" || event.key === "C") clearPlot();
    });
  }

  function init() {
    bindEvents();
    resizeCanvas();
    updateConnectionUi();
    checkBackend();
    state.pollTimer = setInterval(pollBackend, POLL_MS);
    requestAnimationFrame(drawChart);
    log("页面已就绪。BLE 模式依赖 Python 后端；串口模式支持 JSON 行调试数据。");
  }

  init();
})();
