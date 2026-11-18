(function () {
  "use strict";

  var conversation = [];
  var isSending = false;
  var isVoiceActive = false;
  var azureConfigured = false;
  var chatConnected = false;
  var realtimeConnected = false;
  var currentGame = window.Connect4Game.getState();

  var el = function (id) { return document.getElementById(id); };

  function showError(message) {
    var box = el("errorBox");
    box.textContent = message;
    box.hidden = !message;
  }

  function connectionStatus() {
    var mode = el("modeSelect").value;
    var dot = el("azureDot");
    var label = el("azureStatus");
    dot.className = "status-dot";
    if (mode === "mock") {
      label.textContent = "Mock稼働";
      dot.classList.add("green");
    } else if (!azureConfigured) {
      label.textContent = "Azure未設定";
      dot.classList.add("red");
    } else if (chatConnected || realtimeConnected) {
      label.textContent = realtimeConnected ? "Realtime接続済" : "Chat接続済";
      dot.classList.add("green");
    } else {
      label.textContent = "Azure設定済・未接続";
      dot.classList.add("amber");
    }
  }

  function updateEmotion() {
    currentGame = window.Connect4Game.getState();
    var result = window.Connect4Emotion.evaluate(currentGame, {
      bluffEnabled: el("bluffToggle").checked,
      bluffProbability: Number(el("bluffProbability").value)
    });
    el("emotionLabel").textContent = result.bluffing ? result.emotion + " · ハッタリ中" : result.emotion;
    el("emotionDescription").textContent = result.description;
    el("emotionFace").textContent = result.face;
    el("emotionVector").textContent = "自信 " + result.vector.confidence + " · 緊張 " + result.vector.tension + " · 喜び " + result.vector.joy;
    return result;
  }

  function personality() {
    return el("personalitySelect").value;
  }

  function currentSettings() {
    return {
      personality: personality(),
      bluffEnabled: el("bluffToggle").checked,
      bluffProbability: Number(el("bluffProbability").value)
    };
  }

  function addMessage(role, content, active) {
    el("emptyChat").hidden = true;
    var bubble = document.createElement("div");
    bubble.className = "message " + role;
    if (active) bubble.dataset.active = "true";
    var label = document.createElement("span");
    label.className = "message-label";
    label.textContent = role === "user" ? "YOU" : "CONNECT FOUR AI";
    var text = document.createElement("span");
    text.className = "message-content";
    text.textContent = content;
    bubble.appendChild(label);
    bubble.appendChild(text);
    el("chatHistory").appendChild(bubble);
    el("chatHistory").scrollTop = el("chatHistory").scrollHeight;
    return text;
  }

  function renderHistory() {
    var box = el("chatHistory");
    box.innerHTML = "";
    var empty = document.createElement("div");
    empty.className = "empty-chat";
    empty.id = "emptyChat";
    empty.innerHTML = "<span>✧</span><p>ゲームや好きなことを話しかけてください。</p><small>テキスト入力、または音声会話から始められます。</small>";
    empty.hidden = conversation.length > 0;
    box.appendChild(empty);
    conversation.forEach(function (item) {
      addMessage(item.role, item.content, false);
    });
  }

  async function sendMessage(rawText) {
    var text = String(rawText || "").trim();
    if (!text || isSending) return;
    showError("");
    isSending = true;
    el("chatInput").disabled = true;
    el("chatForm").querySelector("button").disabled = true;
    conversation.push({ role: "user", content: text });
    addMessage("user", text, false);
    var output = addMessage("assistant", "", true);
    var mode = el("modeSelect").value;
    var emotion = updateEmotion();
    var settings = currentSettings();
    var payload = {
      mode: mode,
      messages: conversation.slice(-30),
      system_prompt: window.Connect4Emotion.systemPrompt(currentGame, settings, emotion),
      emotion: emotion.emotion,
      bluffing: emotion.bluffing,
      personality: settings.personality
    };
    var accumulated = "";

    try {
      var response = await fetch("/api/chat/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      if (!response.ok) {
        var failureText = await response.text();
        throw new Error(failureText || "チャットAPIに接続できません。");
      }
      if (!response.body) throw new Error("このブラウザーではストリーミング応答を利用できません。");
      var reader = response.body.getReader();
      var decoder = new TextDecoder();
      var buffer = "";
      var ended = false;

      while (!ended) {
        var part = await reader.read();
        if (part.done) break;
        buffer += decoder.decode(part.value, { stream: true });
        var splitAt;
        while ((splitAt = buffer.indexOf("\n\n")) >= 0) {
          var block = buffer.slice(0, splitAt);
          buffer = buffer.slice(splitAt + 2);
          var lines = block.split(/\r?\n/);
          var eventName = "";
          var dataText = "";
          lines.forEach(function (line) {
            if (line.indexOf("event:") === 0) eventName = line.slice(6).trim();
            else if (line.indexOf("data:") === 0) dataText += line.slice(5).trim();
          });
          if (!dataText) continue;
          var eventData;
          try { eventData = JSON.parse(dataText); } catch (error) { continue; }
          if (eventName === "error") throw new Error(eventData.message || "Azure APIエラー");
          if (eventData.delta) {
            accumulated += eventData.delta;
            output.textContent = accumulated;
            el("chatHistory").scrollTop = el("chatHistory").scrollHeight;
          }
          if (eventData.done) ended = true;
        }
      }

      if (!accumulated) accumulated = "応答が空でした。DeploymentとAPI設定を確認してください。";
      conversation.push({ role: "assistant", content: accumulated });
      output.parentElement.removeAttribute("data-active");
      if (mode === "azure") chatConnected = true;
      connectionStatus();
      if (el("ttsToggle").checked) speak(accumulated);
    } catch (error) {
      output.parentElement.remove();
      conversation.pop();
      showError(error.message || String(error));
      if (mode === "azure") {
        chatConnected = false;
        connectionStatus();
      }
    } finally {
      isSending = false;
      el("chatInput").disabled = false;
      el("chatForm").querySelector("button").disabled = false;
      el("chatInput").focus();
    }
  }

  function speak(text) {
    if (!("speechSynthesis" in window) || !("SpeechSynthesisUtterance" in window)) {
      showError("このブラウザーでは音声読み上げに対応していません。");
      return;
    }
    window.speechSynthesis.cancel();
    var utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "ja-JP";
    utterance.rate = 1.0;
    utterance.onstart = function () {
      if (window.Connect4Audio) window.Connect4Audio.suppressMicrophone(true);
    };
    utterance.onend = function () {
      if (window.Connect4Audio) window.Connect4Audio.suppressMicrophone(false);
    };
    utterance.onerror = function () {
      if (window.Connect4Audio) window.Connect4Audio.suppressMicrophone(false);
    };
    window.speechSynthesis.speak(utterance);
  }

  function setMicStatus(text, status) {
    el("micStatus").textContent = text;
    var dot = el("micDot");
    dot.className = "status-dot";
    if (status === "ready" || status === "listening") dot.classList.add("green");
    else if (status === "connecting" || status === "processing") dot.classList.add("amber");
    else if (status === "error") dot.classList.add("red");
  }

  function setVoiceButton(active) {
    isVoiceActive = active;
    el("voiceButtonLabel").textContent = active ? "音声会話を停止" : "音声会話を開始";
    el("voiceButton").classList.toggle("active", active);
  }

  function onTranscript(text) {
    var transcript = String(text || "").trim();
    el("transcriptText").textContent = transcript || "音声を認識できませんでした。もう一度お試しください。";
    el("transcriptText").classList.toggle("muted", !transcript);
    el("recognitionState").textContent = "認識完了";
    if (transcript) sendMessage(transcript);
  }

  function startVoice() {
    showError("");
    el("recognitionState").textContent = "接続中";
    el("transcriptText").textContent = "マイクに向かって話してください。";
    el("transcriptText").classList.remove("muted");
    window.Connect4Audio.start({
      mode: el("modeSelect").value,
      onStatus: function (text, status) {
        setMicStatus(text, status);
        el("recognitionState").textContent = status === "listening" ? "発話を検出" : (status === "processing" ? "発話区切りを処理中" : text);
      },
      onReady: function (mode) {
        setVoiceButton(true);
        if (mode === "azure") {
          realtimeConnected = true;
          connectionStatus();
        }
      },
      onTranscriptDelta: function (delta) {
        var current = el("transcriptText");
        if (current.classList.contains("muted") || current.textContent.indexOf("マイクに向かって") === 0) current.textContent = "";
        current.classList.remove("muted");
        current.textContent += delta;
      },
      onTranscript: onTranscript,
      onError: showError
    }).catch(function (error) {
      showError(error.message || String(error));
      setMicStatus("停止中", "error");
      setVoiceButton(false);
      realtimeConnected = false;
      connectionStatus();
      window.Connect4Audio.stop();
    });
  }

  async function loadHealth() {
    try {
      var response = await fetch("/api/health");
      var health = await response.json();
      azureConfigured = Boolean(health.azure_configured);
      if (azureConfigured && health.provider_default === "azure") el("modeSelect").value = "azure";
      else el("modeSelect").value = "mock";
    } catch (error) {
      azureConfigured = false;
      el("modeSelect").value = "mock";
    }
    connectionStatus();
  }

  el("chatForm").addEventListener("submit", function (event) {
    event.preventDefault();
    var value = el("chatInput").value;
    el("chatInput").value = "";
    sendMessage(value);
  });
  el("voiceButton").addEventListener("click", function () {
    if (isVoiceActive) {
      window.Connect4Audio.stop();
      window.speechSynthesis && window.speechSynthesis.cancel();
      setVoiceButton(false);
      setMicStatus("停止中", "");
      el("recognitionState").textContent = "待機中";
      realtimeConnected = false;
      connectionStatus();
    } else {
      startVoice();
    }
  });
  el("modeSelect").addEventListener("change", function () {
    chatConnected = false;
    realtimeConnected = false;
    connectionStatus();
    if (isVoiceActive) {
      window.Connect4Audio.stop();
      setVoiceButton(false);
    }
  });
  el("clearChatButton").addEventListener("click", function () {
    conversation = [];
    renderHistory();
    showError("");
  });
  el("bluffProbability").addEventListener("input", function () {
    el("probabilityValue").textContent = el("bluffProbability").value;
    updateEmotion();
  });
  el("ttsToggle").addEventListener("change", function () {
    el("ttsLabel").textContent = el("ttsToggle").checked ? "読み上げ ON" : "読み上げ OFF";
  });
  ["bluffToggle", "personalitySelect"].forEach(function (id) {
    el(id).addEventListener("change", updateEmotion);
  });
  window.addEventListener("connect4:state", function (event) {
    currentGame = event.detail;
    updateEmotion();
  });

  window.Connect4Game.loadMock();
  loadHealth();
  updateEmotion();
})();
