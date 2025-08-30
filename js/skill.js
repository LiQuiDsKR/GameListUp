/* LOL 챔피언 스킬 맞추기 (Data Dragon 기반, 패시브 제외, Q/W/E/R 키 제출)
   - 최신 버전 자동 감지
   - 라운드마다 무작위 챔피언의 Q/W/E/R 중 하나를 출제
   - 한글/영문/내부ID 모두 정답 처리 (정규화)
   - 챔피언 상세(ko_KR)는 캐시하여 네트워크 요청 최소화
*/

(() => {
  "use strict";

  // DOM 참조
  const imgEl = document.getElementById("skill-image");
  const resultEl = document.getElementById("result");
  const nextBtn = document.getElementById("next-btn");
  const formEl = document.getElementById("skill-form");
  const champInput = document.getElementById("champion-input");
  const loadingEl = document.getElementById("loading");
  const autocompleteEl = document.getElementById("champion-autocomplete");
  // 자동완성 상태
  let autocompleteList = [];
  let autocompleteIndex = -1;

  // Data Dragon 엔드포인트
  const VERSIONS_URL = "https://ddragon.leagueoflegends.com/api/versions.json";
  const CDN = (ver) => `https://ddragon.leagueoflegends.com/cdn/${ver}`;
  const CHAMP_LIST = (ver, locale) => `${CDN(ver)}/data/${locale}/champion.json`;
  const CHAMP_DETAIL = (ver, locale, id) => `${CDN(ver)}/data/${locale}/champion/${id}.json`;
  const SPELL_IMG = (ver, file) => `${CDN(ver)}/img/spell/${file}`;

  // 상태
  let version = null;
  let champs = [];               // [{ id, koName, enName }]
  let nameToId = new Map();      // normalizedName -> id
  let detailCache = new Map();   // id -> detail(ko_KR)
  let current = null;            // { id, koName, answerSkill: 'Q'|'W'|'E'|'R', imageUrl }

  // 문자열 정규화 (문자/숫자만 남기고 소문자)
  const normalize = (s) =>
    (s || "")
      .toString()
      .trim()
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, "");

  function setLoading(text) {
    if (!loadingEl) return;
    loadingEl.textContent = text || "";
    loadingEl.style.display = text ? "block" : "none";
  }

  // 초기화
  async function init() {
    try {
        setLoading("데이터 로딩 중...");
        // 1) 최신 버전
        const versions = await fetch(VERSIONS_URL).then((r) => r.json());
        version = versions?.[0];
        if (!version) throw new Error("버전 정보를 가져올 수 없습니다.");

        // 2) 챔피언 목록 (ko_KR / en_US)
        const [koList, enList] = await Promise.all([
            fetch(CHAMP_LIST(version, "ko_KR")).then((r) => r.json()),
            fetch(CHAMP_LIST(version, "en_US")).then((r) => r.json()),
        ]);
        const koData = koList?.data || {};
        const enData = enList?.data || {};

        champs = Object.keys(koData).map((id) => {
            const k = koData[id];
            const e = enData[id] || {};
            return { id, koName: k?.name || null, enName: e?.name || id };
        });

        // 챔피언 초상화 URL 생성
        champs.forEach((c) => {
            c.portrait = `${CDN(version)}/img/champion/${c.id}.png`;
        });

        // 이름 → ID 매핑 (한글/영문/내부 ID + 공백/아포스트로피 제거형)
        nameToId.clear();
        champs.forEach((c) => {
            [c.koName, c.enName, c.id].forEach((nm) => {
                const key = normalize(nm);
                if (key && !nameToId.has(key)) nameToId.set(key, c.id);
            });
            const extra = normalize((c.enName || "").replace(/['’.\s]/g, ""));
            if (extra && !nameToId.has(extra)) nameToId.set(extra, c.id);
        });

        await showSkill();
        champInput.focus();
        setLoading("");
    } catch (err) {
        console.error(err);
        setLoading("로딩 실패: 인터넷 연결을 확인해 주세요.");
    }
  }

  function pickRandomChampionId() {
    const idx = Math.floor(Math.random() * champs.length);
    return champs[idx].id;
  }

  async function getChampionDetailKo(id) {
    if (detailCache.has(id)) return detailCache.get(id);
    const url = CHAMP_DETAIL(version, "ko_KR", id);
    const data = await fetch(url).then((r) => r.json());
    const obj = data?.data?.[id];
    if (!obj) throw new Error("챔피언 상세를 가져올 수 없습니다: " + id);
    detailCache.set(id, obj);
    return obj;
  }

  // 문제 출제 (패시브 제외, Q/W/E/R만)
  async function showSkill() {
    resultEl.textContent = "";
    nextBtn.style.display = "none";
    champInput.value = "";
  hideAutocomplete();
  // 자동완성 추천 리스트 생성
  function updateAutocomplete() {
    const val = champInput.value.trim().toLowerCase();
    if (!val) {
      hideAutocomplete();
      return;
    }
    autocompleteList = champs.filter(c =>
      c.koName?.toLowerCase().includes(val) ||
      c.enName?.toLowerCase().includes(val) ||
      c.id?.toLowerCase().includes(val)
    ).slice(0, 8); // 최대 8개
    renderAutocomplete();
  }

  function renderAutocomplete() {
    if (!autocompleteList.length) {
      hideAutocomplete();
      return;
    }
    autocompleteEl.innerHTML = autocompleteList.map((c, i) =>
      `<div class="autocomplete-item${i === autocompleteIndex ? ' selected' : ''}" data-idx="${i}">
        <img src="${c.portrait}" alt="${c.koName}" class="champ-portrait" width="32" height="32">
        <span>${c.koName} (${c.enName})</span>
      </div>`
    ).join("");
    autocompleteEl.style.display = "block";
  }

  function hideAutocomplete() {
    autocompleteEl.style.display = "none";
    autocompleteList = [];
    autocompleteIndex = -1;
  }

  champInput.addEventListener("input", updateAutocomplete);

  champInput.addEventListener("keydown", (e) => {
    // QWER 키는 자동완성 탐색에서 무시
    if (["Q", "W", "E", "R", "ㅂ", "ㅈ", "ㄷ", "ㄱ"].includes(e.key.toUpperCase())) return;
    if (autocompleteList.length) {
      if (["ArrowDown", "ArrowUp", "Enter", "Escape"].includes(e.key)) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          autocompleteIndex = (autocompleteIndex + 1) % autocompleteList.length;
          renderAutocomplete();
        } else if (e.key === "ArrowUp") {
          e.preventDefault();
          autocompleteIndex = (autocompleteIndex - 1 + autocompleteList.length) % autocompleteList.length;
          renderAutocomplete();
        } else if (e.key === "Enter") {
          // 자동완성 후보가 1개 남았을 때 엔터 시 해당 이름으로 입력 후 제출
          if (autocompleteList.length === 1) {
            champInput.value = autocompleteList[0].koName;
            hideAutocomplete();
            e.preventDefault();
            // 입력필드 포커스 해제 (제출처럼 동작)
            champInput.blur();
            // 폼 제출 이벤트 트리거
            formEl.dispatchEvent(new Event('submit', { cancelable: true }));
            return;
          }
          if (autocompleteIndex >= 0 && autocompleteList[autocompleteIndex]) {
            champInput.value = autocompleteList[autocompleteIndex].koName;
            hideAutocomplete();
            e.preventDefault();
            return;
          }
        } else if (e.key === "Escape") {
          hideAutocomplete();
        }
      }
    }

  });

  autocompleteEl.addEventListener("mousedown", (e) => {
    const item = e.target.closest(".autocomplete-item");
    if (item) {
      const idx = parseInt(item.getAttribute("data-idx"));
      champInput.value = autocompleteList[idx].koName;
      hideAutocomplete();
      champInput.focus();
    }
  });

    const champId = pickRandomChampionId();
    const detail = await getChampionDetailKo(champId);

    const types = ["Q", "W", "E", "R"];
    const type = types[Math.floor(Math.random() * types.length)];
    const idx = { Q: 0, W: 1, E: 2, R: 3 }[type];
    const spell = detail?.spells?.[idx];
    const file = spell?.image?.full;
    const imageUrl = SPELL_IMG(version, file);

    imgEl.src = imageUrl || "";
    const koName = detail?.name || champId;

    current = { id: champId, koName, answerSkill: type, imageUrl };
    champInput.focus();
    document.querySelectorAll('.qwer-btn').forEach(btn => btn.classList.remove('selected'));
  }

  // Q/W/E/R로 제출
  function submitWithSkill(skillLetter) {
    if (!current) return;

    // QWER 버튼 선택 CSS 처리
    document.querySelectorAll('.qwer-btn').forEach(btn => {
      btn.classList.remove('selected');
      if (btn.getAttribute('data-skill') === skillLetter) {
        btn.classList.add('selected');
      }
    });

    const championRaw = champInput.value.trim();
    const norm = normalize(championRaw);
    if (!norm) {
      resultEl.textContent = "챔피언 이름을 입력해주세요.";
      return;
    }

    const idByName = nameToId.get(norm);
    const isChampionCorrect = idByName === current.id;
    const isSkillCorrect = skillLetter === current.answerSkill;

    if (isChampionCorrect && isSkillCorrect) {
      resultEl.textContent = "정답입니다!";
      nextBtn.style.display = "inline-block";
    } else {
      resultEl.textContent = "오답입니다. 다시 시도해보세요.";
    }
  }

  // 폼 submit 방지(안내만)
  function onFormSubmit(e) {
    e.preventDefault();
    resultEl.textContent = "키보드 Q/W/E/R 또는 버튼을 눌러 제출하세요.";
    champInput.blur(); // 엔터 시 포커스 해제
  }

  // 다음 문제
  async function nextSkill() {
    try {
      await showSkill();
    } catch (err) {
      console.error(err);
      resultEl.textContent = "다음 문제를 불러오는 중 오류가 발생했습니다.";
    }
  }

  // 이벤트 바인딩
  document.addEventListener("keydown", (e) => {
    // 정답 상태에서 엔터 입력 시 다음 문제로 이동 (입력필드와 무관)
    if (e.key === "Enter" && resultEl.textContent.includes("정답입니다!")) {
      e.preventDefault();
      nextBtn.click();
      return;
    }
    // 입력필드에 포커스가 있을 때 방향키 입력은 무시
    if (document.activeElement === champInput && ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)) {
      return;
    }
    // 입력필드에 포커스가 있으면 QWER 제출 무시 + 이벤트 버블링 차단
    if (document.activeElement === champInput) {
      e.stopPropagation();
      return;
    }
    let k = e.key.toUpperCase();
    // 한글 키보드 QWER: ㅂ(Q), ㅈ(W), ㄷ(E), ㄱ(R)
    const korMap = { "ㅂ": "Q", "ㅈ": "W", "ㄷ": "E", "ㄱ": "R" };
    if (korMap[k]) k = korMap[k];
    if (["Q", "W", "E", "R"].includes(k)) {
      submitWithSkill(k);
    }
  });

  // QWER 버튼(데이터 속성) 클릭
  document.querySelectorAll(".qwer-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const skill = btn.getAttribute("data-skill");
      submitWithSkill(skill);
    });
  });

  formEl.addEventListener("submit", onFormSubmit);
  nextBtn.addEventListener("click", nextSkill);

  // 시작
  window.addEventListener("load", init);
})();
