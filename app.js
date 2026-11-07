// ================== القرّاء ==================
// ayahFolder فاضي = القارئ متاح للسورة كاملة فقط
const RECITERS = {
  yasser: {
    name: "ياسر الدوسري",
    ayahFolder: "Yasser_Ad-Dussary_128kbps",
    surahServer: "https://server11.mp3quran.net/yasser",
  },
  minshawi: {
    name: "محمد صديق المنشاوي",
    ayahFolder: "Minshawy_Murattal_128kbps",
    surahServer: "https://server10.mp3quran.net/minsh",
  },
  qarafi: {
    name: "عبدالله القرافي",
    ayahFolder: "",
    surahServer: "https://cdn.mp3quran.net/download/audio/abdullah-qarafi/r1",
  },
};

// ================== الإعدادات ==================
const API = "https://api.alquran.cloud/v1";
const pad = (n) => String(n).padStart(3, "0");

let reciterKey = "yasser";
const hasAyahAudio = () => !!RECITERS[reciterKey].ayahFolder;
const ayahAudioUrl = (s, a) =>
  `https://everyayah.com/data/${RECITERS[reciterKey].ayahFolder}/${pad(s)}${pad(a)}.mp3`;
const surahAudioUrl = (s) =>
  `${RECITERS[reciterKey].surahServer}/${pad(s)}.mp3`;
const NO_AYAH_MSG = "هذا القارئ متاح للسورة كاملة فقط، غيّر القارئ لسماع الآية";

// ================== العناصر ==================
const $ = (id) => document.getElementById(id);
const listView = $("listView");
const readerView = $("readerView");
const savedView = $("savedView");
const surahGrid = $("surahGrid");
const listMessage = $("listMessage");
const searchInput = $("searchInput");
const ayahsBox = $("ayahs");
const readerMessage = $("readerMessage");
const savedList = $("savedList");
const savedMessage = $("savedMessage");
const audio = $("audio");
const player = $("player");
const nowPlaying = $("nowPlaying");
const ayahMenu = $("ayahMenu");
const menuTitle = $("menuTitle");

// ================== الحالة ==================
let allSurahs = [];
let currentSurah = null;
let currentAyahs = [];
let playingIndex = -1;
let mode = null; // "ayah" أو "surah" أو "saved"
let menuIndex = -1;

// حالة التسميع
let tasmeeOn = false;
let tasmeeIdx = -1; // رقم الآية الحالية (من 0). -1 = لسه ما اخترتش
let matched = 0;    // عدد الكلمات الصحيحة في الآية الحالية

// ================== أدوات ==================
const toArabicDigits = (n) => Number(n).toLocaleString("ar-EG", { useGrouping: false });

const stripMarks = (w) => w.replace(/[\u064B-\u065F\u0670\u06D6-\u06ED\u0640]/g, "");

// توحيد الكلمة للمقارنة (بدون تشكيل وبتوحيد الحروف المتشابهة)
const norm = (s) =>
  s
    .replace(/[\u064B-\u065F\u0670\u06D6-\u06ED\u0640\u08D3-\u08FF]/g, "")
    .replace(/[\u0622\u0623\u0625\u0671]/g, "\u0627")
    .replace(/\u0649/g, "\u064A")
    .replace(/\u0629/g, "\u0647")
    .replace(/\u0624/g, "\u0648")
    .replace(/\u0626/g, "\u064A")
    .replace(/[^\u0621-\u063A\u0641-\u064A]/g, "");

function lev(a, b) {
  const m = a.length, n = b.length;
  const d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 0; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      d[i][j] = Math.min(
        d[i - 1][j] + 1,
        d[i][j - 1] + 1,
        d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
  }
  return d[m][n];
}

// هل الكلمة اللي اتسمعت = الكلمة المتوقعة؟ (فيه تسامح بسيط لأخطاء التعرّف)
function isMatch(heard, expected) {
  const h = norm(heard);
  const e = norm(expected);
  if (h === e) return true;
  if (e.length >= 4) {
    const allowed = e.length >= 8 ? 2 : 1;
    return lev(h, e) <= allowed;
  }
  return false;
}

// الـ API بيحط البسملة في أول آية في السور، بنشيلها ونعرضها لوحدها
function removeBasmala(text) {
  const words = text.split(" ");
  if (words.length > 4 && stripMarks(words[0]) === "بسم") {
    return words.slice(4).join(" ");
  }
  return text;
}

function store(key, value) {
  try { localStorage.setItem(key, value); } catch {}
}
function load(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}

function getBookmarks() {
  try { return JSON.parse(load("bookmarks")) || []; }
  catch { return []; }
}
function saveBookmarks(list) {
  store("bookmarks", JSON.stringify(list));
}

// ================== أصوات التنبيه ==================
let actx = null;
function beep(freq, dur, type) {
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    if (actx.state === "suspended") actx.resume();
    const o = actx.createOscillator();
    const g = actx.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.value = 0.15;
    o.connect(g);
    g.connect(actx.destination);
    o.start();
    g.gain.exponentialRampToValueAtTime(0.0001, actx.currentTime + dur);
    o.stop(actx.currentTime + dur);
  } catch {}
}
const wrongSound = () => beep(200, 0.15, "square"); // صوت "تك"
const doneSound = () => beep(880, 0.2, "sine");

// ================== التنقل بين الصفحات ==================
function setView(name) {
  listView.hidden = name !== "list";
  readerView.hidden = name !== "reader";
  savedView.hidden = name !== "saved";
  $("navHome").classList.toggle("active", name !== "saved");
  $("navSaved").classList.toggle("active", name === "saved");
  window.scrollTo(0, 0);
}

$("navHome").addEventListener("click", () => {
  stopAudio();
  resetTasmee();
  setView("list");
});
$("navSaved").addEventListener("click", showSaved);

// ================== الوضع الليلي ==================
function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  $("themeBtn").textContent = theme === "dark" ? "☀️ نهاري" : "🌙 ليلي";
  store("theme", theme);
}
$("themeBtn").addEventListener("click", () => {
  applyTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark");
});

// ================== حجم الخط ==================
const FONT_MIN = 1.3;
const FONT_MAX = 3.5;
const FONT_STEP = 0.2;
let fontSize = 1.9;

function applyFont(size) {
  fontSize = Math.min(FONT_MAX, Math.max(FONT_MIN, size));
  document.documentElement.style.setProperty("--ayah-size", fontSize.toFixed(1) + "rem");
  store("fontSize", String(fontSize));
}
$("fontPlus").addEventListener("click", () => applyFont(fontSize + FONT_STEP));
$("fontMinus").addEventListener("click", () => applyFont(fontSize - FONT_STEP));

// ================== القارئ ==================
function applyReciter(key) {
  if (!RECITERS[key]) key = "yasser";
  reciterKey = key;
  $("reciterSel").value = key;
  $("subtitle").textContent = `بصوت الشيخ ${RECITERS[key].name}`;
  store("reciter", key);
}
$("reciterSel").addEventListener("change", (e) => {
  stopAudio();
  applyReciter(e.target.value);
});

// ================== تحميل قائمة السور ==================
async function loadSurahs() {
  try {
    const res = await fetch(`${API}/surah`);
    if (!res.ok) throw new Error();
    const json = await res.json();
    allSurahs = json.data;
    listMessage.hidden = true;
    renderSurahs(allSurahs);
  } catch {
    listMessage.hidden = false;
    listMessage.textContent = "تعذّر تحميل السور. تأكد من اتصال الإنترنت وأعد المحاولة.";
  }
}

function renderSurahs(list) {
  surahGrid.innerHTML = "";
  if (list.length === 0) {
    listMessage.hidden = false;
    listMessage.textContent = "لا توجد نتائج.";
    return;
  }
  listMessage.hidden = true;

  list.forEach((s) => {
    const card = document.createElement("div");
    card.className = "surah-card";
    card.innerHTML = `
      <div class="surah-num">${toArabicDigits(s.number)}</div>
      <div>
        <div class="surah-name">${s.name}</div>
        <div class="surah-info">${s.revelationType === "Meccan" ? "مكية" : "مدنية"} • ${toArabicDigits(s.numberOfAyahs)} آية</div>
      </div>`;
    card.addEventListener("click", () => openSurah(s));
    surahGrid.appendChild(card);
  });
}

searchInput.addEventListener("input", () => {
  const q = stripMarks(searchInput.value.trim());
  const filtered = allSurahs.filter(
    (s) => stripMarks(s.name).includes(q) || String(s.number) === q
  );
  renderSurahs(filtered);
});

// ================== فتح سورة ==================
async function openSurah(surah) {
  stopAudio();
  resetTasmee();
  currentSurah = surah;
  currentAyahs = [];
  setView("reader");

  $("surahTitle").textContent = surah.name;
  $("surahMeta").textContent =
    `${surah.revelationType === "Meccan" ? "مكية" : "مدنية"} • ${toArabicDigits(surah.numberOfAyahs)} آية`;
  $("bismillah").hidden = surah.number === 1 || surah.number === 9;
  ayahsBox.innerHTML = "";
  readerMessage.hidden = false;
  readerMessage.textContent = "جاري تحميل الآيات...";

  try {
    const res = await fetch(`${API}/surah/${surah.number}/quran-uthmani`);
    if (!res.ok) throw new Error();
    const json = await res.json();
    currentAyahs = json.data.ayahs.map((a) => ({
      n: a.numberInSurah,
      text:
        a.numberInSurah === 1 && surah.number !== 1 && surah.number !== 9
          ? removeBasmala(a.text)
          : a.text,
    }));
    readerMessage.hidden = true;
    renderAyahs();
  } catch {
    readerMessage.textContent = "تعذّر تحميل السورة. تأكد من اتصال الإنترنت وأعد المحاولة.";
  }
}

// ================== عرض الآيات (نص متصل) ==================
const tasmeeWords = (i) => currentAyahs[i].text.split(" ").filter((w) => norm(w));

function ayahHtml(i) {
  const a = currentAyahs[i];
  const hidden = tasmeeOn && tasmeeIdx >= 0 && i >= tasmeeIdx;
  let body = a.text;
  if (hidden) {
    if (i === tasmeeIdx) {
      const shown = tasmeeWords(i).slice(0, matched).join(" ");
      body = (shown ? shown + " " : "") + "……………";
    } else {
      body = "……………………";
    }
  }
  return `${body} <span class="ayah-num">﴿${toArabicDigits(a.n)}﴾</span>`;
}

function updateAyahEl(i) {
  const el = $(`ayah-${i}`);
  if (el) el.innerHTML = ayahHtml(i);
}

function renderAyahs() {
  ayahsBox.innerHTML = "";

  currentAyahs.forEach((a, i) => {
    const hidden = tasmeeOn && tasmeeIdx >= 0 && i >= tasmeeIdx;
    const isCurrent = tasmeeOn && i === tasmeeIdx;

    const span = document.createElement("span");
    span.className = "ayah" + (hidden ? " hidden-ayah" : "") + (isCurrent ? " current-ayah" : "");
    span.id = `ayah-${i}`;
    span.innerHTML = ayahHtml(i);

    span.addEventListener("click", (e) => {
      e.stopPropagation();
      if (tasmeeOn) startTasmee(i);
      else openMenu(i);
    });

    ayahsBox.appendChild(span);
    ayahsBox.appendChild(document.createTextNode(" "));
  });
}

// ================== الميكروفون (التعرّف على الصوت) ==================
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
let rec = null;
let wantMic = false;
let judged = 0; // عدد الكلمات اللي اتحكم عليها في الجلسة الحالية

function setHeard(text) {
  $("tasmeeHeard").textContent = text;
}

function startMic() {
  if (!SR) {
    setHeard("المتصفح ده مش بيدعم التعرّف على الصوت. افتح الموقع من Chrome أو Edge.");
    return;
  }
  if (tasmeeIdx < 0 || tasmeeIdx >= currentAyahs.length) return;
  if (wantMic) return;

  stopAudio();
  rec = new SR();
  rec.lang = "ar-SA";
  rec.continuous = true;
  rec.interimResults = true;
  rec.maxAlternatives = 1;
  judged = 0;

  rec.onresult = handleResult;
  rec.onaudiostart = () => setHeard("🎙️ الميكروفون شغال... سمّع الآية");
  rec.onspeechstart = () => setHeard("👂 سمعت صوت...");

  rec.onerror = (e) => {
    if (e.error === "no-speech" || e.error === "aborted") return;
    wantMic = false;
    if (e.error === "not-allowed" || e.error === "service-not-allowed") {
      setHeard("لازم تسمح للموقع باستخدام الميكروفون (أيقونة القفل جنب الرابط).");
    } else if (e.error === "audio-capture") {
      setHeard("مفيش ميكروفون شغال على الجهاز.");
    } else if (e.error === "network") {
      setHeard("خدمة التعرّف على الصوت مش شغالة في المتصفح ده (Brave بيمنعها). جرّب Chrome أو Edge.");
    } else {
      setHeard("حصل خطأ في الميكروفون: " + e.error);
    }
    updateTasmeeUI();
  };

  rec.onend = () => {
    if (wantMic) {
      try { judged = 0; rec.start(); } catch {}
    } else {
      updateTasmeeUI();
    }
  };

  const isBrave = !!navigator.brave;
  if (isBrave) {
    setHeard("⚠️ إنت على Brave وهو بيمنع التعرّف على الصوت. افتح الموقع من Chrome أو Edge.");
  }

  wantMic = true;
  try {
    rec.start();
    if (!isBrave) setHeard("🎙️ بسمعك... ابدأ التسميع");
  } catch {
    wantMic = false;
  }
  beep(0.001, 0.01, "sine"); // بيفعّل الصوت في المتصفح
  updateTasmeeUI();
}

function stopMic() {
  wantMic = false;
  if (rec) {
    try { rec.stop(); } catch {}
  }
  updateTasmeeUI();
}

function handleResult(e) {
  const words = [];
  let lastFinal = true;
  for (let i = 0; i < e.results.length; i++) {
    const r = e.results[i];
    words.push(...r[0].transcript.trim().split(/\s+/).filter(Boolean));
    if (i === e.results.length - 1) lastFinal = r.isFinal;
  }
  setHeard("🎙️ سمعت: " + words.slice(-6).join(" "));
  // الكلمة الأخيرة في النتيجة المؤقتة ممكن تتغير، فبنحكم على اللي قبلها بس
  const limit = lastFinal ? words.length : words.length - 1;
  for (let k = judged; k < limit; k++) judgeWord(words[k]);
  if (limit > judged) judged = limit;
}

function judgeWord(w) {
  if (!tasmeeOn || tasmeeIdx < 0 || tasmeeIdx >= currentAyahs.length) return;
  if (!norm(w)) return;
  const ws = tasmeeWords(tasmeeIdx);
  if (matched >= ws.length) return;

  if (isMatch(w, ws[matched])) {
    matched++;
    setHeard(`✔ ${w}`);
    if (matched >= ws.length) completeAyah();
    else updateAyahEl(tasmeeIdx);
  } else {
    setHeard(`✘ سمعت «${w}» ... أعد الكلمة`);
    wrongSound();
    const el = $(`ayah-${tasmeeIdx}`);
    if (el) {
      el.classList.add("wrong");
      setTimeout(() => el.classList.remove("wrong"), 400);
    }
  }
}

function completeAyah() {
  doneSound();
  tasmeeIdx++;
  matched = 0;
  renderAyahs();
  updateTasmeeUI();
  const target = $(`ayah-${Math.min(tasmeeIdx, currentAyahs.length - 1)}`);
  if (target) target.scrollIntoView({ behavior: "smooth", block: "center" });
  if (tasmeeIdx >= currentAyahs.length) {
    stopMic();
    setHeard("🎉 ما شاء الله، خلّصت السورة");
  }
}

// ================== التسميع ==================
function updateTasmeeUI() {
  $("tasmeeBar").hidden = !tasmeeOn;
  $("tasmeeBtn").textContent = tasmeeOn ? "✖ إنهاء التسميع" : "🎤 تسميع";
  $("tasmeeBtn").classList.toggle("active-mode", tasmeeOn);
  if (!tasmeeOn) return;

  const info = $("tasmeeInfo");
  const finished = tasmeeIdx >= currentAyahs.length && currentAyahs.length > 0;
  const notStarted = tasmeeIdx < 0;

  if (notStarted) {
    info.textContent = "اضغط على الآية اللي هتبدأ التسميع منها. هي وكل اللي بعدها هيختفوا والميكروفون هيشتغل.";
  } else if (finished) {
    info.textContent = "ما شاء الله! خلّصت السورة 🎉 اضغط «ابدأ من جديد» لتعيد.";
  } else {
    info.textContent =
      `سمّع الآية ${toArabicDigits(currentAyahs[tasmeeIdx].n)} كلمة كلمة. الكلمة الغلط هتعمل صوت «تك» لحد ما تقولها صح.`;
  }

  const off = notStarted || finished;
  $("tMic").textContent = wantMic ? "⏹ إيقاف الميكروفون" : "🎙️ ابدأ الميكروفون";
  $("tMic").classList.toggle("listening", wantMic);
  $("tMic").disabled = off;
  $("tHint").disabled = off;
  $("tReveal").disabled = off;
  $("tListen").disabled = off;
  $("tReset").disabled = notStarted;
}

function resetTasmee() {
  stopMic();
  tasmeeOn = false;
  tasmeeIdx = -1;
  matched = 0;
  setHeard("");
  updateTasmeeUI();
}

function startTasmee(i) {
  tasmeeIdx = i;
  matched = 0;
  stopAudio();
  renderAyahs();
  updateTasmeeUI();
  const el = $(`ayah-${i}`);
  if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
  if (!wantMic) startMic();
}

$("tasmeeBtn").addEventListener("click", () => {
  if (!currentAyahs.length) return;
  if (tasmeeOn) {
    resetTasmee();
  } else {
    tasmeeOn = true;
    tasmeeIdx = -1;
    matched = 0;
    closeMenu();
    setHeard("");
    updateTasmeeUI();
  }
  renderAyahs();
});

$("tMic").addEventListener("click", () => {
  if (wantMic) stopMic();
  else startMic();
});

// إظهار الكلمة الجاية (لو التعرّف غلط أو نسيت)
$("tHint").addEventListener("click", () => {
  if (tasmeeIdx < 0 || tasmeeIdx >= currentAyahs.length) return;
  const ws = tasmeeWords(tasmeeIdx);
  matched++;
  if (matched >= ws.length) completeAyah();
  else updateAyahEl(tasmeeIdx);
});

// إظهار الآية كلها والانتقال للي بعدها
$("tReveal").addEventListener("click", () => {
  if (tasmeeIdx < 0 || tasmeeIdx >= currentAyahs.length) return;
  tasmeeIdx++;
  matched = 0;
  renderAyahs();
  updateTasmeeUI();
  const target = $(`ayah-${Math.min(tasmeeIdx, currentAyahs.length - 1)}`);
  if (target) target.scrollIntoView({ behavior: "smooth", block: "center" });
  if (tasmeeIdx >= currentAyahs.length) stopMic();
});

$("tListen").addEventListener("click", () => {
  if (tasmeeIdx >= 0 && tasmeeIdx < currentAyahs.length) {
    stopMic(); // عشان الميكروفون ما يسمعش صوت القارئ
    playAyah(tasmeeIdx, false);
  }
});

$("tReset").addEventListener("click", () => {
  stopAudio();
  stopMic();
  tasmeeIdx = -1;
  matched = 0;
  setHeard("");
  renderAyahs();
  updateTasmeeUI();
});

// ================== قائمة خيارات الآية ==================
function isSaved(index) {
  const a = currentAyahs[index];
  return getBookmarks().some((b) => b.s === currentSurah.number && b.a === a.n);
}

function updateSaveBtn() {
  const btn = $("mSave");
  const saved = isSaved(menuIndex);
  btn.textContent = saved ? "★ محفوظة" : "☆ حفظ";
  btn.classList.toggle("saved", saved);
}

function openMenu(index) {
  menuIndex = index;
  const a = currentAyahs[index];
  document.querySelectorAll(".ayah.selected").forEach((el) => el.classList.remove("selected"));
  $(`ayah-${index}`).classList.add("selected");
  menuTitle.textContent = `${currentSurah.name} - الآية ${toArabicDigits(a.n)}`;
  updateSaveBtn();
  ayahMenu.hidden = false;
}

function closeMenu() {
  ayahMenu.hidden = true;
  menuIndex = -1;
  document.querySelectorAll(".ayah.selected").forEach((el) => el.classList.remove("selected"));
}

$("mPlay").addEventListener("click", () => {
  const i = menuIndex;
  closeMenu();
  playAyah(i, false);
});

$("mFrom").addEventListener("click", () => {
  const i = menuIndex;
  closeMenu();
  playAyah(i, true);
});

$("mCopy").addEventListener("click", async (e) => {
  const btn = e.currentTarget;
  const a = currentAyahs[menuIndex];
  const txt = `${a.text} ﴿${toArabicDigits(a.n)}﴾ [${currentSurah.name}: ${toArabicDigits(a.n)}]`;
  try {
    await navigator.clipboard.writeText(txt);
    btn.textContent = "✔ تم النسخ";
  } catch {
    btn.textContent = "تعذّر النسخ";
  }
  setTimeout(() => (btn.textContent = "📋 نسخ"), 1500);
});

$("mSave").addEventListener("click", () => {
  const a = currentAyahs[menuIndex];
  let list = getBookmarks();
  if (isSaved(menuIndex)) {
    list = list.filter((b) => !(b.s === currentSurah.number && b.a === a.n));
  } else {
    list.push({ s: currentSurah.number, a: a.n, text: a.text });
  }
  saveBookmarks(list);
  updateSaveBtn();
});

$("mClose").addEventListener("click", closeMenu);

// الضغط في أي مكان بره القائمة يقفلها
document.addEventListener("click", (e) => {
  if (!ayahMenu.hidden && !e.target.closest("#ayahMenu")) closeMenu();
});

// ================== صفحة الآيات المحفوظة ==================
async function fetchAyahText(s, a) {
  try {
    const res = await fetch(`${API}/ayah/${s}:${a}/quran-uthmani`);
    if (!res.ok) throw new Error();
    const json = await res.json();
    let text = json.data.text;
    if (a === 1 && s !== 1 && s !== 9) text = removeBasmala(text);
    return text;
  } catch {
    return null;
  }
}

async function showSaved() {
  stopAudio();
  resetTasmee();
  setView("saved");
  savedList.innerHTML = "";

  let list = getBookmarks();
  if (list.length === 0) {
    savedMessage.hidden = false;
    savedMessage.textContent = "لا توجد آيات محفوظة بعد. اضغط على أي آية واختر «حفظ».";
    return;
  }

  savedMessage.hidden = false;
  savedMessage.textContent = "جاري التحميل...";

  if (allSurahs.length === 0) await loadSurahs();

  list.sort((x, y) => x.s - y.s || x.a - y.a);

  // نجيب نص أي آية محفوظة قديماً من غير نص
  let changed = false;
  await Promise.all(
    list.map(async (item) => {
      if (!item.text) {
        const t = await fetchAyahText(item.s, item.a);
        if (t) {
          item.text = t;
          changed = true;
        }
      }
    })
  );
  if (changed) saveBookmarks(list);

  savedMessage.hidden = true;
  list.forEach((item) => renderSavedItem(item));
}

function renderSavedItem(item) {
  const surah = allSurahs.find((s) => s.number === item.s);
  const surahName = surah ? surah.name : `سورة رقم ${toArabicDigits(item.s)}`;

  const card = document.createElement("div");
  card.className = "saved-item";

  const ref = document.createElement("div");
  ref.className = "saved-ref";
  ref.textContent = `${surahName} - الآية ${toArabicDigits(item.a)}`;

  const txt = document.createElement("div");
  txt.className = "saved-text";
  txt.textContent = item.text
    ? `${item.text} ﴿${toArabicDigits(item.a)}﴾`
    : "تعذّر تحميل نص الآية.";

  const actions = document.createElement("div");
  actions.className = "saved-actions";

  const playBtn = document.createElement("button");
  playBtn.className = "btn btn-primary";
  playBtn.textContent = "▶ استمع";
  playBtn.addEventListener("click", () => {
    if (!hasAyahAudio()) {
      showPlayer(NO_AYAH_MSG);
      return;
    }
    mode = "saved";
    playingIndex = -1;
    startAudio(ayahAudioUrl(item.s, item.a), `${surahName} - الآية ${toArabicDigits(item.a)}`);
  });
  actions.appendChild(playBtn);

  if (surah) {
    const openBtn = document.createElement("button");
    openBtn.className = "btn btn-light";
    openBtn.textContent = "📖 فتح في السورة";
    openBtn.addEventListener("click", async () => {
      await openSurah(surah);
      const idx = currentAyahs.findIndex((a) => a.n === item.a);
      if (idx >= 0) {
        const el = $(`ayah-${idx}`);
        if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
        openMenu(idx);
      }
    });
    actions.appendChild(openBtn);
  }

  const delBtn = document.createElement("button");
  delBtn.className = "btn btn-light";
  delBtn.textContent = "🗑 إزالة";
  delBtn.addEventListener("click", () => {
    const list = getBookmarks().filter((b) => !(b.s === item.s && b.a === item.a));
    saveBookmarks(list);
    card.remove();
    if (list.length === 0) {
      savedMessage.hidden = false;
      savedMessage.textContent = "لا توجد آيات محفوظة بعد. اضغط على أي آية واختر «حفظ».";
    }
  });
  actions.appendChild(delBtn);

  card.append(ref, txt, actions);
  savedList.appendChild(card);
}

// ================== الصوت ==================
function highlight(index) {
  document.querySelectorAll(".ayah.playing").forEach((el) => el.classList.remove("playing"));
  if (index >= 0) {
    const el = $(`ayah-${index}`);
    if (el) {
      el.classList.add("playing");
      el.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }
}

function showPlayer(text) {
  nowPlaying.textContent = text;
  player.hidden = false;
}

function startAudio(url, label) {
  audio.src = url;
  audio.play().catch(() => {
    showPlayer("تعذّر تشغيل الصوت، تأكد من الإنترنت");
  });
  showPlayer(`${label} • ${RECITERS[reciterKey].name}`);
}

function playAyah(index, continuous) {
  if (!hasAyahAudio()) {
    showPlayer(NO_AYAH_MSG);
    return;
  }
  mode = "ayah";
  playingIndex = index;
  const a = currentAyahs[index];
  audio.dataset.chain = continuous ? "1" : "0";
  startAudio(
    ayahAudioUrl(currentSurah.number, a.n),
    `${currentSurah.name} - الآية ${toArabicDigits(a.n)}`
  );
  highlight(index);
}

function playSurah() {
  stopMic();
  mode = "surah";
  playingIndex = -1;
  highlight(-1);
  startAudio(surahAudioUrl(currentSurah.number), `${currentSurah.name} - السورة كاملة`);
}

function stopAudio() {
  audio.pause();
  audio.removeAttribute("src");
  audio.load();
  mode = null;
  playingIndex = -1;
  highlight(-1);
  player.hidden = true;
  closeMenu();
}

audio.addEventListener("ended", () => {
  if (mode !== "ayah") {
    stopAudio();
    return;
  }
  const chain = audio.dataset.chain === "1" || $("continuousChk").checked;
  if (chain && playingIndex + 1 < currentAyahs.length) {
    playAyah(playingIndex + 1, audio.dataset.chain === "1");
  } else {
    stopAudio();
  }
});

audio.addEventListener("error", () => {
  if (audio.getAttribute("src")) showPlayer("حدث خطأ في تحميل الصوت");
});

$("playSurahBtn").addEventListener("click", playSurah);
$("stopBtn").addEventListener("click", stopAudio);

$("backBtn").addEventListener("click", () => {
  stopAudio();
  resetTasmee();
  setView("list");
});

// ================== تشغيل ==================
applyTheme(load("theme") === "dark" ? "dark" : "light");
applyFont(parseFloat(load("fontSize")) || 1.9);
applyReciter(load("reciter") || "yasser");
loadSurahs();