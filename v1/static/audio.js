(function () {
  "use strict";

  var RATE = 24000;
  var state = {
    socket: null,
    stream: null,
    context: null,
    source: null,
    processor: null,
    muteNode: null,
    suppressed: false,
    speaking: false,
    silentMs: 0,
    callbacks: {},
    stoppedByUser: false
  };

  function emitStatus(text, status) {
    if (typeof state.callbacks.onStatus === "function") state.callbacks.onStatus(text, status);
  }

  function sendPcm(floatSamples) {
    if (!state.socket || state.socket.readyState !== WebSocket.OPEN || state.suppressed) return;
    var pcm = new Int16Array(floatSamples.length);
    for (var i = 0; i < floatSamples.length; i += 1) {
      var sample = Math.max(-1, Math.min(1, floatSamples[i]));
      pcm[i] = sample < 0 ? sample * 32768 : sample * 32767;
    }
    state.socket.send(pcm.buffer);
  }

  function resample(input, inputRate) {
    if (inputRate === RATE) return input.slice();
    var ratio = inputRate / RATE;
    var outputLength = Math.max(1, Math.floor(input.length / ratio));
    var output = new Float32Array(outputLength);
    for (var i = 0; i < outputLength; i += 1) {
      var position = i * ratio;
      var left = Math.floor(position);
      var right = Math.min(left + 1, input.length - 1);
      var fraction = position - left;
      output[i] = input[left] * (1 - fraction) + input[right] * fraction;
    }
    return output;
  }

  function level(samples) {
    var sum = 0;
    for (var i = 0; i < samples.length; i += 1) sum += samples[i] * samples[i];
    return Math.sqrt(sum / Math.max(1, samples.length));
  }

  function processAudio(event) {
    if (state.suppressed) return;
    var samples = resample(event.inputBuffer.getChannelData(0), state.context.sampleRate);
    var currentLevel = level(samples);
    var isVoice = currentLevel > 0.012;

    if (!state.speaking && isVoice) {
      state.speaking = true;
      state.silentMs = 0;
      emitStatus("聞き取り中", "listening");
    }
    if (!state.speaking) return;

    sendPcm(samples);
    if (isVoice) {
      state.silentMs = 0;
    } else {
      state.silentMs += (samples.length / RATE) * 1000;
      if (state.silentMs >= 850) {
        state.speaking = false;
        state.silentMs = 0;
        if (state.socket && state.socket.readyState === WebSocket.OPEN) {
          state.socket.send(JSON.stringify({ type: "commit" }));
        }
        emitStatus("発話を認識中", "processing");
      }
    }
  }

  function handleServerMessage(message) {
    if (message.type === "ready") {
      emitStatus(message.mode === "mock" ? "Mock音声待機中" : "Realtime接続済", "ready");
      if (typeof state.callbacks.onReady === "function") state.callbacks.onReady(message.mode);
    } else if (message.type === "connecting") {
      emitStatus("Azureへ接続中", "connecting");
    } else if (message.type === "error") {
      emitStatus("接続エラー", "error");
      if (typeof state.callbacks.onError === "function") state.callbacks.onError(message.message || message.detail || "Realtime APIエラー");
    } else if (message.type === "conversation.item.input_audio_transcription.delta") {
      if (typeof state.callbacks.onTranscriptDelta === "function") state.callbacks.onTranscriptDelta(message.delta || "");
    } else if (message.type === "conversation.item.input_audio_transcription.completed") {
      emitStatus("認識完了", "ready");
      if (typeof state.callbacks.onTranscript === "function") state.callbacks.onTranscript(message.transcript || "");
    } else if (message.type === "conversation.item.input_audio_transcription.failed") {
      emitStatus("認識失敗", "error");
      if (typeof state.callbacks.onError === "function") state.callbacks.onError("音声認識に失敗しました。少し待ってから話し直してください。");
    }
  }

  async function start(options) {
    stop();
    state.callbacks = options || {};
    state.stoppedByUser = false;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error("このブラウザーではマイクを利用できません。localhostで開き、マイク権限を確認してください。");
    }

    emitStatus("マイク権限を確認中", "connecting");
    try {
      state.stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true }
      });
    } catch (error) {
      var message = error && error.name === "NotAllowedError"
        ? "マイクが許可されていません。ブラウザーのサイト設定でマイクを許可してください。"
        : "マイクを開けませんでした: " + (error && error.message ? error.message : String(error));
      emitStatus("マイクエラー", "error");
      stop();
      throw new Error(message);
    }

    try {
      var AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) throw new Error("このブラウザーはAudioContextに対応していません。");
      try {
        state.context = new AudioContextClass({ sampleRate: RATE });
      } catch (sampleRateError) {
        state.context = new AudioContextClass();
      }
      await state.context.resume();
    } catch (error) {
      stop();
      throw new Error("音声デバイスを初期化できません: " + error.message);
    }

    var scheme = window.location.protocol === "https:" ? "wss:" : "ws:";
    var mode = options && options.mode ? options.mode : "mock";
    var url = scheme + "//" + window.location.host + "/ws/transcription?mode=" + encodeURIComponent(mode);

    await new Promise(function (resolve, reject) {
      var settled = false;
      var timer = window.setTimeout(function () {
        if (!settled) {
          settled = true;
          reject(new Error("音声サーバーの応答がタイムアウトしました。"));
        }
      }, 18000);

      state.socket = new WebSocket(url);
      state.socket.binaryType = "arraybuffer";
      state.socket.onmessage = function (event) {
        var message;
        try { message = JSON.parse(event.data); } catch (error) { return; }
        handleServerMessage(message);
        if (!settled && message.type === "ready") {
          settled = true;
          window.clearTimeout(timer);
          resolve();
        } else if (!settled && message.type === "error") {
          settled = true;
          window.clearTimeout(timer);
          reject(new Error(message.message || "音声サーバーに接続できません。"));
        }
      };
      state.socket.onerror = function () {
        if (!settled) {
          settled = true;
          window.clearTimeout(timer);
          reject(new Error("音声サーバーに接続できません。サーバーが起動中か確認してください。"));
        }
      };
      state.socket.onclose = function () {
        if (!settled) {
          settled = true;
          window.clearTimeout(timer);
          reject(new Error("音声サーバーが接続を閉じました。"));
        } else if (!state.stoppedByUser) {
          emitStatus("接続終了", "error");
        }
      };
    });

    if (!state.stream || !state.context) return;
    state.source = state.context.createMediaStreamSource(state.stream);
    state.processor = state.context.createScriptProcessor(4096, 1, 1);
    state.muteNode = state.context.createGain();
    state.muteNode.gain.value = 0;
    state.processor.onaudioprocess = processAudio;
    state.source.connect(state.processor);
    state.processor.connect(state.muteNode);
    state.muteNode.connect(state.context.destination);
    emitStatus(mode === "mock" ? "Mock音声待機中" : "Realtime接続済", "ready");
  }

  function stop() {
    state.stoppedByUser = true;
    state.speaking = false;
    state.silentMs = 0;
    if (state.processor) {
      state.processor.onaudioprocess = null;
      try { state.processor.disconnect(); } catch (error) {}
    }
    if (state.source) { try { state.source.disconnect(); } catch (error) {} }
    if (state.muteNode) { try { state.muteNode.disconnect(); } catch (error) {} }
    if (state.stream) state.stream.getTracks().forEach(function (track) { track.stop(); });
    if (state.socket && state.socket.readyState < WebSocket.CLOSING) state.socket.close();
    if (state.context && state.context.state !== "closed") state.context.close();
    state.stream = null;
    state.socket = null;
    state.context = null;
    state.source = null;
    state.processor = null;
    state.muteNode = null;
  }

  function suppressMicrophone(suppress) {
    state.suppressed = Boolean(suppress);
    if (state.suppressed) {
      state.speaking = false;
      state.silentMs = 0;
    }
  }

  window.Connect4Audio = {
    start: start,
    stop: stop,
    suppressMicrophone: suppressMicrophone,
    isActive: function () { return Boolean(state.socket && state.socket.readyState === WebSocket.OPEN); }
  };
})();
