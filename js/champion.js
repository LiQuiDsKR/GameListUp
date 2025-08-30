/* LOL 챔피언 맞추기
   - 최신 챔피언/아이콘은 Riot Data Dragon에서 실행 시점에 동적 로딩
   - 한글/영문/ID 모두 정답 처리 (예: 오공 / Wukong / MonkeyKing)
   - 진행상황은 localStorage 저장 (버전+모드별 분리)
   - 난이도: 쉬움(초상화 보이고 이름만 숨김), 어려움(힌트 없음, 맞출 때마다 카드가 생성되고 최근 정답이 맨 앞)
*/

(() => {
  "use strict";

  // Data Dragon 엔드포인트
  const VERSIONS_URL = "https://ddragon.leagueoflegends.com/api/versions.json";
  const CDN = (ver) => `https://ddragon.leagueoflegends.com/cdn/${ver}`;
  const CHAMP_JSON = (ver, locale) => `${CDN(ver)}/data/${locale}/champion.json`;
  const CHAMP_IMG = (ver, id) => `${CDN(ver)}/img/champion/${id}.png`;

  // DOM
  const lobby = document.querySelector("#lobby");
  const gameSec = document.querySelector("#game");
  const startBtn = document.querySelector("#start-btn");
  const backBtn = document.querySelector("#back-btn");

  const diffEasy = document.querySelector("#diff-easy");
  const diffHard = document.querySelector("#diff-hard");

  const form = document.querySelector("#guess-form");
  const input = document.querySelector("#guess-input");
  const grid = document.querySelector("#grid");
  const msg = document.querySelector("#message");
  const guessedCountEl = document.querySelector("#guessed-count");
  const totalCountEl = document.querySelector("#total-count");
  const progressBar = document.querySelector("#progress-bar");
  const resetBtn = document.querySelector("#reset-btn");

  // 상태
  let version = null;
  let champs = [];                // [{id, key, koName, enName, img}]
  let byNormName = new Map();     // normalizedName -> id
  let guessed = new Set();        // 맞춘 id 집합
  let guessOrder = [];            // 어려움 모드에서 최근 정답 순서 (앞이 최신)
  let mode = "easy";              // "easy" | "hard"
  let storageKey = "";            // localStorage 키

  // 문자열 정규화 (공백/구두점 제거 + 소문자)
  const normalize = (s) =>
    (s || "")
      .toString()
      .trim()
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, "");

  // 메시지
  let messageTimer = null;
  function setMessage(text, kind = "info") {
    msg.textContent = text || "";
    msg.style.color = kind === "error" ? "#ff9b9b" :
                      kind === "ok"    ? "#9bffc7" : "#9aa3b2";
    if (messageTimer) clearTimeout(messageTimer);
    if (text) messageTimer = setTimeout(() => (msg.textContent = ""), 2000);
  }

  // 진행률/카운트
  function updateHUD() {
    const total = champs.length;
    const g = guessed.size;
    guessedCountEl.textContent = g;
    totalCountEl.textContent = total;
    const pct = total ? Math.round((g / total) * 100) : 0;
    progressBar.style.width = pct + "%";
    progressBar.parentElement.setAttribute("aria-valuenow", String(pct));
    if (total && g === total) setMessage("완료! 모든 챔피언을 맞혔습니다.", "ok");
  }

  // 저장 키 구성
  function setStorageKey() {
    storageKey = `lol-guess-${version}-${mode}`;
  }

  // 저장/복원
  function saveProgress() {
    if (!storageKey) return;
    const payload = {
      guessed: [...guessed],
      guessOrder: [...guessOrder],
    };
    localStorage.setItem(storageKey, JSON.stringify(payload));
  }
  function loadProgress() {
    if (!storageKey) return;
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) return;
      const data = JSON.parse(raw);
      if (Array.isArray(data?.guessed)) data.guessed.forEach((id) => guessed.add(id));
      if (Array.isArray(data?.guessOrder)) guessOrder = data.guessOrder.slice(0);
    } catch {}
  }

  // 카드 생성
  function createCard(c) {
    const li = document.createElement("li");
    li.className = "card";
    li.dataset.id = c.id;

    const wrap = document.createElement("div");
    wrap.className = "thumb-wrap";

    const img = document.createElement("img");
    img.src = c.img;
    img.alt = `${c.koName || c.enName}`;
    img.loading = "lazy";

    const name = document.createElement("div");
    name.className = "name";
    name.textContent = c.koName || c.enName || c.id;

    wrap.appendChild(img);
    li.appendChild(wrap);
    li.appendChild(name);
    return li;
  }

  // 그리드 렌더링
  function buildGrid() {
    champs.sort((a, b) => (a.koName || a.enName).localeCompare(b.koName || b.enName, "ko"));
    grid.innerHTML = "";

    if (mode === "easy") {
      // 모든 카드 렌더링, 이름만 숨김
      const frag = document.createDocumentFragment();
      champs.forEach((c) => {
        const li = createCard(c);
        const nameEl = li.querySelector(".name");
        if (!guessed.has(c.id)) nameEl.classList.add("is-hidden-name");
        frag.appendChild(li);
      });
      grid.appendChild(frag);
    } else {
      // 어려움: 맞춘 카드만, 최근 정답이 앞쪽
      if (guessOrder.length) {
        const frag = document.createDocumentFragment();
        guessOrder.forEach((id) => {
          const c = champs.find((x) => x.id === id);
          if (!c) return;
          frag.appendChild(createCard(c));
        });
        grid.appendChild(frag);
      }
    }

    updateHUD();
  }

  // 카드 강조
  function popReveal(el) {
    if (!el) return;
    el.classList.add("revealed");
    setTimeout(() => el.classList.remove("revealed"), 260);
  }

  // 제출 처리
  function onSubmit(e) {
    e.preventDefault();
    const raw = input.value;
    const q = normalize(raw);
    if (!q) {
      setMessage("이름을 입력하세요.", "error");
      return;
    }

    const hitId = byNormName.get(q);
    if (!hitId) {
      setMessage("일치하는 챔피언이 없습니다.", "error");
      return;
    }
    if (guessed.has(hitId)) {
      setMessage("이미 맞춘 챔피언입니다.");
      input.select();
      return;
    }

    guessed.add(hitId);

    if (mode === "easy") {
      const nameEl = grid.querySelector(`.card[data-id="${CSS.escape(hitId)}"] .name`);
      if (nameEl) nameEl.classList.remove("is-hidden-name");
      const cardEl = grid.querySelector(`.card[data-id="${CSS.escape(hitId)}"]`);
      popReveal(cardEl);
      setMessage("정답!", "ok");
    } else {
      const c = champs.find((x) => x.id === hitId);
      if (c) {
        const li = createCard(c);
        grid.insertBefore(li, grid.firstChild);
        popReveal(li);
      }
      guessOrder.unshift(hitId);
      setMessage("정답!", "ok");
    }

    input.value = "";
    saveProgress();
    updateHUD();
  }

  // 초기화
  function onReset() {
    if (!confirm("정말 초기화할까요? 진행 상황이 삭제됩니다.")) return;
    guessed.clear();
    guessOrder = [];
    saveProgress();

    if (mode === "easy") {
      grid.querySelectorAll(".card .name").forEach((name) => name.classList.add("is-hidden-name"));
    } else {
      grid.innerHTML = "";
    }

    updateHUD();
    setMessage("초기화 완료.");
  }

  // 데이터 로드
  async function loadData() {
    const versions = await fetch(VERSIONS_URL).then((r) => r.json());
    version = versions?.[0];
    if (!version) throw new Error("버전 정보를 가져올 수 없습니다.");

    mode = diffHard.checked ? "hard" : "easy";
    setStorageKey();
    loadProgress();

    const [ko, en] = await Promise.all([
      fetch(CHAMP_JSON(version, "ko_KR")).then((r) => r.json()),
      fetch(CHAMP_JSON(version, "en_US")).then((r) => r.json()),
    ]);

    const koData = ko?.data || {};
    const enData = en?.data || {};

    champs = Object.keys(koData).map((id) => {
      const k = koData[id];
      const e = enData[id] || {};
      return {
        id,
        key: k?.key || e?.key,
        koName: k?.name || null,
        enName: e?.name || id,
        img: CHAMP_IMG(version, id),
      };
    });

    // 이름 정규화 매핑
    byNormName.clear();
    champs.forEach((c) => {
      [c.koName, c.enName, c.id].forEach((name) => {
        const norm = normalize(name);
        if (norm && !byNormName.has(norm)) byNormName.set(norm, c.id);
      });
      const extra = normalize((c.enName || "").replace(/['’.\s]/g, ""));
      if (extra && !byNormName.has(extra)) byNormName.set(extra, c.id);
    });
  }

  // 게임 시작
  function enterGame() {
    mode = diffHard.checked ? "hard" : "easy";
    setStorageKey();

    guessed = new Set();
    guessOrder = [];
    loadProgress();

    buildGrid();
    updateHUD();

    lobby.hidden = true;
    gameSec.hidden = false;
    input.focus();
  }

  // 로비로 돌아가기
  function backToLobby() {
    gameSec.hidden = true;
    lobby.hidden = false;
  }

  // 시작
  async function init() {
    try {
      await loadData();
      setMessage("데이터 로드 완료.");
    } catch (err) {
      console.error(err);
      setMessage("데이터 로드에 실패했습니다. 인터넷 연결을 확인하세요.", "error");
    }

    startBtn.addEventListener("click", enterGame);

    form.addEventListener("submit", onSubmit);
    resetBtn.addEventListener("click", onReset);
  }

  init();
})();
