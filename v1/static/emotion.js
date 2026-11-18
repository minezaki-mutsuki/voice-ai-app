(function () {
  "use strict";

  function evaluate(state, settings) {
    var s = state || {};
    var opts = settings || {};
    var confidence = s.advantage === "winning" ? 82 : (s.advantage === "losing" ? 25 : 52);
    var tension = s.advantage === "losing" ? 67 : (s.advantage === "winning" ? 20 : 35);
    var joy = s.advantage === "winning" ? 69 : (s.advantage === "losing" ? 20 : 42);
    var frustration = s.advantage === "losing" ? 58 : 14;

    if (s.opponent_threat) {
      tension = Math.min(98, tension + 22);
      confidence = Math.max(8, confidence - 13);
    }
    if (s.game_status === "not_started") {
      confidence = 50;
      tension = 12;
      joy = 32;
      frustration = 4;
    }
    if (s.game_status === "ended") {
      confidence = s.winner === "robot" ? 100 : (s.winner === "human" ? 20 : 52);
      joy = s.winner === "robot" ? 100 : (s.winner === "human" ? 18 : 48);
      frustration = s.winner === "human" ? 88 : 6;
      tension = s.winner === "human" ? 45 : 10;
    }

    var emotion = "冷静";
    var description = "盤面を観察中";
    var face = "◉";
    if (s.game_status === "not_started") {
      emotion = "期待";
      description = "対戦の始まりを待っています";
      face = "✧";
    } else if (s.game_status === "ended" && s.winner === "robot") {
      emotion = "喜び";
      description = "勝利を喜んでいます";
      face = "✦";
    } else if (s.game_status === "ended" && s.winner === "human") {
      emotion = "悔しさ";
      description = "負けを惜しんでいます";
      face = "◉";
    } else if (s.game_status === "ended" && s.winner === "draw") {
      emotion = "納得";
      description = "引き分けを受け止めています";
      face = "◎";
    } else if (s.advantage === "winning") {
      emotion = "自信";
      description = "優勢な流れを感じています";
      face = "✦";
    } else if (s.advantage === "losing") {
      emotion = "焦り";
      description = s.opponent_threat ? "相手の勝ち筋に警戒しています" : "逆転の手を探しています";
      face = "◉";
    }

    var bluffing = Boolean(
      s.game_status === "playing" &&
      s.advantage === "losing" &&
      opts.bluffEnabled &&
      Math.random() * 100 < Number(opts.bluffProbability || 0)
    );

    return {
      emotion: emotion,
      description: description,
      face: face,
      bluffing: bluffing,
      vector: {
        confidence: Math.round(confidence),
        tension: Math.round(tension),
        joy: Math.round(joy),
        frustration: Math.round(frustration)
      }
    };
  }

  function systemPrompt(state, settings, result) {
    var personality = {
      kind: "やさしく親しみやすい。相手を尊重し、短く穏やかな日本語で話す。",
      normal: "自然で会話しやすい。短く明るい日本語で話す。",
      cheeky: "少し生意気で遊び心がある。相手を傷つける言葉は使わない。"
    };
    return [
      "あなたはコネクトフォーの対戦相手AIです。日本語で1〜3文、音声で聞き取りやすく自然に返答してください。",
      "性格: " + (personality[settings.personality] || personality.normal),
      "現在のゲーム状態: " + JSON.stringify(state),
      "現在の感情: " + result.emotion + "。感情ベクトル(0〜100): 自信=" + result.vector.confidence + ", 緊張=" + result.vector.tension + ", 喜び=" + result.vector.joy + ", 悔しさ=" + result.vector.frustration + "。",
      result.bluffing ? "今はハッタリ中です。不利さを隠して余裕があるように振る舞ってください。ただし本当の盤面評価、勝敗、次の一手を偽って変更したことにしないでください。" : "ゲーム状況に合う感情を言葉に反映してください。",
      "次の一手や勝敗を決めたり、実際のゲーム状態を変更したと主張したりしないでください。ハッタリは発言の雰囲気だけです。",
      "現在のロボットの候補列は" + state.robot_move_column + "列目です。ゲームロジックが確定した手ではないので、確定手のように扱わないでください。"
    ].join("\n");
  }

  window.Connect4Emotion = { evaluate: evaluate, systemPrompt: systemPrompt };
})();
