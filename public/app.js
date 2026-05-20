const modes = ["agent", "translate", "transcribe"];

const state = {
  mode: "agent",
  pc: null,
  dc: null,
  localStream: null,
  connected: false,
  runtime: null,
  sourceBuffer: "",
  outputBuffer: "",
  sourceSectionOpen: false,
  outputSectionOpen: false,
  activeOutputItemId: null,
  streamedOutputItemIds: new Set(),
  multiOutputWarnings: new Set(),
  seenFailureKeys: new Set(),
  agentSpeaking: false,
  echoSuppressUntil: 0,
  echoNoticeShown: false,
  micGated: false,
  micGateTimer: 0,
  openSourceSectionOffset: -1,
  metrics: createMetricsState(),
};

function createMetricsState() {
  return {
    sessionStartedAt: 0,
    iceConnectedAt: 0,
    dcOpenAt: 0,
    sessionCreatedAt: 0,
    speechStartedAt: 0,
    speechStoppedAt: 0,
    firstDeltaAt: 0,
    firstAudibleAt: 0,
    turnCompletedAt: 0,
    audioInputMs: 0,
    turn: { ttftMs: null, ttfaMs: null, e2eMs: null, rtfRatio: null },
    last: { ttftMs: null, ttfaMs: null, e2eMs: null, rtfRatio: null },
    history: [],
    serverTiming: null,
    chars: 0,
    deltaCount: 0,
    charSamples: [],
    deltaSamples: [],
    turns: 0,
    streamState: "idle",
    statsTimer: 0,
    streamingTickTimer: 0,
    rtcRttMs: null,
    rtcJitterMs: null,
    rtcLossPct: null,
    sparkline: [],
    mic: {
      peak: 0,
      peakHoldUntil: 0,
    },
  };
}

const els = {
  tabs: [...document.querySelectorAll(".tab")],
  modeCopies: [...document.querySelectorAll(".mode-copy")],
  startBtn: document.querySelector("#startBtn"),
  stopBtn: document.querySelector("#stopBtn"),
  sendTextBtn: document.querySelector("#sendTextBtn"),
  manualResponseBtn: document.querySelector("#manualResponseBtn"),
  commitAudioBtn: document.querySelector("#commitAudioBtn"),
  textPrompt: document.querySelector("#textPrompt"),
  remoteAudio: document.querySelector("#remoteAudio"),
  eventLog: document.querySelector("#eventLog"),
  transcriptCards: document.querySelector("#transcriptCards"),
  sourceCard: document.querySelector("#sourceCard"),
  outputCard: document.querySelector("#outputCard"),
  sourceTranscriptTitle: document.querySelector("#sourceTranscriptTitle"),
  outputTranscriptTitle: document.querySelector("#outputTranscriptTitle"),
  sourceTranscript: document.querySelector("#sourceTranscript"),
  outputTranscript: document.querySelector("#outputTranscript"),
  connectionDot: document.querySelector("#connectionDot"),
  connectionLabel: document.querySelector("#connectionLabel"),
  connectionHint: document.querySelector("#connectionHint"),
  voice: document.querySelector("#voice"),
  reasoningEffort: document.querySelector("#reasoningEffort"),
  turnDetection: document.querySelector("#turnDetection"),
  vadThreshold: document.querySelector("#vadThreshold"),
  vadThresholdValue: document.querySelector("#vadThresholdValue"),
  silenceDurationMs: document.querySelector("#silenceDurationMs"),
  silenceDurationMsValue: document.querySelector("#silenceDurationMsValue"),
  prefixPaddingMs: document.querySelector("#prefixPaddingMs"),
  prefixPaddingMsValue: document.querySelector("#prefixPaddingMsValue"),
  enableInputTranscription: document.querySelector("#enableInputTranscription"),
  interruptResponse: document.querySelector("#interruptResponse"),
  sourceLanguage: document.querySelector("#sourceLanguage"),
  noiseReduction: document.querySelector("#noiseReduction"),
  instructions: document.querySelector("#instructions"),
  metric: {
    streamDot: document.querySelector("#metricsStreamDot"),
    streamLabel: document.querySelector("#metricsStreamLabel"),
    streamMeta: document.querySelector("#metricsStreamMeta"),
    progress: document.querySelector(".metrics-progress"),
    progressFill: document.querySelector("#metricsProgressFill"),
    tileTtft: document.querySelector('[data-metric="ttft"]'),
    tileTtfa: document.querySelector('[data-metric="ttfa"]'),
    tileE2e: document.querySelector('[data-metric="e2e"]'),
    tileRtf: document.querySelector('[data-metric="rtf"]'),
    ttft: document.querySelector("#metricTtft"),
    ttftHint: document.querySelector("#metricTtftHint"),
    ttfa: document.querySelector("#metricTtfa"),
    ttfaHint: document.querySelector("#metricTtfaHint"),
    e2e: document.querySelector("#metricE2e"),
    e2eHint: document.querySelector("#metricE2eHint"),
    rtf: document.querySelector("#metricRtf"),
    rtfHint: document.querySelector("#metricRtfHint"),
    chars: document.querySelector("#metricChars"),
    charRate: document.querySelector("#metricCharRate"),
    deltaRate: document.querySelector("#metricDeltaRate"),
    setup: document.querySelector("#metricSetup"),
    azure: document.querySelector("#metricAzure"),
    rtt: document.querySelector("#metricRtt"),
    jitter: document.querySelector("#metricJitter"),
    loss: document.querySelector("#metricLoss"),
    turns: document.querySelector("#metricTurns"),
    sparkline: document.querySelector("#metricsSparkline"),
    aggregate: document.querySelector("#metricsAggregate"),
    aggregateMeta: document.querySelector("#metricsAggregateMeta"),
  },
  mic: {
    container: document.querySelector("#micMeter"),
    fill: document.querySelector("#micMeterFill"),
    peak: document.querySelector("#micMeterPeak"),
    value: document.querySelector("#micMeterValue"),
    gateBadge: document.querySelector("#micGateBadge"),
  },
};

initialize();

async function initialize() {
  wireUi();
  setStatus("idle", "未连接", "正在读取后端运行时配置…");
  resetMetrics();
  setStreamState("idle", "空闲", "等待会话开始");

  try {
    const response = await fetch("/api/runtime");
    state.runtime = await response.json();
    if (state.runtime?.defaults?.voice) {
      els.voice.value = state.runtime.defaults.voice;
    }
    if (state.runtime?.defaults?.reasoningEffort) {
      els.reasoningEffort.value = state.runtime.defaults.reasoningEffort;
    }
    if (state.runtime?.deployments?.agent) {
      const agentTab = document.querySelector('[data-mode="agent"]');
      const agentName = agentTab.querySelector("span");
      const agentDeployment = agentTab.querySelector("small");
      if (agentName && agentDeployment) {
        agentName.textContent = "Agent";
        agentDeployment.textContent = state.runtime.deployments.agent;
      } else {
        agentTab.textContent = state.runtime.deployments.agent;
      }
    }
    if (state.runtime?.translateEngine) {
      const translateTab = document.querySelector('[data-mode="translate"]');
      const translateDeployment = translateTab?.querySelector("small");
      if (translateDeployment) {
        translateDeployment.textContent = state.runtime.deployments.translate;
      }
    }
    if (!state.runtime?.capabilities?.agentReasoning) {
      els.reasoningEffort.disabled = true;
      els.reasoningEffort.title = "当前 Agent 部署不是 gpt-realtime-2，后端会跳过 reasoning.effort。";
    }
    log(`Runtime loaded: ${JSON.stringify(state.runtime, null, 2)}`);
    setStatus("idle", "未连接", "选择模式后开始，会请求麦克风权限。localhost 可直接使用 WebRTC。");
  } catch (error) {
    setStatus("error", "配置读取失败", error.message);
    toast(`无法读取 /api/runtime：${error.message}`);
  }
}

function wireUi() {
  els.tabs.forEach((tab) => {
    tab.addEventListener("click", () => switchMode(tab.dataset.mode));
  });

  els.startBtn.addEventListener("click", startSession);
  els.stopBtn.addEventListener("click", stopSession);
  els.sendTextBtn.addEventListener("click", sendTextPrompt);
  els.manualResponseBtn.addEventListener("click", createManualAgentResponse);
  els.commitAudioBtn.addEventListener("click", () => sendEvent({ type: "input_audio_buffer.commit" }));
  const wireRange = (input, label, formatter) => {
    if (!input || !label) return;
    const update = () => { label.textContent = formatter(input.value); };
    input.addEventListener("input", update);
    update();
  };
  wireRange(els.vadThreshold, els.vadThresholdValue, (v) => Number(v).toFixed(2));
  wireRange(els.silenceDurationMs, els.silenceDurationMsValue, (v) => `${v} ms`);
  wireRange(els.prefixPaddingMs, els.prefixPaddingMsValue, (v) => `${v} ms`);
  const updateVadVisibility = () => {
    const showVad = els.turnDetection?.value === "server_vad";
    document.querySelectorAll(".field-vad-server").forEach((node) => {
      node.classList.toggle("hidden", !showVad);
    });
  };
  els.turnDetection?.addEventListener("change", updateVadVisibility);
  updateVadVisibility();
  els.textPrompt.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      sendTextPrompt();
    }
  });

  els.remoteAudio.addEventListener("playing", () => {
    log("Remote audio is playing.");
  });
  els.remoteAudio.addEventListener("pause", () => log("Remote audio paused."));
  els.remoteAudio.addEventListener("error", () => log(`Remote audio error: ${els.remoteAudio.error?.message || "unknown"}`));
}

function switchMode(mode) {
  if (!modes.includes(mode) || state.connected) {
    return;
  }

  state.mode = mode;
  els.tabs.forEach((tab) => tab.classList.toggle("active", tab.dataset.mode === mode));
  els.modeCopies.forEach((copy) => copy.classList.toggle("active", copy.dataset.copy === mode));
  document.querySelectorAll("[class*='field-']").forEach((node) => {
    const isAgent = node.classList.contains("field-agent");
    const isTranslate = node.classList.contains("field-translate");
    const isTranscribe = node.classList.contains("field-transcribe");
    const isNoTranslate = node.classList.contains("field-no-translate");

    node.classList.toggle(
      "hidden",
      (isAgent && mode !== "agent") ||
        (isTranslate && mode !== "translate") ||
        (isTranscribe && mode !== "transcribe") ||
        (isNoTranslate && mode === "translate")
    );
  });
  document.querySelectorAll("[data-tools]").forEach((node) => {
    node.classList.toggle("hidden", node.dataset.tools !== mode);
    node.classList.toggle("active", node.dataset.tools === mode);
  });
  updateTranscriptLayout(mode);
  clearTranscripts();
  resetMetrics();
  setStreamState("idle", "空闲", "选择模式后开始");
  setStatus("idle", "未连接", modeHint(mode));
}

function updateTranscriptLayout(mode) {
  const isTranscribe = mode === "transcribe";
  const isTranslate = mode === "translate";
  const isAgent = mode === "agent";
  els.transcriptCards.classList.add("single-card");
  els.sourceCard.classList.toggle("hidden", isTranslate);
  els.outputCard.classList.toggle("hidden", isAgent || isTranscribe);

  if (isTranscribe) {
    els.sourceCard.classList.remove("hidden");
    els.sourceTranscriptTitle.textContent = "Whisper 实时转写";
    els.outputTranscriptTitle.textContent = "";
    return;
  }

  if (isTranslate) {
    els.sourceTranscriptTitle.textContent = "";
    els.outputTranscriptTitle.textContent = "实时翻译结果";
    return;
  }

  els.sourceCard.classList.remove("hidden");
  els.sourceTranscriptTitle.textContent = "对话记录（User / Agent）";
  els.outputTranscriptTitle.textContent = "";
}

async function startSession() {
  if (state.connected) {
    return;
  }

  clearTranscripts();
  resetMetrics({ keepLast: true });
  state.metrics.sessionStartedAt = performance.now();
  setStreamState("connecting", "建立连接", "协商 SDP 与麦克风权限…");
  setControlsBusy(true);
  setStatus("connecting", "连接中", "正在创建 RTCPeerConnection 并请求麦克风权限…");

  try {
    const pc = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    });
    state.pc = pc;

    pc.onconnectionstatechange = () => {
      log(`PeerConnection state: ${pc.connectionState}`);
      if (pc.connectionState === "connected" && !state.metrics.iceConnectedAt) {
        state.metrics.iceConnectedAt = performance.now();
        updateSetupHint();
      }
      if (["failed", "disconnected", "closed"].includes(pc.connectionState)) {
        setStatus(pc.connectionState === "failed" ? "error" : "idle", pc.connectionState, "WebRTC 状态变化");
      }
    };
    pc.oniceconnectionstatechange = () => log(`ICE state: ${pc.iceConnectionState}`);
    pc.ontrack = (event) => {
      const remoteStream = event.streams[0] || new MediaStream([event.track]);
      log(`Remote ${event.track.kind} track received: ${event.track.readyState}`);
      els.remoteAudio.srcObject = remoteStream;
      els.remoteAudio.muted = false;
      els.remoteAudio.volume = 1;
      event.track.addEventListener("unmute", () => {
        log(`Remote ${event.track.kind} track unmuted.`);
        playRemoteAudio("track unmuted");
      });
      event.track.addEventListener("mute", () => log(`Remote ${event.track.kind} track muted.`));
      event.track.addEventListener("ended", () => log(`Remote ${event.track.kind} track ended.`));
      playRemoteAudio("remote track received");
    };

    state.localStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    pc.addTrack(state.localStream.getAudioTracks()[0], state.localStream);
    log(`Microphone attached: ${state.localStream.getAudioTracks()[0].label}`);

    const dc = pc.createDataChannel("oai-events");
    state.dc = dc;
    dc.addEventListener("open", onDataChannelOpen);
    dc.addEventListener("close", () => log("Data channel closed."));
    dc.addEventListener("error", (event) => log(`Data channel error: ${event.message || "unknown"}`));
    dc.addEventListener("message", onDataChannelMessage);

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    log("Local SDP offer created.");

    const sdpResponse = await fetch("/api/webrtc/connect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: state.mode,
        sdp: offer.sdp,
        options: collectOptions(),
      }),
    });

    captureServerTiming(sdpResponse.headers.get("Server-Timing"));
    if (!sdpResponse.ok) {
      throw new Error(await readErrorMessage(sdpResponse));
    }

    const answerSdp = await sdpResponse.text();
    if (state.pc !== pc) {
      // User clicked Stop while the SDP exchange was in flight.
      log("SDP answer arrived after session was torn down; discarding.");
      return;
    }
    await pc.setRemoteDescription({ type: "answer", sdp: answerSdp });
    log("Remote SDP answer applied.");
    playRemoteAudio("remote SDP applied");

    state.connected = true;
    setStatus("connected", "已连接", connectedHint(state.mode));
    setStreamState("listening", "监听中", "等待你开始说话…");
    startStatsPolling();
    setControlsBusy(false);
    updateActionButtons(true);
  } catch (error) {
    toast(error.message);
    log(`Start failed: ${error.stack || error.message}`);
    await stopSession();
    setControlsBusy(false);
    setStatus("error", "连接失败", error.message);
  }
}

async function stopSession() {
  stopStatsPolling();
  stopStreamingTick();
  stopMicMeter();
  if (state.dc) {
    state.dc.close();
  }
  if (state.pc) {
    state.pc.close();
  }
  if (state.localStream) {
    state.localStream.getTracks().forEach((track) => track.stop());
  }

  els.remoteAudio.srcObject = null;
  state.pc = null;
  state.dc = null;
  state.localStream = null;
  state.connected = false;
  setControlsBusy(false);
  updateActionButtons(false);
  setStatus("idle", "未连接", modeHint(state.mode));
  setStreamState("idle", "空闲", "会话已结束");
  log("Session stopped.");
}

function onDataChannelOpen() {
  log("Data channel open.");
  state.metrics.dcOpenAt = performance.now();
  updateSetupHint();
  if (state.mode === "agent" && els.turnDetection.value === "none") {
    log("Manual turn mode is enabled. Speak, then click '提交语音并回答' to commit audio and create a response.");
  }
}

function onDataChannelMessage(event) {
  let serverEvent;
  try {
    serverEvent = JSON.parse(event.data);
  } catch (error) {
    log(`Failed to parse server event: ${error.message}`);
    return;
  }
  logEvent(serverEvent);
  routeServerEvent(serverEvent);
}

function routeServerEvent(event) {
  if (event.type === "error" || event.type === "session.error") {
    toast(event.error?.message || "Realtime session error");
    return;
  }

  if (event.type === "session.created" && !state.metrics.sessionCreatedAt) {
    state.metrics.sessionCreatedAt = performance.now();
    updateSetupHint();
  }

  warnIfMultipleOutputItems(event);

  if (event.type === "response.created") {
    state.agentSpeaking = true;
    gateLocalMicForAgent();
  }

  if (
    event.type === "response.done" ||
    event.type === "response.cancelled" ||
    event.type === "response.canceled"
  ) {
    state.agentSpeaking = false;
    state.echoSuppressUntil = performance.now() + 400;
    scheduleLocalMicUngate();
  }

  if (event.type === "input_audio_buffer.speech_started") {
    onSpeechStarted();
    setStatus("connected", "检测到语音", "模型正在接收你的麦克风输入…");
    return;
  }

  if (event.type === "input_audio_buffer.speech_stopped") {
    onSpeechStopped();
    setStatus("connected", "语音结束", "等待模型输出…");
    return;
  }

  if (event.type === "conversation.item.input_audio_transcription.delta") {
    onDeltaReceived(event.delta);
    appendInputAudioTranscriptionDelta(event.delta);
    return;
  }

  if (event.type === "conversation.item.input_audio_transcription.completed") {
    if (state.mode !== "agent") {
      onTurnCompleted();
    }
    appendCompletedInputAudioTranscript(event.transcript);
    return;
  }

  if (event.type === "conversation.item.input_audio_transcription.failed") {
    appendInputAudioTranscriptionFailure(event);
    return;
  }

  if (event.type === "conversation.item.done") {
    appendConversationItemTranscript(event.item);
    return;
  }

  if (["response.audio_transcript.delta", "response.output_audio_transcript.delta", "response.text.delta", "response.output_text.delta"].includes(event.type)) {
    onDeltaReceived(event.delta);
    if (event.type.includes("audio_transcript")) {
      playRemoteAudio("audio transcript delta");
    }
    appendOutputDeltaEvent(event);
    return;
  }

  if (["response.audio_transcript.done", "response.output_audio_transcript.done"].includes(event.type)) {
    playRemoteAudio("audio transcript done");
    appendCompletedOutputEvent(event, event.transcript);
    return;
  }

  if (["response.text.done", "response.output_text.done"].includes(event.type)) {
    appendCompletedOutputEvent(event, event.text);
    return;
  }

  if (event.type === "response.done" && event.response) {
    onTurnCompleted();
    appendExtractedResponse(event.response);
    surfaceIncompleteResponse(event.response);
    return;
  }

  if (event.type === "session.input_transcript.delta") {
    appendSource(event.delta);
    return;
  }

  if (event.type === "session.output_transcript.delta") {
    appendOutput(event.delta);
    return;
  }

  if (event.type === "session.closed") {
    setStatus("idle", "翻译会话已关闭", "可重新开始。" );
  }
}

function sendTextPrompt() {
  const text = els.textPrompt.value.trim();
  if (!text) {
    return;
  }

  sendEvent({
    type: "conversation.item.create",
    item: {
      type: "message",
      role: "user",
      content: [{ type: "input_text", text }],
    },
  });
  sendEvent({
    type: "response.create",
    response: {
      output_modalities: ["audio"],
    },
  });
  appendSource(`文本：${text}`, { startNew: true, complete: true });
  els.textPrompt.value = "";
}

function createManualAgentResponse() {
  if (state.mode !== "agent") {
    return;
  }
  const inFlight = state.metrics.streamState === "thinking" || state.metrics.streamState === "streaming";
  if (inFlight) {
    toast("上一轮还在进行中，稍等再试。");
    return;
  }

  if (els.turnDetection.value === "none") {
    sendEvent({ type: "input_audio_buffer.commit" });
  }

  sendEvent({
    type: "response.create",
    response: {
      output_modalities: ["audio"],
    },
  });
}

function sendEvent(payload, { silent = false } = {}) {
  if (!state.dc || state.dc.readyState !== "open") {
    toast("Data channel 还没打开，稍等一下再试。小机器人也需要热身。" );
    return;
  }

  state.dc.send(JSON.stringify(payload));
  if (!silent) {
    log(`Client event sent: ${payload.type}`);
  }
}

function playRemoteAudio(reason) {
  if (!els.remoteAudio.srcObject) {
    return;
  }

  const result = els.remoteAudio.play();
  if (result?.catch) {
    result.catch((error) => {
      log(`Remote audio play blocked after ${reason}: ${error.message}. Click the audio control's play button once if needed.`);
    });
  }
}

function collectOptions() {
  const options = {
    noiseReduction: els.noiseReduction.value,
    sourceLanguage: els.sourceLanguage.value || undefined,
  };

  // turnDetection / VAD numerics apply to every mode (server honors them in
  // both realtime and transcription sessions).
  options.turnDetection = els.turnDetection.value;
  if (els.turnDetection.value === "server_vad") {
    options.vadThreshold = Number(els.vadThreshold.value);
    options.silenceDurationMs = Number(els.silenceDurationMs.value);
    options.prefixPaddingMs = Number(els.prefixPaddingMs.value);
  }

  if (state.mode === "agent") {
    Object.assign(options, {
      voice: els.voice.value,
      reasoningEffort: els.reasoningEffort.value,
      enableInputTranscription: els.enableInputTranscription.checked,
      interruptResponse: els.interruptResponse.checked,
      instructions: els.instructions.value,
    });
  }

  return options;
}

function appendExtractedResponse(response) {
  const fragments = [];
  for (const item of response.output || []) {
    if (state.streamedOutputItemIds.has(item.id)) {
      continue;
    }

    for (const content of item.content || []) {
      if (content.transcript) fragments.push(content.transcript);
      if (content.text) fragments.push(content.text);
    }
  }

  if (fragments.length) {
    appendCompletedOutputTranscript(fragments.join("\n"));
  }
}

function surfaceIncompleteResponse(response) {
  if (!response || response.status !== "incomplete") return;
  const details = response.status_details || {};
  const reason = details.reason || details.type || "unknown";
  const reasonHint = {
    content_filter: "Azure 内容过滤命中，模型被强制中止。",
    interrupted: "server_vad 检测到声音触发 barge-in，模型被打断（可能是回声）。",
    cancelled: "客户端发出取消，或数据通道断开。",
    canceled: "客户端发出取消，或数据通道断开。",
    max_output_tokens: "命中 max_output_tokens 上限。",
    turn_detected: "新一轮对话开始，前一回答被截断。",
  }[reason] || "Azure 标记 response 为 incomplete。";
  const error = details.error?.message ? ` · ${details.error.message}` : "";
  appendTranscript(
    "output",
    "系统",
    `\n[回答被截断] reason=${reason} · ${reasonHint}${error}`,
    { startNew: true, complete: true }
  );
  log(`[response.incomplete] reason=${reason}${error}`);
}

function appendSource(text, options = {}) {
  appendTranscript("source", sourceTranscriptLabel(), text, options);
}

function appendOutput(text, options = {}) {
  appendTranscript("output", outputTranscriptLabel(), text, options);
}

function appendOutputDeltaEvent(event) {
  const itemId = outputEventItemId(event);
  const startNew = Boolean(itemId && state.activeOutputItemId !== itemId);

  if (itemId) {
    state.activeOutputItemId = itemId;
    state.streamedOutputItemIds.add(itemId);
  }

  appendOutput(event.delta, { startNew });
}

function appendCompletedOutputEvent(event, transcript) {
  const itemId = outputEventItemId(event);

  if (itemId && state.streamedOutputItemIds.has(itemId)) {
    if (state.activeOutputItemId === itemId) {
      appendOutput("\n", { complete: true });
      state.activeOutputItemId = null;
    }
    return;
  }

  if (transcript) {
    appendCompletedOutputTranscript(transcript);
  }

  if (itemId) {
    state.streamedOutputItemIds.add(itemId);
  }
}

function outputEventItemId(event) {
  if (event?.item_id) {
    return event.item_id;
  }

  if (event?.id) {
    return event.id;
  }

  if (event?.response_id !== undefined && event?.output_index !== undefined) {
    return `${event.response_id}:${event.output_index}:${event.content_index ?? 0}`;
  }

  return "";
}

function warnIfMultipleOutputItems(event) {
  if (state.mode !== "agent" || typeof event?.output_index !== "number" || event.output_index === 0) {
    return;
  }

  const key = `${event.response_id || "response"}:${event.output_index}`;
  if (state.multiOutputWarnings.has(key)) {
    return;
  }

  state.multiOutputWarnings.add(key);
  const phase = event.item?.phase || event.phase || "unknown";
  log(
    `[诊断] Azure 把同一个回答拆成了第 ${event.output_index + 1} 个 audio item` +
      `（phase=${phase}）。WebRTC 对这种拆分可能只播第一段；建议使用 minimal reasoning 并避免开场白。`
  );
}

function appendTranscript(target, label, text, { startNew = false, complete = false } = {}) {
  if (typeof text !== "string" || text.length === 0) {
    return;
  }

  const bufferKey = transcriptBufferKey(target);
  const openKey = target === "source" ? "sourceSectionOpen" : "outputSectionOpen";
  const element = transcriptElement(target);
  const hasVisibleText = /\S/.test(text);

  if ((startNew || !state[openKey]) && hasVisibleText) {
    if (state[bufferKey] && !state[bufferKey].endsWith("\n")) {
      state[bufferKey] += "\n";
    }
    if (state[bufferKey] && !state[bufferKey].endsWith("\n\n")) {
      state[bufferKey] += "\n";
    }
    if (transcriptTarget(target) === "source" && target === "source") {
      state.openSourceSectionOffset = state[bufferKey].length;
    }
    state[bufferKey] += `【${label}】\n`;
    state[openKey] = true;
  } else if (!state[openKey] && !hasVisibleText) {
    return;
  }

  state[bufferKey] += text;

  if (complete) {
    if (!state[bufferKey].endsWith("\n")) {
      state[bufferKey] += "\n";
    }
    if (!state[bufferKey].endsWith("\n\n")) {
      state[bufferKey] += "\n";
    }
    state[openKey] = false;
    if (target === "source") {
      state.openSourceSectionOffset = -1;
    }
  }

  renderTranscript(target);
}

function renderTranscript(target) {
  const element = transcriptElement(target);
  const buffer = state[transcriptBufferKey(target)];
  if (!buffer) {
    element.innerHTML = "";
    return;
  }
  element.innerHTML = transcriptToHtml(buffer);
  element.scrollTop = element.scrollHeight;
}

function transcriptToHtml(text) {
  const lines = text.split("\n");
  const blocks = [];
  let role = "system";
  let label = "";
  let bucket = [];

  const flush = () => {
    const body = bucket.join("\n").replace(/^\n+|\n+$/g, "");
    if (!body.trim()) {
      bucket = [];
      return;
    }
    blocks.push(
      `<span class="bubble bubble-${role}">` +
        `<span class="bubble-role">${escapeHtml(label || roleDefaultLabel(role))}</span>` +
        `<span class="bubble-text">${escapeHtml(body).replace(/\n/g, "<br/>")}</span>` +
        `</span>`
    );
    bucket = [];
  };

  for (const line of lines) {
    const match = line.match(/^【(.+)】$/);
    if (match) {
      flush();
      label = match[1];
      role = roleFromLabel(label);
      continue;
    }
    bucket.push(line);
  }
  flush();
  return blocks.join("");
}

function roleFromLabel(label) {
  if (!label) return "system";
  if (/^User$|用户|转写|Whisper/i.test(label)) return "user";
  if (/^Agent$|翻译|助手|Assistant/i.test(label)) return "assistant";
  return "system";
}

function roleDefaultLabel(role) {
  if (role === "user") return "User";
  if (role === "assistant") return "Agent";
  return "";
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function isNoiseTranscript(value) {
  if (!value) return true;
  // U+FFFD is the Unicode replacement char — Whisper emits it (or repeated "?")
  // when it tries to transcribe a non-speech segment (cough, breath, mic
  // bump). Treat anything with no letter / digit / CJK / kana / hangul as noise.
  const stripped = String(value).replace(/[\uFFFD]/g, "");
  return !/[\p{L}\p{N}]/u.test(stripped);
}

function appendInputAudioTranscriptionDelta(delta) {
  if (isNoiseTranscript(delta)) {
    return;
  }
  if (state.mode === "translate") {
    appendOutput(delta);
    return;
  }

  if (shouldSuppressEchoTranscript()) {
    noteEchoSuppression();
    return;
  }

  appendSource(delta);
}

function appendCompletedInputAudioTranscript(transcript) {
  if (isNoiseTranscript(transcript)) {
    log(`[转写已过滤] 非语音片段: ${JSON.stringify(transcript)}`);
    return;
  }
  if (state.mode === "translate") {
    appendCompletedOutputTranscript(transcript);
    return;
  }

  if (shouldSuppressEchoTranscript()) {
    rollbackOpenSourceSection();
    noteEchoSuppression();
    return;
  }

  appendCompletedSourceTranscript(transcript);
}

function shouldSuppressEchoTranscript() {
  if (state.mode !== "agent") return false;
  if (els.interruptResponse?.checked) return false;
  if (state.agentSpeaking) return true;
  return performance.now() < state.echoSuppressUntil;
}

function noteEchoSuppression() {
  if (state.echoNoticeShown) return;
  state.echoNoticeShown = true;
  log(
    "[回声抑制] Agent 说话期间麦克风已静音；任何漏入的转写已丢弃。"
  );
}

function gateLocalMicForAgent() {
  if (state.mode !== "agent") return;
  if (els.interruptResponse?.checked) return;
  if (state.micGateTimer) {
    clearTimeout(state.micGateTimer);
    state.micGateTimer = 0;
  }
  setLocalMicEnabled(false, "agent speaking");
}

function scheduleLocalMicUngate() {
  if (state.mode !== "agent") return;
  if (state.micGateTimer) {
    clearTimeout(state.micGateTimer);
  }
  state.micGateTimer = setTimeout(() => {
    state.micGateTimer = 0;
    setLocalMicEnabled(true, "agent finished");
  }, 400);
}

function setLocalMicEnabled(enabled, reason) {
  const tracks = state.localStream?.getAudioTracks?.() || [];
  if (!tracks.length) return;
  const prev = state.micGated;
  state.micGated = !enabled;
  for (const track of tracks) {
    track.enabled = enabled;
  }
  if (els.mic?.gateBadge) {
    els.mic.gateBadge.classList.toggle("hidden", enabled);
  }
  if (prev !== state.micGated) {
    log(`[mic] ${enabled ? "解除" : "静音"} (${reason})`);
  }
}

function rollbackOpenSourceSection() {
  if (state.openSourceSectionOffset < 0) return;
  state.sourceBuffer = state.sourceBuffer.slice(0, state.openSourceSectionOffset);
  state.openSourceSectionOffset = -1;
  state.sourceSectionOpen = false;
  renderTranscript("source");
}

function appendInputAudioTranscriptionFailure(event) {
  const label = state.mode === "translate" ? "翻译" : "转写";
  const failureKey = failureDedupeKey(event);
  if (state.seenFailureKeys.has(failureKey)) {
    log(`[${label}失败已折叠] ${formatRealtimeError(event)}`);
    return;
  }
  state.seenFailureKeys.add(failureKey);

  if (state.mode === "translate") {
    log(`[${label}失败] ${formatRealtimeError(event)}`);
    appendOutput(formatTranslateFailureVerdict(event), { startNew: true, complete: true });
    setStatus("error", "Translate API 失败", "原生 gpt-realtime-translate 已连接，但真实 audio item 处理失败。查看事件日志可获取 Azure 原始错误。");
    return;
  }

  appendSource(`[${label}失败] ${formatRealtimeError(event)}`, { startNew: true, complete: true });
}

function formatRealtimeError(event) {
  const error = event.error || {};
  const parts = [error.message || "unknown"];

  if (error.code) {
    parts.push(`code=${error.code}`);
  }
  if (error.type) {
    parts.push(`type=${error.type}`);
  }
  if (error.param) {
    parts.push(`param=${error.param}`);
  }
  if (event.item_id) {
    parts.push(`item=${event.item_id}`);
  }

  return parts.join(" · ");
}

function formatTranslateFailureVerdict(event) {
  const endpointHost = state.runtime?.endpointHosts?.translate || "当前 Translate endpoint";
  const deployment = state.runtime?.deployments?.translate || "gpt-realtime-translate";
  const error = event.error || {};

  return [
    "\n[Translate API 测试失败]",
    `部署：${deployment}`,
    `Endpoint：${endpointHost}`,
    `阶段：真实麦克风 WebRTC audio item 处理`,
    `Azure code：${error.code || "unknown"}`,
    `Azure type：${error.type || "unknown"}`,
    `item：${event.item_id || "unknown"}`,
    "结论：client_secrets/session/WebRTC/VAD 已通过，但原生 gpt-realtime-translate 数据面没有完成该音频 item 的翻译/转写。\n",
  ].join("\n");
}

function failureDedupeKey(event) {
  return [state.mode, event.type, event.error?.code, event.error?.type, event.error?.message]
    .filter(Boolean)
    .join("|");
}

function appendCompletedSourceTranscript(transcript) {
  if (!transcript) {
    return;
  }

  const normalizedBuffer = normalizeTranscript(transcriptBuffer("source"));
  const normalizedTranscript = normalizeTranscript(transcript);
  if (normalizedBuffer.endsWith(normalizedTranscript)) {
    appendSource("\n", { complete: true });
    return;
  }

  appendSource(transcript, { startNew: true, complete: true });
}

function appendCompletedOutputTranscript(transcript) {
  if (!transcript) {
    return;
  }

  const normalizedBuffer = normalizeTranscript(transcriptBuffer("output"));
  const normalizedTranscript = normalizeTranscript(transcript);
  if (normalizedBuffer.endsWith(normalizedTranscript)) {
    appendOutput("\n", { complete: true });
    return;
  }

  appendOutput(transcript, { startNew: true, complete: true });
}

function appendConversationItemTranscript(item) {
  const fragments = [];
  for (const content of item?.content || []) {
    if (content.transcript) {
      fragments.push(content.transcript);
    }
    if (content.text) {
      fragments.push(content.text);
    }
  }

  if (!fragments.length) {
    return;
  }

  const transcript = fragments.join("\n");
  if (state.mode === "translate") {
    appendCompletedOutputTranscript(transcript);
    return;
  }

  if (item?.role === "assistant") {
    if (state.streamedOutputItemIds.has(item.id)) {
      return;
    }

    appendCompletedOutputTranscript(transcript);
    state.streamedOutputItemIds.add(item.id);
    return;
  }

  appendCompletedSourceTranscript(transcript);
}

function normalizeTranscript(value) {
  return value.replace(/\s+/g, " ").trim();
}

function transcriptTarget(target) {
  return state.mode === "agent" ? "source" : target;
}

function transcriptBufferKey(target) {
  return transcriptTarget(target) === "source" ? "sourceBuffer" : "outputBuffer";
}

function transcriptBuffer(target) {
  return state[transcriptBufferKey(target)];
}

function transcriptElement(target) {
  return transcriptTarget(target) === "source" ? els.sourceTranscript : els.outputTranscript;
}

function sourceTranscriptLabel() {
  return state.mode === "agent" ? "User" : "Whisper 实时转写";
}

function outputTranscriptLabel() {
  return state.mode === "agent" ? "Agent" : "翻译结果";
}

function clearTranscripts() {
  state.sourceBuffer = "";
  state.outputBuffer = "";
  state.sourceSectionOpen = false;
  state.outputSectionOpen = false;
  state.activeOutputItemId = null;
  state.streamedOutputItemIds.clear();
  state.multiOutputWarnings.clear();
  state.seenFailureKeys.clear();
  state.agentSpeaking = false;
  state.echoSuppressUntil = 0;
  state.echoNoticeShown = false;
  state.openSourceSectionOffset = -1;
  if (state.micGateTimer) {
    clearTimeout(state.micGateTimer);
    state.micGateTimer = 0;
  }
  state.micGated = false;
  if (els.mic?.gateBadge) {
    els.mic.gateBadge.classList.add("hidden");
  }
  els.sourceTranscript.innerHTML = "";
  els.outputTranscript.innerHTML = "";
  els.eventLog.textContent = "";
}

function logEvent(event) {
  const important = [
    "error",
    "session.created",
    "session.updated",
    "conversation.created",
    "response.created",
    "response.done",
    "input_audio_buffer.speech_started",
    "input_audio_buffer.speech_stopped",
    "conversation.item.input_audio_transcription.completed",
    "conversation.item.input_audio_transcription.failed",
    "session.output_transcript.delta",
  ];

  if (important.includes(event.type) || event.type?.includes("delta") || event.type?.includes("done")) {
    log(`${event.type}: ${JSON.stringify(redactLargeFields(event), null, 2)}`);
  }
}

function redactLargeFields(event) {
  return JSON.parse(
    JSON.stringify(event, (key, value) => {
      if ((key === "delta" || key === "audio") && typeof value === "string" && value.length > 300) {
        return `${value.slice(0, 48)}…[${value.length} chars]`;
      }
      return value;
    })
  );
}

function log(message) {
  const time = new Date().toLocaleTimeString();
  els.eventLog.textContent += `[${time}] ${message}\n`;
  els.eventLog.scrollTop = els.eventLog.scrollHeight;
}

function setControlsBusy(isBusy) {
  els.startBtn.disabled = isBusy || state.connected;
  els.stopBtn.disabled = !isBusy && !state.connected;
  els.tabs.forEach((tab) => (tab.disabled = isBusy || state.connected));
}

function updateActionButtons(enabled) {
  els.sendTextBtn.disabled = !enabled || state.mode !== "agent";
  els.manualResponseBtn.disabled = !enabled || state.mode !== "agent";
  els.commitAudioBtn.disabled = !enabled || state.mode !== "transcribe";
}

function setStatus(kind, label, hint) {
  els.connectionDot.className = `dot ${kind}`;
  els.connectionLabel.textContent = label;
  els.connectionHint.textContent = hint;
}

function modeHint(mode) {
  if (mode === "translate") return "翻译模式会把麦克风音频送入 transcription 管道，并流式显示译文。";
  if (mode === "transcribe") return "转写模式不会说话，只显示流式 transcript delta。";
  return `Agent 模式会听你讲话，并用 ${state.runtime?.deployments?.agent || "Realtime"} 语音回答。`;
}

function connectedHint(mode) {
  if (mode === "translate") return "开始讲话，等待实时翻译文本。";
  if (mode === "transcribe") return "开始讲话，观察实时转写。必要时点击“提交当前音频缓冲区”。";
  return "开始讲话，或在文本框输入一句话触发语音回答。";
}

async function readErrorMessage(response) {
  const text = await response.text();
  try {
    const data = JSON.parse(text);
    const message = data.error?.message || JSON.stringify(data);
    const details = data.error?.details;
    return details ? `${message}: ${typeof details === "string" ? details : JSON.stringify(details)}` : message;
  } catch {
    return text || response.statusText;
  }
}

function toast(message) {
  const template = document.querySelector("#toastTemplate");
  const node = template.content.firstElementChild.cloneNode(true);
  node.textContent = message;
  document.body.appendChild(node);
  requestAnimationFrame(() => node.classList.add("show"));
  setTimeout(() => {
    node.classList.remove("show");
    setTimeout(() => node.remove(), 250);
  }, 4800);
}

/* ============================================================
 * Performance metrics
 * ============================================================ */

function resetMetrics({ keepLast = false } = {}) {
  const previousLast = keepLast ? state.metrics.last : null;
  const previousTurns = keepLast ? state.metrics.turns : 0;
  const previousHistory = keepLast ? state.metrics.history : [];
  stopMicMeter();
  state.metrics = createMetricsState();
  if (keepLast) {
    state.metrics.last = previousLast || state.metrics.last;
    state.metrics.turns = previousTurns;
    state.metrics.history = previousHistory;
  }
  renderMetrics();
  renderAggregate();
}

function onSpeechStarted() {
  const now = performance.now();
  state.metrics.speechStartedAt = now;
  state.metrics.speechStoppedAt = 0;
  state.metrics.firstDeltaAt = 0;
  state.metrics.firstAudibleAt = 0;
  state.metrics.turnCompletedAt = 0;
  state.metrics.audioInputMs = 0;
  state.metrics.turn = { ttftMs: null, ttfaMs: null, e2eMs: null, rtfRatio: null };
  state.metrics.chars = 0;
  state.metrics.deltaCount = 0;
  state.metrics.charSamples = [];
  state.metrics.deltaSamples = [];
  state.metrics.sparkline = [];
  setStreamState("listening", "听写中", "持续接收麦克风音频…");
  renderMetrics();
}

function onSpeechStopped() {
  const now = performance.now();
  state.metrics.speechStoppedAt = now;
  if (state.metrics.speechStartedAt) {
    state.metrics.audioInputMs = now - state.metrics.speechStartedAt;
  }
  setStreamState("thinking", "模型推理", "等待首个 token / audio…");
  startStreamingTick();
  renderMetrics();
}

function onDeltaReceived(delta) {
  const now = performance.now();
  const text = typeof delta === "string" ? delta : "";

  if (!state.metrics.firstDeltaAt && state.metrics.speechStoppedAt) {
    state.metrics.firstDeltaAt = now;
    state.metrics.turn.ttftMs = Math.round(now - state.metrics.speechStoppedAt);
    flashTile(els.metric.tileTtft);
    setStreamState("streaming", "流式输出", "正在接收 delta…");
  }

  if (text) {
    state.metrics.chars += text.length;
    state.metrics.charSamples.push({ t: now, n: text.length });
  }
  state.metrics.deltaCount += 1;
  state.metrics.deltaSamples.push(now);
  pruneSamples(now);
  renderMetrics();
}

function onTurnCompleted() {
  const now = performance.now();
  if (state.metrics.turnCompletedAt) {
    return;
  }
  state.metrics.turnCompletedAt = now;
  if (state.metrics.speechStoppedAt) {
    state.metrics.turn.e2eMs = Math.round(now - state.metrics.speechStoppedAt);
    if (state.metrics.audioInputMs > 0) {
      state.metrics.turn.rtfRatio = state.metrics.turn.e2eMs / state.metrics.audioInputMs;
    }
  }
  state.metrics.last = { ...state.metrics.turn };
  state.metrics.history.push({ ...state.metrics.turn, at: now });
  if (state.metrics.history.length > 200) {
    state.metrics.history.splice(0, state.metrics.history.length - 200);
  }
  state.metrics.turns += 1;
  flashTile(els.metric.tileE2e);
  flashTile(els.metric.tileRtf);
  setStreamState("done", "本轮完成", formatTurnSummary());
  stopStreamingTick();
  renderMetrics();
  renderAggregate();
}

function formatTurnSummary() {
  const t = state.metrics.turn;
  const parts = [];
  if (t.ttftMs != null) parts.push(`TTFT ${t.ttftMs}ms`);
  if (t.e2eMs != null) parts.push(`E2E ${t.e2eMs}ms`);
  if (t.rtfRatio != null) parts.push(`RTF ${t.rtfRatio.toFixed(2)}×`);
  return parts.join(" · ") || "等待下一轮";
}

function pruneSamples(now) {
  const windowMs = 1000;
  state.metrics.charSamples = state.metrics.charSamples.filter((s) => now - s.t <= windowMs);
  state.metrics.deltaSamples = state.metrics.deltaSamples.filter((t) => now - t <= windowMs);
}

function startStreamingTick() {
  stopStreamingTick();
  state.metrics.streamingTickTimer = setInterval(() => {
    pruneSamples(performance.now());
    renderMetrics();
    pushSparkline();
  }, 200);
}

function stopStreamingTick() {
  if (state.metrics.streamingTickTimer) {
    clearInterval(state.metrics.streamingTickTimer);
    state.metrics.streamingTickTimer = 0;
  }
}

function pushSparkline() {
  const rate = state.metrics.charSamples.reduce((s, x) => s + x.n, 0);
  state.metrics.sparkline.push(rate);
  if (state.metrics.sparkline.length > 120) {
    state.metrics.sparkline.shift();
  }
  drawSparkline();
}

function drawSparkline() {
  const canvas = els.metric.sparkline;
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  const data = state.metrics.sparkline;
  if (!data.length) return;

  const max = Math.max(8, ...data);
  const step = w / Math.max(1, data.length - 1);
  ctx.beginPath();
  data.forEach((v, i) => {
    const x = i * step;
    const y = h - (v / max) * (h - 6) - 3;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.lineWidth = 2;
  ctx.strokeStyle = "rgba(0, 113, 227, 0.85)";
  ctx.stroke();

  // Fill
  ctx.lineTo(w, h);
  ctx.lineTo(0, h);
  ctx.closePath();
  ctx.fillStyle = "rgba(41, 151, 255, 0.18)";
  ctx.fill();
}

function startStatsPolling() {
  stopStatsPolling();
  let prevPacketsLost = null;
  let prevPacketsReceived = null;
  let prevInboundEnergy = null;

  els.mic.container.classList.add("is-active");

  state.metrics.statsTimer = setInterval(async () => {
    if (!state.pc) return;
    try {
      const stats = await state.pc.getStats();
      let rttMs = null;
      let jitterMs = null;
      let lossPct = null;
      let outboundAudioLevel = null;
      let inboundTotalEnergy = null;
      let inboundPacketsReceived = null;
      let inboundPacketsLost = null;

      stats.forEach((report) => {
        if (report.type === "media-source" && report.kind === "audio") {
          if (typeof report.audioLevel === "number") outboundAudioLevel = report.audioLevel;
        }
        if (report.type === "remote-inbound-rtp" && report.kind === "audio") {
          if (typeof report.roundTripTime === "number") rttMs = report.roundTripTime * 1000;
          if (typeof report.jitter === "number") jitterMs = Math.max(jitterMs ?? 0, report.jitter * 1000);
        }
        if (report.type === "inbound-rtp" && report.kind === "audio") {
          if (typeof report.jitter === "number") jitterMs = Math.max(jitterMs ?? 0, report.jitter * 1000);
          if (typeof report.packetsReceived === "number") inboundPacketsReceived = report.packetsReceived;
          if (typeof report.packetsLost === "number") inboundPacketsLost = report.packetsLost;
          if (typeof report.totalAudioEnergy === "number") inboundTotalEnergy = report.totalAudioEnergy;
          else if (typeof report.audioLevel === "number") {
            inboundTotalEnergy = (inboundTotalEnergy ?? 0) + report.audioLevel * report.audioLevel * 0.2;
          }
        }
        if (report.type === "candidate-pair" && (report.selected || report.nominated)) {
          if (typeof report.currentRoundTripTime === "number") {
            rttMs = Math.max(rttMs ?? 0, report.currentRoundTripTime * 1000);
          }
        }
      });

      if (outboundAudioLevel != null) {
        updateMicMeter(outboundAudioLevel);
      }

      if (
        state.mode === "agent" &&
        state.metrics.speechStoppedAt &&
        !state.metrics.firstAudibleAt &&
        inboundTotalEnergy != null &&
        prevInboundEnergy != null
      ) {
        const dEnergy = inboundTotalEnergy - prevInboundEnergy;
        if (dEnergy > 0.0005) {
          state.metrics.firstAudibleAt = performance.now();
          state.metrics.turn.ttfaMs = Math.round(state.metrics.firstAudibleAt - state.metrics.speechStoppedAt);
          flashTile(els.metric.tileTtfa);
          renderMetrics();
        }
      }
      prevInboundEnergy = inboundTotalEnergy;

      if (inboundPacketsReceived != null && inboundPacketsLost != null && prevPacketsReceived != null) {
        const dLost = inboundPacketsLost - prevPacketsLost;
        const dRecv = inboundPacketsReceived - prevPacketsReceived;
        const total = dLost + dRecv;
        if (total > 0) lossPct = (dLost / total) * 100;
      }
      prevPacketsLost = inboundPacketsLost;
      prevPacketsReceived = inboundPacketsReceived;

      state.metrics.rtcRttMs = rttMs;
      state.metrics.rtcJitterMs = jitterMs;
      if (lossPct != null) state.metrics.rtcLossPct = lossPct;
      renderNetworkChips();
    } catch (error) {
      // ignore transient stats errors
    }
  }, 200);
}

function stopStatsPolling() {
  if (state.metrics.statsTimer) {
    clearInterval(state.metrics.statsTimer);
    state.metrics.statsTimer = 0;
  }
}

function setStreamState(streamState, label, meta) {
  state.metrics.streamState = streamState;
  els.metric.streamDot.dataset.state = streamState;
  els.metric.streamLabel.textContent = label;
  els.metric.streamMeta.textContent = meta || "";

  const progress = els.metric.progress;
  if (streamState === "thinking" || streamState === "streaming") {
    progress.dataset.state = "indeterminate";
    els.metric.progressFill.style.inset = "";
  } else {
    delete progress.dataset.state;
    els.metric.progressFill.style.inset = streamState === "done" ? "0 0 0 0" : "0 100% 0 0";
  }
}

function flashTile(tile) {
  if (!tile) return;
  tile.classList.remove("is-flash");
  // Force reflow to restart animation
  void tile.offsetWidth;
  tile.classList.add("is-flash");
  setTimeout(() => tile.classList.remove("is-flash"), 800);
}

function renderMetrics() {
  const m = state.metrics;
  setTileValue(els.metric.tileTtft, els.metric.ttft, els.metric.ttftHint, m.turn.ttftMs, m.last.ttftMs, "ms", gradeLatency);
  setTileValue(els.metric.tileTtfa, els.metric.ttfa, els.metric.ttfaHint, m.turn.ttfaMs, m.last.ttfaMs, "ms", gradeLatency, state.mode === "agent" ? null : "仅 Agent 模式");
  setTileValue(els.metric.tileE2e, els.metric.e2e, els.metric.e2eHint, m.turn.e2eMs, m.last.e2eMs, "ms", gradeE2e);
  setTileValue(els.metric.tileRtf, els.metric.rtf, els.metric.rtfHint, m.turn.rtfRatio, m.last.rtfRatio, "ratio", gradeRtf);

  els.metric.chars.textContent = `${m.chars} · ${m.deltaCount}Δ`;
  els.metric.charRate.textContent = m.charSamples.reduce((s, x) => s + x.n, 0).toString();
  els.metric.deltaRate.textContent = m.deltaSamples.length.toString();
  els.metric.turns.textContent = String(m.turns);
  if (els.metric.azure) els.metric.azure.textContent = formatServerTiming();
  renderNetworkChips();
}

function setTileValue(tile, valueEl, hintEl, current, previous, unit, grader, overrideHint) {
  const hasCurrent = current != null && Number.isFinite(current);
  const hasPrevious = previous != null && Number.isFinite(previous);

  let display = "—";
  let grade = "muted";

  if (hasCurrent) {
    display = unit === "ratio" ? current.toFixed(2) : String(Math.round(current));
    grade = grader(current);
  } else if (hasPrevious) {
    display = unit === "ratio" ? previous.toFixed(2) : String(Math.round(previous));
    grade = grader(previous);
  }

  valueEl.textContent = display;
  tile.dataset.grade = grade;

  if (overrideHint) {
    hintEl.textContent = overrideHint;
  } else if (hasCurrent && hasPrevious) {
    const delta = current - previous;
    const arrow = delta > 0 ? "▲" : delta < 0 ? "▼" : "·";
    const formatted = unit === "ratio" ? Math.abs(delta).toFixed(2) : Math.round(Math.abs(delta));
    hintEl.textContent = `本轮 · 上轮 ${unit === "ratio" ? previous.toFixed(2) : Math.round(previous)} ${arrow}${formatted}`;
  } else if (hasCurrent) {
    hintEl.textContent = "本轮";
  } else if (hasPrevious) {
    hintEl.textContent = `上轮 ${unit === "ratio" ? previous.toFixed(2) : Math.round(previous)}`;
  } else {
    hintEl.textContent = "等待数据";
  }
}

function gradeLatency(ms) {
  if (ms < 500) return "good";
  if (ms < 1200) return "ok";
  return "bad";
}

function gradeE2e(ms) {
  if (ms < 1500) return "good";
  if (ms < 3000) return "ok";
  return "bad";
}

function gradeRtf(ratio) {
  if (ratio < 1) return "good";
  if (ratio < 1.5) return "ok";
  return "bad";
}

function renderNetworkChips() {
  els.metric.rtt.textContent = formatNumber(state.metrics.rtcRttMs, "ms");
  els.metric.jitter.textContent = formatNumber(state.metrics.rtcJitterMs, "ms");
  els.metric.loss.textContent = state.metrics.rtcLossPct == null ? "—" : `${state.metrics.rtcLossPct.toFixed(1)}%`;
}

function formatNumber(value, unit) {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${Math.round(value)}${unit}`;
}

function updateSetupHint() {
  const m = state.metrics;
  const parts = [];
  if (m.iceConnectedAt && m.sessionStartedAt) {
    parts.push(`ICE ${Math.round(m.iceConnectedAt - m.sessionStartedAt)}ms`);
  }
  if (m.dcOpenAt && m.sessionStartedAt) {
    parts.push(`DC ${Math.round(m.dcOpenAt - m.sessionStartedAt)}ms`);
  }
  if (m.sessionCreatedAt && m.sessionStartedAt) {
    parts.push(`session ${Math.round(m.sessionCreatedAt - m.sessionStartedAt)}ms`);
  }
  els.metric.setup.textContent = parts.length ? parts.join(" · ") : "—";
}

/* ============================================================
 * Mic input level meter (driven by pc.getStats media-source.audioLevel)
 * ============================================================ */

function updateMicMeter(audioLevel) {
  if (!els.mic?.container) return;
  // audioLevel is RFC 6464 linear amplitude (0..1). Convert to dBFS-ish.
  const db = audioLevel > 0 ? 20 * Math.log10(audioLevel) : -100;
  const level = Math.max(0, Math.min(100, ((db + 60) / 60) * 100));

  const mic = state.metrics.mic;
  const now = performance.now();
  let peak = mic.peak;
  if (level >= peak || now > mic.peakHoldUntil) {
    peak = level;
    mic.peakHoldUntil = now + 850;
  } else {
    // Exponential decay: ~8%/tick, smoother than fixed step.
    peak = Math.max(level, peak * 0.92);
  }
  mic.peak = peak;

  els.mic.fill.style.inset = `0 ${(100 - level).toFixed(1)}% 0 0`;
  els.mic.peak.style.left = `${peak.toFixed(1)}%`;
  els.mic.value.textContent = db <= -90 ? "— dB" : `${db.toFixed(1)} dB`;
  els.mic.container.classList.toggle("is-clipping", audioLevel >= 0.985);
  els.mic.container.setAttribute("aria-valuenow", String(Math.round(level)));
}

function stopMicMeter() {
  const mic = state.metrics?.mic;
  if (mic) {
    mic.peak = 0;
    mic.peakHoldUntil = 0;
  }
  if (els.mic?.container) {
    els.mic.container.classList.remove("is-active", "is-clipping");
    els.mic.container.setAttribute("aria-valuenow", "0");
  }
  if (els.mic?.fill) els.mic.fill.style.inset = "0 100% 0 0";
  if (els.mic?.peak) els.mic.peak.style.left = "0%";
  if (els.mic?.value) els.mic.value.textContent = "— dB";
}

/* ============================================================
 * Server-Timing
 * ============================================================ */

function captureServerTiming(header) {
  if (!header) {
    state.metrics.serverTiming = null;
    renderMetrics();
    return;
  }

  const entries = {};
  header.split(",").forEach((part) => {
    const segments = part.split(";").map((s) => s.trim()).filter(Boolean);
    if (!segments.length) return;
    const name = segments[0];
    let dur = null;
    for (let i = 1; i < segments.length; i += 1) {
      const [key, value] = segments[i].split("=");
      if (key === "dur") dur = parseFloat(value);
    }
    if (name && Number.isFinite(dur)) {
      entries[name] = dur;
    }
  });

  state.metrics.serverTiming = entries;
  renderMetrics();
}

function formatServerTiming() {
  const t = state.metrics.serverTiming;
  if (!t) return "—";
  const parts = [];
  if (t.secret != null) parts.push(`secret ${Math.round(t.secret)}ms`);
  if (t.sdp != null) parts.push(`sdp ${Math.round(t.sdp)}ms`);
  if (!parts.length && t.total != null) parts.push(`${Math.round(t.total)}ms`);
  return parts.join(" · ") || "—";
}

/* ============================================================
 * Aggregate p50/p95
 * ============================================================ */

const AGGREGATE_KEYS = [
  { row: "ttft", field: "ttftMs", unit: "ms" },
  { row: "ttfa", field: "ttfaMs", unit: "ms" },
  { row: "e2e", field: "e2eMs", unit: "ms" },
  { row: "rtf", field: "rtfRatio", unit: "ratio" },
];

function renderAggregate() {
  const history = state.metrics.history;
  const container = els.metric.aggregate;
  if (!container) return;

  if (history.length < 5) {
    container.classList.add("hidden");
    return;
  }

  container.classList.remove("hidden");
  els.metric.aggregateMeta.textContent = `n = ${history.length}`;

  AGGREGATE_KEYS.forEach(({ row, field, unit }) => {
    const rowEl = container.querySelector(`tr[data-row="${row}"]`);
    if (!rowEl) return;
    const values = history.map((entry) => entry[field]).filter((v) => v != null && Number.isFinite(v));
    if (!values.length) {
      ["p50", "p95", "min", "max"].forEach((cell) => {
        rowEl.querySelector(`td[data-cell="${cell}"]`).textContent = "—";
      });
      return;
    }

    const sorted = [...values].sort((a, b) => a - b);
    const stats = {
      p50: percentile(sorted, 0.5),
      p95: percentile(sorted, 0.95),
      min: sorted[0],
      max: sorted[sorted.length - 1],
    };

    Object.entries(stats).forEach(([cell, value]) => {
      const target = rowEl.querySelector(`td[data-cell="${cell}"]`);
      if (target) target.textContent = formatAggregateValue(value, unit);
    });
  });
}

function percentile(sortedValues, q) {
  if (!sortedValues.length) return null;
  const rank = (sortedValues.length - 1) * q;
  const low = Math.floor(rank);
  const high = Math.ceil(rank);
  if (low === high) return sortedValues[low];
  const fraction = rank - low;
  return sortedValues[low] + (sortedValues[high] - sortedValues[low]) * fraction;
}

function formatAggregateValue(value, unit) {
  if (value == null || !Number.isFinite(value)) return "—";
  return unit === "ratio" ? `${value.toFixed(2)}×` : `${Math.round(value)}ms`;
}
