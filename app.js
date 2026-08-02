(() => {
  "use strict";

  const API_URL =
    "https://script.google.com/macros/s/AKfycbygvSsokMuhVJDiuoItI7rNmxgqOYcAKlUQ_XYIBa20ekxC1nrmbx35tTl5rTQlJmIa/exec";
  const CAPTAIN_SESSION_KEY = "triviaGymSurCaptainSession";
  const DEBUG_PERFORMANCE = false;

  const state = {
    currentView: "homeView",
    adminPin: "",
    adminAuthenticated: false,
    adminTeamsTimer: null,
    adminTeamsBusy: false,
    adminPollTimer: null,
    adminClockTimer: null,
    adminPollingBusy: false,
    captainPollTimer: null,
    captainClockTimer: null,
    captainPollingBusy: false,
    toastTimer: null,
    modalResolve: null,
    registering: false,
    captainSession: null,
    captainGameState: null,
    selectedAnswer: "",
    optimisticAnswer: "",
    optimisticStatus: "",
    submittingAnswer: false,
    lastCaptainVersion: 0,
    lastCaptainAnswerVersion: -1,
    lastAdminVersion: 0,
    lastAdminAnswerVersion: -1,
    serverOffsetMs: 0,
    questionBank: [],
    filteredQuestions: [],
    usedQuestions: new Set(),
    adminChoosingNext: false,
  };

  const $ = (id) => document.getElementById(id);

  document.addEventListener("DOMContentLoaded", init);

  function init() {
    $("brandBtn").addEventListener("click", goHome);
    $("homeBtn").addEventListener("click", goHome);
    $("goRegister").addEventListener("click", () => {
      showView("registerView");
      focusLater("nameInput");
    });
    $("goCaptain").addEventListener("click", openCaptainEntry);
    $("goAdmin").addEventListener("click", () => {
      if (state.adminAuthenticated) openAdmin();
      else {
        showView("adminLoginView");
        focusLater("pinInput");
      }
    });

    $("registerForm").addEventListener("submit", registerParticipant);
    $("registerAnother").addEventListener("click", startAnotherRegistration);
    $("assignmentHome").addEventListener("click", goHome);
    $("captainLoginForm").addEventListener("submit", loginCaptain);
    $("captainLogout").addEventListener("click", logoutCaptain);
    $("captainRefreshBtn").addEventListener(
      "click",
      forceRefreshCaptainGame,
    );
    $("captainGameContent").addEventListener("click", handleCaptainGameClick);
    $("adminLoginForm").addEventListener("submit", loginAdmin);
    $("refreshBtn").addEventListener("click", () => loadAdminData(true));
    $("resetBtn").addEventListener("click", resetParticipants);
    $("teamsGrid").addEventListener("click", handleTeamAction);

    $("questionCategorySelect").addEventListener("change", updateQuestionSelect);
    $("questionSearchInput").addEventListener("input", updateQuestionSelect);
    $("questionSelect").addEventListener("change", renderQuestionPreview);
    $("launchQuestionBtn").addEventListener("click", launchSelectedQuestion);
    $("nextQuestionBtn").addEventListener("click", focusNextQuestion);
    $("finishGameBtn").addEventListener("click", finishGame);
    $("resetGameBtn").addEventListener("click", resetGame);

    document.addEventListener("visibilitychange", handleVisibilityChange);
    $("appModalCancel").addEventListener("click", () => closeAppModal(false));
    $("appModalConfirm").addEventListener("click", () => closeAppModal(true));
    $("appModal").addEventListener("click", (event) => {
      if (event.target.dataset.modalAction === "cancel") closeAppModal(false);
    });

    restoreCaptainSession();
    loadInitialData();
  }

  async function callApi(action, ...args) {
    const controller = new AbortController();

    const timeoutId = window.setTimeout(() => {
      controller.abort();
    }, 8000);

    try {
    const response = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ action, args }),
      redirect: "follow",
      cache: "no-store",
      signal: controller.signal,
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`Error HTTP ${response.status}: ${text.slice(0, 180)}`);
    }
    try {
      return JSON.parse(text);
    } catch (_error) {
      throw new Error(
        `Apps Script devolvió una respuesta no válida: ${text.slice(0, 180)}`,
      );
    }
    } catch (error) {
      if (error && error.name === "AbortError") {
        throw new Error("La conexion tardo demasiado. Toca Actualizar.");
      }

      throw error;
    } finally {
      window.clearTimeout(timeoutId);
    }
  }

  async function loadInitialData() {
    setConnection("loading", "Conectando...");
    setLoading(true, "Cargando aplicación...");
    try {
      const response = await callApi("getInitialData");
      if (!response?.ok)
        throw new Error(response?.message || "No se pudo cargar la aplicación.");
      $("eventName").textContent = response.nombreEvento || "Trivia Gym Sur";
      $("publicTotal").textContent = Number(response.total || 0);
      setConnection("online", "Conectado");
    } catch (error) {
      setConnection("error", "Sin conexión");
      showToast(error.message || "No se pudo cargar la aplicación.", true);
      console.error(error);
    } finally {
      setLoading(false);
    }
  }

  async function registerParticipant(event) {
    event.preventDefault();
    if (state.registering) return;
    const nombre = $("nameInput").value.trim();
    const apellido = $("surnameInput").value.trim();
    if (nombre.length < 2) {
      showToast("Ingresá un nombre válido.", true);
      $("nameInput").focus();
      return;
    }
    if (apellido.length < 2) {
      showToast("Ingresá un apellido válido.", true);
      $("surnameInput").focus();
      return;
    }

    setRegisterPending(true);
    try {
      const response = await callApi("registerParticipant", { nombre, apellido });
      if (!response?.ok) throw new Error(response?.message || "No se pudo registrar.");
      $("assignedName").textContent = response.participante.nombreCompleto;
      $("teamBadge").textContent = `EQUIPO ${response.equipo.numero}`;
      $("teamColorName").textContent = response.equipo.colorNombre;
      $("publicTotal").textContent = Number(response.total || 0);
      applyAssignedTeamColor(response.equipo.color);
      updateCaptainAnnouncement(response);
      $("registerForm").reset();
      showView("assignmentView");
      setConnection("online", "Conectado");
    } catch (error) {
      setConnection("error", "Sin conexión");
      showToast(error.message || "No se pudo registrar.", true);
      console.error(error);
    } finally {
      setRegisterPending(false);
    }
  }

  function openCaptainEntry() {
    if (state.captainSession?.token) {
      openCaptainGame();
      return;
    }
    showView("captainLoginView");
    focusLater("captainNameInput");
  }

  async function loginCaptain(event) {
    event.preventDefault();
    const equipo = Number($("captainTeamSelect").value);
    const nombre = $("captainNameInput").value.trim();
    if (!nombre) {
      showToast("Ingresá nombre y apellido.", true);
      return;
    }
    setLoading(true, "Entrando al juego...");
    try {
      const response = await callApi("captainLogin", equipo, nombre);
      if (!response?.ok)
        throw new Error(response?.message || "No encontramos al capitán.");
      state.captainSession = response;
      localStorage.setItem(CAPTAIN_SESSION_KEY, JSON.stringify(response));
      $("captainLoginForm").reset();
      openCaptainGame();
      setConnection("online", "Conectado");
    } catch (error) {
      setConnection("error", "Sin conexión");
      showToast(error.message || "No se pudo entrar al juego.", true);
      console.error(error);
    } finally {
      setLoading(false);
    }
  }

  function restoreCaptainSession() {
    try {
      const raw = localStorage.getItem(CAPTAIN_SESSION_KEY);
      state.captainSession = raw ? JSON.parse(raw) : null;
    } catch (_error) {
      state.captainSession = null;
    }
  }

  function openCaptainGame() {
    if (!state.captainSession?.token) {
      showView("captainLoginView");
      return;
    }
    state.selectedAnswer = "";
    state.optimisticAnswer = "";
    state.optimisticStatus = "";
    state.submittingAnswer = false;
    renderCaptainShell();
    showView("captainGameView");
    pollCaptainGameState(true);
  }

  async function logoutCaptain() {
    const confirmed = await showAppConfirm({
      title: "Salir del equipo",
      message: "¿Querés cerrar la sesión de capitán en este dispositivo?",
      confirmText: "Salir",
      cancelText: "Seguir jugando",
      type: "warning",
    });
    if (!confirmed) return;
    stopCaptainPolling();
    state.captainSession = null;
    state.captainGameState = null;
    state.selectedAnswer = "";
    state.optimisticAnswer = "";
    state.optimisticStatus = "";
    state.submittingAnswer = false;
    state.lastCaptainVersion = 0;
    state.lastCaptainAnswerVersion = -1;
    localStorage.removeItem(CAPTAIN_SESSION_KEY);
    showView("homeView");
  }

  async function pollCaptainGameStateLegacy_(immediate = false) {
    if (!state.captainSession?.token) return false;
    if (document.visibilityState !== "visible") return false;
    if (state.captainPollingBusy) return false;
    state.captainPollingBusy = true;
    const t0 = performance.now();
    try {
      const response = await callApi(
        "getCaptainGameState",
        state.captainSession.token,
        state.lastCaptainVersion,
        state.lastCaptainAnswerVersion,
      );
      if (!response?.ok) throw new Error(response?.message || "No se pudo actualizar.");
      if (!response.changed) {
        state.lastCaptainVersion = Number(response.version || state.lastCaptainVersion);
        state.lastCaptainAnswerVersion = Number(
          response.answerVersion ?? state.lastCaptainAnswerVersion,
        );
        return true;
      }
      const previousRound = captainRoundKey(state.captainGameState);
      const nextRound = captainRoundKey(response);
      if (previousRound !== nextRound) {
        state.selectedAnswer = "";
        state.optimisticAnswer = "";
        state.optimisticStatus = "";
        state.submittingAnswer = false;
      }
      state.lastCaptainVersion = Number(response.version || 0);
      state.lastCaptainAnswerVersion = Number(response.answerVersion || 0);
      if (response.serverNowMs) state.serverOffsetMs = Number(response.serverNowMs) - Date.now();
      state.captainGameState = response;
      renderCaptainGame(response);
      startCaptainClock();
      setConnection("online", "Conectado");
      perfLog("captain poll", t0);
      return true;
    } catch (error) {
      if (immediate) showToast(error.message || "Sesión de capitán vencida.", true);
      if (String(error.message || "").toLowerCase().includes("sesión")) {
        state.captainSession = null;
        localStorage.removeItem(CAPTAIN_SESSION_KEY);
      }
      setConnection("error", "Sin conexión");
      console.error(error);
    } finally {
      state.captainPollingBusy = false;
      scheduleCaptainPoll();
    }
  }

  async function pollCaptainGameState(immediate = false) {
    if (!state.captainSession?.token) return false;
    if (document.visibilityState !== "visible") return false;
    if (state.captainPollingBusy) return false;

    state.captainPollingBusy = true;
    const t0 = performance.now();

    try {
      const response = await callApi(
        "getCaptainGameState",
        state.captainSession.token,
        state.lastCaptainVersion,
        state.lastCaptainAnswerVersion,
      );

      if (!response?.ok) {
        throw new Error(response?.message || "No se pudo actualizar.");
      }

      if (!response.changed) {
        state.lastCaptainVersion = Number(response.version || state.lastCaptainVersion);
        state.lastCaptainAnswerVersion = Number(
          response.answerVersion ?? state.lastCaptainAnswerVersion,
        );
        return true;
      }

      const previousRound = captainRoundKey(state.captainGameState);
      const nextRound = captainRoundKey(response);
      if (previousRound !== nextRound) {
        state.selectedAnswer = "";
        state.optimisticAnswer = "";
        state.optimisticStatus = "";
        state.submittingAnswer = false;
      }

      state.lastCaptainVersion = Number(response.version || 0);
      state.lastCaptainAnswerVersion = Number(response.answerVersion || 0);
      if (response.serverNowMs) {
        state.serverOffsetMs = Number(response.serverNowMs) - Date.now();
      }
      state.captainGameState = response;
      renderCaptainGame(response);
      startCaptainClock();
      setConnection("online", "Conectado");
      perfLog("captain poll", t0);
      return true;
    } catch (error) {
      if (immediate) {
        showToast(error.message || "Sesion de capitan vencida.", true);
      }
      if (String(error.message || "").toLowerCase().includes("sesion")) {
        state.captainSession = null;
        localStorage.removeItem(CAPTAIN_SESSION_KEY);
      }
      setConnection("error", "Sin conexion");
      console.error(error);
      return false;
    } finally {
      state.captainPollingBusy = false;
      scheduleCaptainPoll();
    }
  }

  async function forceRefreshCaptainGame() {
    if (!state.captainSession?.token) {
      showToast("No hay una sesion de capitan activa.", true);
      return;
    }

    const button = $("captainRefreshBtn");
    const previousText = button.textContent;

    button.disabled = true;
    button.textContent = "Actualizando...";

    stopCaptainPolling();
    stopCaptainClock();

    state.lastCaptainVersion = -1;
    state.lastCaptainAnswerVersion = -1;
    state.captainPollingBusy = false;

    try {
      const refreshed = await pollCaptainGameState(true);
      if (!refreshed) {
        throw new Error("No se pudo actualizar la trivia.");
      }
      showToast("Estado de la trivia actualizado.");
      setConnection("online", "Conectado");
    } catch (error) {
      showToast(error.message || "No se pudo actualizar la trivia.", true);
      setConnection("error", "Sin conexion");
    } finally {
      button.disabled = false;
      button.textContent = previousText;
    }
  }

  function scheduleCaptainPoll() {
    stopCaptainPolling();
    if (state.currentView !== "captainGameView") return;
    if (document.visibilityState !== "visible") return;
    state.captainPollTimer = window.setTimeout(() => {
      pollCaptainGameState(false);
    }, captainPollDelay());
  }

  function captainPollDelay() {
    const estado = state.captainGameState?.estado || "ESPERA";
    if (estado === "PREGUNTA") return 450;
    if (estado === "RESPUESTAS_CERRADAS") return 600;
    if (estado === "FINALIZADA") return 2000;
    return 900;
  }

  function stopCaptainPolling() {
    if (state.captainPollTimer) {
      window.clearTimeout(state.captainPollTimer);
      state.captainPollTimer = null;
    }
  }

  function renderCaptainShell() {
    const session = state.captainSession || {};

    const teamColor = normalizeHexColor(session.color) || "#e63b2e";
    const rgb = hexToRgb(teamColor);
    const shell = document.querySelector(".captain-shell");

    if (shell) {
      shell.style.setProperty("--team-color", teamColor);
      shell.style.setProperty(
        "--team-rgb",
        `${rgb.red}, ${rgb.green}, ${rgb.blue}`,
      );
      shell.style.setProperty("--team-contrast", getContrastColor(teamColor));
    }

    $("captainTeamTitle").textContent =
      `EQUIPO ${session.equipo || ""} · ${session.colorNombre || ""}`;
  }

  function renderCaptainGame(game) {
    const content = $("captainGameContent");
    const pregunta = game.pregunta;
    $("captainGameTitle").textContent = titleForCaptainState(game);

    if (game.estado === "FINALIZADA") {
      content.innerHTML = renderCaptainFinal(game);
      return;
    }
    if (!pregunta || game.estado === "ESPERA") {
      content.innerHTML = `
        <div class="waiting-pulse"></div>
        <h2>Esperando la próxima pregunta...</h2>
        <p class="muted">El organizador todavía no lanzó ninguna pregunta.</p>
      `;
      return;
    }
    if (game.estado === "PREGUNTA") {
      content.innerHTML = renderCaptainQuestion(game);
      return;
    }
    if (game.estado === "RESPUESTAS_CERRADAS") {
      content.innerHTML = `
        <h2>Tiempo terminado</h2>
        <p class="hero-copy">Esperando que el organizador muestre la respuesta correcta...</p>
      `;
      return;
    }
    if (game.estado === "RESULTADO") {
      content.innerHTML = renderCaptainResult(game);
    }
  }

  function titleForCaptainState(game) {
    if (game.estado === "FINALIZADA") return "Trivia finalizada";
    if (game.estado === "PREGUNTA") return `Pregunta ${game.numeroPregunta || 0}`;
    if (game.estado === "RESULTADO") return "Resultado";
    if (game.estado === "RESPUESTAS_CERRADAS") return "Respuestas cerradas";
    return "Esperando pregunta";
  }

  function captainRoundKey(game) {
    return [
      game?.partidaId || "",
      Number(game?.numeroPregunta || 0),
      game?.pregunta?.idPregunta || "",
    ].join("|");
  }

  function wait(milliseconds) {
    return new Promise((resolve) => {
      window.setTimeout(resolve, milliseconds);
    });
  }

  function renderCaptainQuestion(game) {
    const q = game.pregunta;
    const answer = game.respuestaEquipo || state.optimisticAnswer || "";
    const locked = Boolean(
      game.respondida || state.optimisticAnswer || state.submittingAnswer,
    );
    const options = ["A", "B", "C", "D"].map((letter) => {
      const text = q[`opcion${letter}`];
      const selected = answer === letter ? "selected" : "";
      return `
        <button class="answer-option ${selected}" type="button" data-answer="${letter}" ${locked ? "disabled" : ""}>
          <span>${letter}</span>
          <strong>${escapeHtml(text)}</strong>
        </button>
      `;
    });
    const sent = game.respondida || state.optimisticAnswer || state.submittingAnswer
      ? `<div class="sent-answer"><strong>${escapeHtml(state.optimisticStatus || "Respuesta enviada")}</strong><span>Tu equipo respondió ${escapeHtml(game.respuestaEquipo || state.optimisticAnswer)}.</span></div>`
      : "";
    return `
      <div class="question-meta">
        <span>Pregunta ${Number(game.numeroPregunta || 0)}</span>
        <strong id="captainCountdown">${secondsRemaining(game)}</strong>
      </div>
      <h2 class="live-question">${escapeHtml(q.pregunta)}</h2>
      <div class="answer-grid">${options.join("")}</div>
      ${sent}
    `;
  }

  function startCaptainClock() {
    stopCaptainClock();
    if (state.currentView !== "captainGameView") return;
    state.captainClockTimer = window.setInterval(() => {
      const counter = $("captainCountdown");
      if (counter && state.captainGameState) {
        const seconds = secondsRemaining(state.captainGameState);
        counter.textContent = seconds;
        if (
          seconds <= 0 &&
          state.captainGameState.estado === "PREGUNTA" &&
          !state.submittingAnswer
        ) {
          state.captainGameState = {
            ...state.captainGameState,
            estado: "RESPUESTAS_CERRADAS",
          };
          renderCaptainGame(state.captainGameState);
        }
      }
    }, 250);
  }

  function stopCaptainClock() {
    if (state.captainClockTimer) {
      window.clearInterval(state.captainClockTimer);
      state.captainClockTimer = null;
    }
  }

  function secondsRemaining(game) {
    const end = Number(game?.fechaFinMs || 0);
    if (!end) return 0;
    return Math.max(0, Math.ceil((end - (Date.now() + state.serverOffsetMs)) / 1000));
  }

  function renderCaptainResult(game) {
    const q = game.pregunta;
    const correct = q.respuestaCorrecta;
    const correctText = q[`opcion${correct}`] || "";
    const isCorrect = game.correctaEquipo === true;
    return `
      <div class="result-banner ${isCorrect ? "success" : "danger"}">
        <span>Respuesta correcta: ${escapeHtml(correct)}</span>
        <strong>${escapeHtml(correctText)}</strong>
      </div>
      <h2>${isCorrect ? "¡Correcto!" : "Incorrecto"}</h2>
      <p class="hero-copy">
        ${
          isCorrect
            ? `+${Number(q.puntaje || 1)} punto`
            : `Tu equipo respondió ${escapeHtml(game.respuestaEquipo || "-")}.`
        }
      </p>
      <p class="explanation">${escapeHtml(q.explicacion || "")}</p>
    `;
  }

  function renderCaptainFinal(game) {
    const ranking = Array.isArray(game.ranking) ? game.ranking : [];
    const mine = ranking.find((r) => Number(r.numero) === Number(game.equipo?.numero));
    const winner = ranking[0];
    const last = ranking[ranking.length - 1];
    return `
      <h2>Trivia finalizada</h2>
      ${
        mine
          ? `<div class="team-final-score">
              <span>Posición ${mine.posicion}.º</span>
              <strong>${mine.puntaje} puntos</strong>
              <small>${mine.correctas} correctas · ${mine.incorrectas} incorrectas</small>
            </div>`
          : ""
      }
      <div class="winner-grid">
        <div><span>Ganador</span><strong>${winner ? `Equipo ${winner.numero}` : "-"}</strong></div>
        <div><span>Prenda</span><strong>${last ? `Equipo ${last.numero}` : "-"}</strong></div>
      </div>
      ${renderRanking(ranking)}
    `;
  }

  function handleCaptainGameClick(event) {
    const option = event.target.closest("[data-answer]");
    if (!option || option.disabled) return;
    if (state.submittingAnswer || state.captainGameState?.respondida) return;
    submitCaptainAnswer(option.dataset.answer);
  }

  async function submitCaptainAnswer(answer) {
    const game = state.captainGameState;
    if (!game?.pregunta?.idPregunta) return;
    if (state.submittingAnswer || game.respondida) return;
    const t0 = performance.now();
    const roundKey = captainRoundKey(game);
    state.submittingAnswer = true;
    state.optimisticAnswer = answer;
    state.optimisticStatus = "Enviando...";
    state.selectedAnswer = "";
    renderCaptainGame(game);
    try {
      let response;
      try {
        response = await callApi(
          "submitTeamAnswer",
          state.captainSession.token,
          game.pregunta.idPregunta,
          answer,
        );
      } catch (firstError) {
        await wait(250);
        response = await callApi(
          "submitTeamAnswer",
          state.captainSession.token,
          game.pregunta.idPregunta,
          answer,
        );
      }
      if (!response?.ok) {
        const message = response?.message || "No se pudo responder.";
        if (message.toLowerCase().includes("ya respondi")) {
          state.optimisticStatus = "Respuesta ya registrada";
          state.lastCaptainAnswerVersion = -1;
          await pollCaptainGameState(false);
          return;
        }
        throw new Error(message);
      }

      if (captainRoundKey(state.captainGameState) === roundKey) {
        state.captainGameState = {
          ...state.captainGameState,
          respondida: true,
          respuestaEquipo: response.respuesta || answer,
        };
      }
      state.optimisticStatus = "Respuesta registrada";
      state.lastCaptainAnswerVersion = Number(response.answerVersion || state.lastCaptainAnswerVersion);
      perfLog("submit answer", t0);
      renderCaptainGame(state.captainGameState);
    } catch (error) {
      if (!String(error.message || "").toLowerCase().includes("ya respondió")) {
        state.optimisticAnswer = "";
        state.optimisticStatus = "";
      } else {
        state.optimisticStatus = "Respuesta ya registrada";
      }
      state.submittingAnswer = false;
      renderCaptainGame(state.captainGameState);
      showToast(error.message || "No se pudo responder.", true);
      console.error(error);
    } finally {
      state.submittingAnswer = false;
    }
  }

  async function loginAdmin(event) {
    event.preventDefault();
    const pin = $("pinInput").value.trim();
    if (!pin) {
      showToast("Ingresá el PIN.", true);
      return;
    }
    setLoading(true, "Verificando acceso...");
    try {
      const response = await callApi("verifyAdminPin", pin);
      if (!response?.ok) {
        $("pinInput").select();
        throw new Error(response?.message || "PIN incorrecto.");
      }
      state.adminPin = pin;
      state.adminAuthenticated = true;
      $("adminLoginForm").reset();
      openAdmin();
      setConnection("online", "Conectado");
    } catch (error) {
      showToast(error.message || "PIN incorrecto.", true);
      console.error(error);
    } finally {
      setLoading(false);
    }
  }

  function openAdmin() {
    showView("adminView");
    loadQuestionBankOnce();
    loadAdminData(true);
    pollAdminGameState(true);
    startAdminTimers();
  }

  async function loadQuestionBankOnce() {
    if (state.questionBank.length) {
      updateQuestionFilters();
      updateQuestionSelect(true);
      return;
    }
    try {
      const response = await callApi("getQuestionBank", state.adminPin);
      if (!response?.ok) throw new Error(response?.message || "No se pudieron cargar preguntas.");
      state.questionBank = response.preguntas || [];
      updateQuestionFilters();
      updateQuestionSelect();
    } catch (error) {
      showToast(error.message || "No se pudo cargar el banco.", true);
      console.error(error);
    }
  }

  async function loadAdminData(showOverlay = false) {
    if (!state.adminAuthenticated) return;
    if (!showOverlay && state.adminTeamsBusy) return;
    state.adminTeamsBusy = true;
    if (showOverlay) setLoading(true, "Actualizando equipos...");
    try {
      const response = await callApi("getAdminData", state.adminPin);
      if (!response?.ok) throw new Error(response?.message || "No se pudo actualizar el panel.");
      $("adminTotal").textContent = Number(response.total || 0);
      $("publicTotal").textContent = Number(response.total || 0);
      $("updatedText").textContent = `Última actualización: ${response.actualizado || "-"}`;
      renderTeams(response.equipos || []);
      setConnection("online", "Conectado");
    } catch (error) {
      setConnection("error", "Sin conexión");
      showToast(error.message || "No se pudo actualizar el panel.", true);
      console.error(error);
    } finally {
      if (showOverlay) setLoading(false);
      state.adminTeamsBusy = false;
    }
  }

  function startAdminTimers() {
    stopAdminTimers();
    scheduleAdminTeamsRefresh();
  }

  function stopAdminTimers() {
    if (state.adminTeamsTimer) window.clearTimeout(state.adminTeamsTimer);
    if (state.adminPollTimer) window.clearTimeout(state.adminPollTimer);
    if (state.adminClockTimer) window.clearInterval(state.adminClockTimer);
    state.adminTeamsTimer = null;
    state.adminPollTimer = null;
    state.adminClockTimer = null;
  }

  function scheduleAdminTeamsRefresh() {
    if (state.adminTeamsTimer) window.clearTimeout(state.adminTeamsTimer);
    state.adminTeamsTimer = null;
    if (state.currentView !== "adminView") return;
    if (document.visibilityState !== "visible") return;
    state.adminTeamsTimer = window.setTimeout(async () => {
      await loadAdminData(false);
      scheduleAdminTeamsRefresh();
    }, 5000);
  }

  async function pollAdminGameState(showErrors) {
    if (!state.adminAuthenticated || document.visibilityState !== "visible") return;
    if (state.adminPollingBusy) return;
    state.adminPollingBusy = true;
    const t0 = performance.now();
    try {
      const response = await callApi(
        "getAdminGameState",
        state.adminPin,
        state.lastAdminVersion,
        state.lastAdminAnswerVersion,
      );
      if (!response?.ok) throw new Error(response?.message || "No se pudo leer el estado.");
      if (!response.changed) {
        state.lastAdminVersion = Number(response.version || state.lastAdminVersion);
        state.lastAdminAnswerVersion = Number(
          response.answerVersion ?? state.lastAdminAnswerVersion,
        );
        return;
      }
      state.lastAdminVersion = Number(response.version || 0);
      state.lastAdminAnswerVersion = Number(response.answerVersion || 0);
      if (response.serverNowMs) state.serverOffsetMs = Number(response.serverNowMs) - Date.now();
      state.usedQuestions = new Set(response.preguntasUsadas || []);
      renderAdminGameState(response);
      updateQuestionSelect(true);
      setConnection("online", "Conectado");
      perfLog("admin poll", t0);
    } catch (error) {
      if (showErrors) showToast(error.message || "No se pudo actualizar la trivia.", true);
      setConnection("error", "Sin conexión");
      console.error(error);
    } finally {
      state.adminPollingBusy = false;
      scheduleAdminPoll();
    }
  }

  function scheduleAdminPoll() {
    if (state.adminPollTimer) window.clearTimeout(state.adminPollTimer);
    state.adminPollTimer = null;
    if (state.currentView !== "adminView") return;
    if (document.visibilityState !== "visible") return;
    state.adminPollTimer = window.setTimeout(() => {
      pollAdminGameState(false);
    }, adminPollDelay());
  }

  function adminPollDelay() {
    const status = $("adminGameStatus").textContent || "ESPERA";
    if (status === "PREGUNTA") return 500;
    if (status === "RESPUESTAS_CERRADAS" || status === "RESULTADO") return 700;
    return 1500;
  }

  function updateQuestionFilters() {
    const categories = new Map();
    state.questionBank.forEach((q) => {
      if (q.categoria) categories.set(String(q.categoria), q.categoriaNombre || q.categoria);
    });
    $("questionCategorySelect").innerHTML =
      '<option value="">Todas las categorías</option>' +
      Array.from(categories)
        .sort((a, b) => Number(a[0]) - Number(b[0]) || String(a[1]).localeCompare(String(b[1])))
        .map(([id, name]) => {
          const label = `${id}) ${name}`;
          return `<option value="${escapeAttribute(id)}">${escapeHtml(label)}</option>`;
        })
        .join("");
  }

  function updateQuestionSelect(keepSelection = false) {
    const selected = keepSelection ? $("questionSelect").value : "";
    const category = $("questionCategorySelect").value;
    const query = normalizeSearch($("questionSearchInput").value);
    state.filteredQuestions = state.questionBank.filter((q) => {
      const matchesCategory = !category || String(q.categoria) === category;
      const haystack = normalizeSearch(
        `${q.idPregunta} ${q.pregunta}`,
      );
      return matchesCategory && (!query || haystack.includes(query));
    });
    $("questionSelect").innerHTML = state.filteredQuestions
      .map((q) => {
        const used = state.usedQuestions.has(q.idPregunta) ? " ✓" : "";
        return `<option value="${escapeAttribute(q.idPregunta)}">${escapeHtml(q.idPregunta)}${used}</option>`;
      })
      .join("");
    if (selected && state.filteredQuestions.some((q) => q.idPregunta === selected)) {
      $("questionSelect").value = selected;
    } else if (state.filteredQuestions.length) {
      $("questionSelect").value = state.filteredQuestions[0].idPregunta;
    }
    renderQuestionPreview();
  }

  function renderQuestionPreview() {
    const q = selectedQuestion();
    if (!q) {
      $("questionPreview").textContent = "Seleccioná una pregunta activa.";
      return;
    }
    $("questionPreview").innerHTML = `
      <div class="question-id">${escapeHtml(q.idPregunta)} · ${escapeHtml(q.categoriaNombre || q.categoria)}</div>
      <h3>${escapeHtml(q.pregunta)}</h3>
      <ol class="preview-options">
        <li><strong>A</strong> ${escapeHtml(q.opcionA)}</li>
        <li><strong>B</strong> ${escapeHtml(q.opcionB)}</li>
        <li><strong>C</strong> ${escapeHtml(q.opcionC)}</li>
        <li><strong>D</strong> ${escapeHtml(q.opcionD)}</li>
      </ol>
      <p>${Number(q.puntaje || 1)} punto(s) · ${Number(q.tiempoSegundos || 20)} segundos</p>
    `;
  }

  function selectedQuestion() {
    const id = $("questionSelect").value;
    return state.questionBank.find((q) => q.idPregunta === id) || null;
  }

  async function launchSelectedQuestion() {
    state.adminChoosingNext = false;
    const q = selectedQuestion();
    if (!q) {
      showToast("Seleccioná una pregunta.", true);
      return;
    }
    if (state.usedQuestions.has(q.idPregunta)) {
      const confirmed = await showAppConfirm({
        title: "Pregunta ya usada",
        message: "Esta pregunta ya fue usada en la partida. ¿Querés lanzarla igual?",
        confirmText: "Lanzar igual",
        cancelText: "Elegir otra",
        type: "warning",
      });
      if (!confirmed) return;
    }
    await runAdminGameAction("launchQuestion", q.idPregunta, "Pregunta lanzada.", "Lanzando...");
  }

  function focusNextQuestionLegacy_() {
    if ($("nextQuestionBtn").disabled) return;
    state.adminChoosingNext = true;
    $("adminGameStatus").textContent = "LISTO";
    $("adminTimer").classList.add("hidden");
    $("adminLiveState").innerHTML = '<p class="muted">Seleccioná otra pregunta activa y presioná Lanzar pregunta.</p>';
    $("answerChips").innerHTML = "";
    $("questionSelect").focus();
    $("questionPreview").scrollIntoView({ behavior: "smooth", block: "center" });
    showToast("Elegí otra pregunta y presioná Lanzar pregunta.");
  }

  function focusNextQuestion() {
    if ($("nextQuestionBtn").disabled) {
      return;
    }

    const currentQuestion = selectedQuestion();

    if (!currentQuestion) {
      showToast("No hay una pregunta actual seleccionada.", true);
      return;
    }

    state.adminChoosingNext = true;
    $("questionSearchInput").value = "";

    const currentCategory = String(currentQuestion.categoria || "");
    const sortById = (a, b) =>
      String(a.idPregunta).localeCompare(String(b.idPregunta), undefined, {
        numeric: true,
        sensitivity: "base",
      });

    const sameCategoryQuestions = state.questionBank
      .filter((question) => {
        return (
          String(question.categoria) === currentCategory &&
          question.idPregunta !== currentQuestion.idPregunta &&
          !state.usedQuestions.has(question.idPregunta)
        );
      })
      .sort(sortById);

    let nextQuestion =
      sameCategoryQuestions.find((question) => {
        return (
          String(question.idPregunta).localeCompare(
            String(currentQuestion.idPregunta),
            undefined,
            {
              numeric: true,
              sensitivity: "base",
            },
          ) > 0
        );
      }) ||
      sameCategoryQuestions[0] ||
      null;

    if (!nextQuestion) {
      nextQuestion =
        state.questionBank
          .filter((question) => {
            return (
              question.idPregunta !== currentQuestion.idPregunta &&
              !state.usedQuestions.has(question.idPregunta)
            );
          })
          .sort(sortById)[0] || null;
    }

    if (!nextQuestion) {
      $("adminGameStatus").textContent = "SIN PREGUNTAS";
      showToast("No quedan preguntas sin usar.", true);
      return;
    }

    $("questionCategorySelect").value = String(nextQuestion.categoria || "");
    updateQuestionSelect(false);
    $("questionSelect").value = nextQuestion.idPregunta;
    renderQuestionPreview();

    $("adminGameStatus").textContent = "LISTO";
    $("adminTimer").classList.add("hidden");
    $("adminLiveState").innerHTML = `
      <div class="live-state-main">
        <span>Siguiente pregunta preparada</span>
        <strong>${escapeHtml(nextQuestion.pregunta)}</strong>
        <small>Presiona Lanzar pregunta.</small>
      </div>
    `;
    $("answerChips").innerHTML = "";
    $("questionPreview").scrollIntoView({ behavior: "smooth", block: "center" });
    showToast(`${nextQuestion.idPregunta} preparada.`);
  }

  async function finishGame() {
    const confirmed = await showAppConfirm({
      title: "Finalizar trivia",
      message: "¿Finalizar la trivia y mostrar el ranking final?",
      confirmText: "Finalizar",
      cancelText: "Cancelar",
      type: "danger",
    });
    if (!confirmed) return;
    await runAdminGameAction("finishGame", null, "Trivia finalizada.", "Finalizando...");
  }

  async function resetGame() {
    const first = await showAppConfirm({
      title: "Reiniciar trivia",
      message: "Esto reinicia puntajes y estado de trivia, sin borrar participantes.",
      confirmText: "Continuar",
      cancelText: "Cancelar",
      type: "warning",
    });
    if (!first) return;
    const second = await showAppConfirm({
      title: "Confirmar reinicio",
      message: "¿Confirmás reiniciar la trivia en vivo?",
      confirmText: "Reiniciar",
      cancelText: "Cancelar",
      type: "danger",
    });
    if (!second) return;
    await runAdminGameAction("resetGame", null, "Trivia reiniciada.", "Reiniciando...");
  }

  async function runAdminGameAction(action, arg, successMessage, pendingText) {
    state.adminChoosingNext = false;
    const button = document.activeElement?.matches?.("button")
      ? document.activeElement
      : null;
    const previousText = button ? button.textContent : "";
    if (button) {
      button.disabled = true;
      button.textContent = pendingText || "Procesando...";
    }
    try {
      const response =
        arg === null
          ? await callApi(action, state.adminPin)
          : await callApi(action, state.adminPin, arg);
      if (!response?.ok) throw new Error(response?.message || "No se pudo ejecutar la acción.");
      showToast(successMessage);
      state.lastAdminVersion = Number(response.version || state.lastAdminVersion);
      state.lastAdminAnswerVersion = Number(
        response.answerVersion ?? state.lastAdminAnswerVersion,
      );
      state.usedQuestions = new Set(response.preguntasUsadas || []);
      renderAdminGameState(response);
      updateQuestionSelect(true);
      await loadAdminData(false);
    } catch (error) {
      showToast(error.message || "No se pudo ejecutar la acción.", true);
      console.error(error);
    } finally {
      if (button) {
        button.disabled = false;
        button.textContent = previousText;
      }
    }
  }

  function renderAdminGameState(game) {
    if (state.adminChoosingNext && game.estado === "RESULTADO") {
      $("nextQuestionBtn").disabled = false;
      $("adminRanking").innerHTML = renderRanking(game.ranking || []);
      return;
    }
    $("adminGameStatus").textContent = game.estado || "ESPERA";
    $("nextQuestionBtn").disabled = game.estado !== "RESULTADO";
    const q = game.pregunta;
    updateAdminTimer(game);
    if (!q) {
      $("adminLiveState").innerHTML = '<p class="muted">Todavía no hay pregunta en juego.</p>';
    } else if (game.estado === "RESPUESTAS_CERRADAS") {
      $("adminLiveState").innerHTML = `
        <div class="live-state-main">
          <span>Tiempo terminado</span>
          <strong>Respuestas cerradas.</strong>
          <small>Revelando la respuesta...</small>
        </div>
      `;
    } else {
      $("adminLiveState").innerHTML = `
        <div class="live-state-main">
          <span>${game.estado === "RESULTADO" ? "Resultado" : `Pregunta ${Number(game.numeroPregunta || 0)}`}</span>
          <strong>${escapeHtml(q.pregunta)}</strong>
          <small>Respondieron ${Number(game.cantidadRespondida || 0)} de ${Number(game.cantidadTotalEquiposActivos || 0)} equipos</small>
        </div>
        ${
          q.respuestaCorrecta
            ? `<div class="correct-answer">Respuesta correcta: <strong>${escapeHtml(q.respuestaCorrecta)}</strong> · ${escapeHtml(q[`opcion${q.respuestaCorrecta}`] || "")}<p>${escapeHtml(q.explicacion || "")}</p></div>`
            : ""
        }
      `;
    }
    renderAnswerChips(game);
    $("adminRanking").innerHTML = renderRanking(game.ranking || []);
  }

  function updateAdminTimer(game) {
    const timer = $("adminTimer");
    const value = $("adminTimerValue");
    const active = game?.estado === "PREGUNTA" && Number(game.fechaFinMs || 0) > 0;
    timer.classList.toggle("hidden", !active);
    if (!active) {
      stopAdminClock();
      return;
    }
    const paint = () => {
      const seconds = secondsRemaining(game);
      value.textContent = seconds > 0 ? seconds : "TIEMPO";
      timer.classList.toggle("warning", seconds <= 10 && seconds > 5);
      timer.classList.toggle("danger", seconds <= 5 && seconds > 0);
      timer.classList.toggle("finished", seconds <= 0);
    };
    paint();
    stopAdminClock();
    state.adminClockTimer = window.setInterval(paint, 250);
  }

  function stopAdminClock() {
    if (state.adminClockTimer) {
      window.clearInterval(state.adminClockTimer);
      state.adminClockTimer = null;
    }
  }

  function renderAnswerChips(game) {
    const closed = ["RESPUESTAS_CERRADAS", "RESULTADO", "FINALIZADA"].includes(game.estado);
    $("answerChips").innerHTML = (game.equipos || [])
      .map((team) => {
        const status = team.respondio ? "answered" : closed ? "missed" : "pending";
        const label = team.respondio ? `Equipo ${team.numero} ✓` : `Equipo ${team.numero} …`;
        return `<span class="answer-chip ${status}" style="--team-color:${escapeAttribute(team.color)}">${escapeHtml(label)}</span>`;
      })
      .join("");
  }

  function renderRanking(ranking) {
    if (!ranking?.length) return '<p class="muted">Sin ranking todavía.</p>';
    return `
      <div class="ranking-title">Ranking</div>
      ${ranking
        .map(
          (team) => `
            <div class="ranking-row" style="--team-color:${escapeAttribute(team.color)}">
              <strong>${team.posicion}.º Equipo ${team.numero}</strong>
              <span>${escapeHtml(team.colorNombre)} · ${Number(team.puntaje || 0)} puntos</span>
            </div>
          `,
        )
        .join("")}
    `;
  }

  function renderTeams(teams) {
    $("teamsGrid").innerHTML = teams
      .map((team) => {
        const participants = Array.isArray(team.participantes) ? team.participantes : [];
        const participantMarkup = participants.length
          ? participants.map(renderParticipant).join("")
          : '<div class="empty-team">Todavía no hay integrantes.</div>';
        return `
          <article class="team-card" style="--team-color:${escapeAttribute(team.color)}">
            <header class="team-card-header">
              <div>
                <h2>${escapeHtml(team.nombre)}</h2>
                <p>${escapeHtml(team.colorNombre)} · ${Number(team.puntaje || 0)} puntos</p>
              </div>
              <span class="team-count">${Number(team.integrantes || 0)}</span>
            </header>
            <div class="participant-list">${participantMarkup}</div>
          </article>
        `;
      })
      .join("");
  }

  function renderParticipant(participant) {
    const detail = participant.capitan
      ? '<small class="captain">★ Capitán del equipo</small>'
      : `<small>${escapeHtml(participant.fecha || "")}</small>`;
    return `
      <div class="participant-row">
        <div class="participant-main">
          <strong>${escapeHtml(participant.nombreCompleto)}</strong>
          ${detail}
        </div>
        <div class="row-actions">
          <button class="mini-button ${participant.capitan ? "active" : ""}" type="button" data-action="captain" data-id="${escapeAttribute(participant.id)}" title="Marcar o desmarcar capitán" aria-label="Marcar o desmarcar capitán">★</button>
          <button class="mini-button remove" type="button" data-action="remove" data-id="${escapeAttribute(participant.id)}" data-name="${escapeAttribute(participant.nombreCompleto)}" title="Retirar participante" aria-label="Retirar participante">×</button>
        </div>
      </div>
    `;
  }

  function handleTeamAction(event) {
    const button = event.target.closest("button[data-action]");
    if (!button) return;
    const participantId = button.dataset.id;
    if (button.dataset.action === "captain") setCaptain(participantId);
    if (button.dataset.action === "remove")
      removeParticipant(participantId, button.dataset.name || "esta persona");
  }

  async function setCaptain(participantId) {
    setLoading(true, "Actualizando capitán...");
    try {
      const response = await callApi("setCaptain", state.adminPin, participantId);
      if (!response?.ok) throw new Error(response?.message || "No se pudo actualizar.");
      showToast(response.message || "Capitán actualizado.");
      await loadAdminData(false);
    } catch (error) {
      showToast(error.message || "No se pudo actualizar.", true);
      console.error(error);
    } finally {
      setLoading(false);
    }
  }

  async function removeParticipant(participantId, participantName) {
    const confirmed = await showAppConfirm({
      title: "Retirar participante",
      message: `¿Retirar a ${participantName} del registro actual?`,
      confirmText: "Retirar",
      cancelText: "Cancelar",
      type: "danger",
    });
    if (!confirmed) return;
    setLoading(true, "Retirando participante...");
    try {
      const response = await callApi("removeParticipant", state.adminPin, participantId);
      if (!response?.ok) throw new Error(response?.message || "No se pudo retirar.");
      showToast(response.message || "Participante retirado.");
      await loadAdminData(false);
    } catch (error) {
      showToast(error.message || "No se pudo retirar.", true);
      console.error(error);
    } finally {
      setLoading(false);
    }
  }

  async function resetParticipants() {
    const first = await showAppConfirm({
      title: "Vaciar registro",
      message: "Esto eliminará todo el registro actual.",
      confirmText: "Continuar",
      cancelText: "Cancelar",
      type: "warning",
    });
    if (!first) return;
    const second = await showAppConfirm({
      title: "Confirmar vaciado",
      message: "¿Confirmás que querés vaciar los 10 equipos?",
      confirmText: "Vaciar registro",
      cancelText: "Cancelar",
      type: "danger",
    });
    if (!second) return;
    setLoading(true, "Vaciando registro...");
    try {
      const response = await callApi("resetParticipants", state.adminPin);
      if (!response?.ok) throw new Error(response?.message || "No se pudo vaciar.");
      showToast(response.message || "Registro vacío.");
      await loadAdminData(false);
    } catch (error) {
      showToast(error.message || "No se pudo vaciar.", true);
      console.error(error);
    } finally {
      setLoading(false);
    }
  }

  async function refreshPublicTotal() {
    try {
      const response = await callApi("getInitialData");
      if (response?.ok) $("publicTotal").textContent = Number(response.total || 0);
    } catch (error) {
      console.error(error);
    }
  }

  function startAnotherRegistration() {
    $("registerForm").reset();
    hideCaptainAnnouncement();
    showView("registerView");
    focusLater("nameInput");
  }

  function showView(viewId) {
    document.querySelectorAll(".view").forEach((view) => {
      view.classList.toggle("hidden", view.id !== viewId);
    });
    state.currentView = viewId;
    $("homeBtn").classList.toggle("hidden", viewId === "homeView");
    if (viewId !== "adminView") stopAdminTimers();
    if (viewId !== "captainGameView") {
      stopCaptainPolling();
      stopCaptainClock();
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function goHome() {
    showView("homeView");
    refreshPublicTotal();
  }

  function handleVisibilityChange() {
    if (document.visibilityState !== "visible") {
      stopCaptainPolling();
      if (state.adminPollTimer) {
        window.clearTimeout(state.adminPollTimer);
        state.adminPollTimer = null;
      }
      if (state.adminTeamsTimer) {
        window.clearTimeout(state.adminTeamsTimer);
        state.adminTeamsTimer = null;
      }
      return;
    }
    if (state.currentView === "captainGameView") pollCaptainGameState(false);
    if (state.currentView === "adminView") {
      pollAdminGameState(false);
      scheduleAdminTeamsRefresh();
    }
  }

  function focusLater(id) {
    window.setTimeout(() => $(id)?.focus(), 80);
  }

  function setLoading(active, text = "Procesando...") {
    $("loadingText").textContent = text;
    $("loading").classList.toggle("hidden", !active);
  }

  function setRegisterPending(active) {
    state.registering = active;
    const button = $("registerSubmit");
    button.disabled = active;
    button.setAttribute("aria-busy", active ? "true" : "false");
    button.classList.toggle("is-loading", active);
    $("registerSubmitText").textContent = active ? "Asignando..." : "Asignarme un equipo";
  }

  function applyAssignedTeamColor(hexColor) {
    const color = normalizeHexColor(hexColor) || "#64748b";
    const textColor = getContrastColor(color);
    const rgb = hexToRgb(color);
    const card = document.querySelector(".assignment-card");
    card.style.setProperty("--assigned-team-color", color);
    card.style.setProperty("--assigned-team-text-color", textColor);
    card.style.setProperty("--assigned-team-glow-rgb", `${rgb.red}, ${rgb.green}, ${rgb.blue}`);
    $("teamBadge").style.removeProperty("background");
  }

  function updateCaptainAnnouncement(response) {
    const announcement = $("captainAnnouncement");
    if (!response?.participante?.esCapitan) {
      hideCaptainAnnouncement();
      return;
    }
    const teamNumber = Number(response.equipo?.numero || 0);
    const colorName = String(response.equipo?.colorNombre || "").trim();
    $("captainAnnouncementText").textContent = `¡SOS EL CAPITÁN DEL EQUIPO ${teamNumber}!`;
    $("captainAnnouncementTeam").textContent = `EQUIPO ${colorName.toUpperCase()}`;
    announcement.classList.remove("hidden");
  }

  function hideCaptainAnnouncement() {
    $("captainAnnouncement").classList.add("hidden");
    $("captainAnnouncementText").textContent = "";
    $("captainAnnouncementTeam").textContent = "";
  }

  function normalizeHexColor(value) {
    const color = String(value || "").trim();
    if (/^#[0-9a-f]{6}$/i.test(color)) return color;
    if (/^#[0-9a-f]{3}$/i.test(color)) {
      return `#${color[1]}${color[1]}${color[2]}${color[2]}${color[3]}${color[3]}`;
    }
    return "";
  }

  function getContrastColor(hexColor) {
    const color = normalizeHexColor(hexColor);
    if (!color) return "#ffffff";
    const red = parseInt(color.slice(1, 3), 16) / 255;
    const green = parseInt(color.slice(3, 5), 16) / 255;
    const blue = parseInt(color.slice(5, 7), 16) / 255;
    const luminance =
      0.2126 * normalizeChannel(red) +
      0.7152 * normalizeChannel(green) +
      0.0722 * normalizeChannel(blue);
    return luminance > 0.56 ? "#111827" : "#ffffff";
  }

  function hexToRgb(hexColor) {
    const color = normalizeHexColor(hexColor) || "#64748b";
    return {
      red: parseInt(color.slice(1, 3), 16),
      green: parseInt(color.slice(3, 5), 16),
      blue: parseInt(color.slice(5, 7), 16),
    };
  }

  function normalizeChannel(value) {
    return value <= 0.03928
      ? value / 12.92
      : Math.pow((value + 0.055) / 1.055, 2.4);
  }

  function normalizeSearch(value) {
    return String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .trim();
  }

  function setConnection(status, text) {
    $("connectionPill").dataset.state = status;
    $("connectionText").textContent = text;
  }

  function showAppConfirm({
    title = "Confirmar acción",
    message = "¿Estás seguro?",
    confirmText = "Confirmar",
    cancelText = "Cancelar",
    type = "danger",
  } = {}) {
    return new Promise((resolve) => {
      state.modalResolve = resolve;
      const modal = $("appModal");
      modal.className = `app-modal ${type}`;
      modal.setAttribute("aria-hidden", "false");
      $("appModalTitle").textContent = title;
      $("appModalMessage").textContent = message;
      $("appModalConfirm").textContent = confirmText;
      $("appModalCancel").textContent = cancelText;
      $("appModalCancel").classList.remove("hidden");
      $("appModalIcon").textContent = type === "danger" ? "!" : type === "success" ? "✓" : "i";
      window.setTimeout(() => $("appModalConfirm").focus(), 40);
    });
  }

  function showAppMessage({
    title = "Mensaje",
    message = "",
    buttonText = "Entendido",
    type = "info",
  } = {}) {
    return new Promise((resolve) => {
      state.modalResolve = resolve;
      const modal = $("appModal");
      modal.className = `app-modal ${type}`;
      modal.setAttribute("aria-hidden", "false");
      $("appModalTitle").textContent = title;
      $("appModalMessage").textContent = message;
      $("appModalConfirm").textContent = buttonText;
      $("appModalCancel").classList.add("hidden");
      $("appModalIcon").textContent = type === "success" ? "✓" : "i";
      window.setTimeout(() => $("appModalConfirm").focus(), 40);
    });
  }

  function closeAppModal(confirmed) {
    const modal = $("appModal");
    modal.classList.add("hidden");
    modal.setAttribute("aria-hidden", "true");
    const resolve = state.modalResolve;
    state.modalResolve = null;
    if (resolve) resolve(Boolean(confirmed));
  }

  function showToast(message, isError = false) {
    window.clearTimeout(state.toastTimer);
    const toast = $("toast");
    toast.textContent = message;
    toast.classList.toggle("error", isError);
    toast.classList.add("show");
    state.toastTimer = window.setTimeout(() => {
      toast.classList.remove("show");
    }, 3400);
  }

  function perfLog(label, start) {
    if (!DEBUG_PERFORMANCE) return;
    console.log(`[perf] ${label}: ${Math.round(performance.now() - start)}ms`);
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function escapeAttribute(value) {
    return escapeHtml(value);
  }
})();
