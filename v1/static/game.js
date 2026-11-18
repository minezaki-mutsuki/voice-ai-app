(function () {
  "use strict";

  var state = {
    event: "robot_turn_started",
    turn: "robot",
    game_status: "playing",
    advantage: "losing",
    previous_advantage: "even",
    opponent_threat: true,
    robot_move_column: 4,
    winner: null
  };

  var fields = {
    turn: "turnSelect",
    game_status: "gameStatusSelect",
    advantage: "advantageSelect",
    opponent_threat: "threatToggle",
    robot_move_column: "columnSelect",
    winner: "winnerSelect"
  };

  function normalize(input) {
    var clean = Object.assign({}, state, input || {});
    if (["human", "robot"].indexOf(clean.turn) < 0) clean.turn = "human";
    if (["not_started", "playing", "ended"].indexOf(clean.game_status) < 0) clean.game_status = "not_started";
    if (["winning", "even", "losing"].indexOf(clean.advantage) < 0) clean.advantage = "even";
    clean.opponent_threat = Boolean(clean.opponent_threat);
    clean.robot_move_column = Math.max(1, Math.min(7, Number(clean.robot_move_column) || 4));
    if (["robot", "human", "draw"].indexOf(clean.winner) < 0) clean.winner = null;
    return clean;
  }

  function publish() {
    var detail = getState();
    window.dispatchEvent(new CustomEvent("connect4:state", { detail: detail }));
    if (typeof window.onConnect4StateChanged === "function") window.onConnect4StateChanged(detail);
  }

  function setState(next) {
    state = normalize(Object.assign({}, state, next || {}));
    renderControls();
    publish();
    return getState();
  }

  function getState() {
    return Object.assign({}, state);
  }

  function renderControls() {
    Object.keys(fields).forEach(function (key) {
      var control = document.getElementById(fields[key]);
      if (!control) return;
      if (key === "opponent_threat") control.checked = state[key];
      else control.value = key === "winner" ? (state.winner || "none") : String(state[key]);
    });
  }

  function bindControls() {
    Object.keys(fields).forEach(function (key) {
      var control = document.getElementById(fields[key]);
      if (!control) return;
      control.addEventListener("change", function () {
        var next = {};
        if (key === "opponent_threat") next[key] = control.checked;
        else if (key === "winner") next[key] = control.value === "none" ? null : control.value;
        else if (key === "robot_move_column") next[key] = Number(control.value);
        else next[key] = control.value;
        setState(next);
      });
    });
  }

  async function loadMock() {
    try {
      var response = await fetch("/api/game-state");
      if (response.ok) setState(await response.json());
    } catch (error) {
      // The built-in defaults still allow the dashboard to work offline.
      setState({});
    }
  }

  bindControls();
  renderControls();
  window.Connect4Game = { getState: getState, setState: setState, loadMock: loadMock };
  window.dispatchEvent(new CustomEvent("connect4:state", { detail: getState() }));
})();
