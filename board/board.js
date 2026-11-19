// Shared whiteboard over public Nostr relays.
//  - Each finished stroke is a signed kind-1 event (stored by relays).
//  - In-progress strokes are broadcast as ephemeral kind-20000 events (relayed
//    live, never stored).
//  - Undo is an event referencing your own stroke; only the stroke's author
//    can undo it.
//  - Clear is a signed event from anyone, triggered by running clearBoard() in
//    the browser console. It hides every stroke made before it.
// CLEARED_AT (unix seconds) is a hard-coded cutoff for older history.
const BOARD = "martango.github.io/board";
const CLEARED_AT = 0;
const RELAYS = ["wss://relay.damus.io", "wss://nos.lol", "wss://relay.primal.net"];
const TTL_S = 30 * 24 * 60 * 60;
const W = 1000, H = 600;       // logical canvas size
const MAX_POINTS = 300;        // per stroke event
const MAX_STROKES = 500;       // history requested from each relay
const MIN_DIST = 2;            // drop points closer than this
const LIVE_MS = 100;           // live preview throttle
const KIND_STROKE = 1, KIND_LIVE = 20000;

const { generateSecretKey, getPublicKey, finalizeEvent, verifyEvent } = NostrTools;

// Same throwaway identity as the chat (shared localStorage key).
const toHex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
const fromHex = (h) => Uint8Array.from(h.match(/../g), (x) => parseInt(x, 16));
let secretKey;
try {
  const saved = localStorage.getItem("nostr-sk");
  secretKey = saved ? fromHex(saved) : generateSecretKey();
  if (!saved) localStorage.setItem("nostr-sk", toHex(secretKey));
} catch (e) {
  secretKey = generateSecretKey();
}
const myPub = getPublicKey(secretKey);

const canvas = document.getElementById("board");
const ctx = canvas.getContext("2d");
const colorInput = document.getElementById("color");
const widthInput = document.getElementById("width");
const statusEl = document.getElementById("status");

const sinceTime = () => Math.max(Math.floor(Date.now() / 1000) - TTL_S, CLEARED_AT);

// ---- State ---------------------------------------------------------------
const seen = new Set();          // event ids already processed
const strokes = new Map();       // event id -> {id, pubkey, created_at, c, w, p}
const undone = new Map();        // stroke event id -> Set of pubkeys that undid it
const live = new Map();          // pubkey:sid -> {c, w, p, t}
let current = null;              // my in-progress stroke
let clearedAt = 0;          // newest honored clear event time
let dirty = true;

// ---- Validation ----------------------------------------------------------
const isNum = (n) => typeof n === "number" && isFinite(n);
function validStroke(s) {
  return (
    s && typeof s.sid === "string" && s.sid.length <= 32 &&
    typeof s.c === "string" && /^#[0-9a-f]{6}$/i.test(s.c) &&
    isNum(s.w) && s.w >= 1 && s.w <= 40 &&
    Array.isArray(s.p) && s.p.length >= 1 && s.p.length <= MAX_POINTS &&
    s.p.every((q) => Array.isArray(q) && q.length === 2 && isNum(q[0]) && isNum(q[1]) &&
      q[0] >= 0 && q[0] <= W && q[1] >= 0 && q[1] <= H)
  );
}

// ---- Event handling ------------------------------------------------------
function addEvent(ev) {
  if (!ev || seen.has(ev.id)) return;
  if (!Array.isArray(ev.tags) || !ev.tags.some((t) => t[0] === "t" && t[1] === BOARD)) return;
  if (typeof ev.content !== "string" || ev.content.length > 20000) return;
  if (ev.created_at < sinceTime()) return;
  if (!verifyEvent(ev)) return;
  seen.add(ev.id);

  if (ev.kind === KIND_LIVE) {
    if (ev.pubkey === myPub) return;
    let s;
    try { s = JSON.parse(ev.content); } catch (e) { return; }
    if (!validStroke(s)) return;
    const key = ev.pubkey + ":" + s.sid;
    const l = live.get(key) || { c: s.c, w: s.w, p: [], t: 0 };
    l.p.push(...s.p);
    if (l.p.length > MAX_POINTS * 2) return;
    l.t = Date.now();
    live.set(key, l);
  } else if (ev.kind === KIND_STROKE) {
    const undoTag = ev.tags.find((t) => t[0] === "undo");
    if (ev.tags.some((t) => t[0] === "clear")) {
      if (ev.created_at > clearedAt) {
        clearedAt = ev.created_at;
        live.clear();
      }
    } else if (undoTag) {
      if (typeof undoTag[1] !== "string") return;
      if (!undone.has(undoTag[1])) undone.set(undoTag[1], new Set());
      undone.get(undoTag[1]).add(ev.pubkey);
    } else {
      let s;
      try { s = JSON.parse(ev.content); } catch (e) { return; }
      if (!validStroke(s)) return;
      strokes.set(ev.id, { id: ev.id, pubkey: ev.pubkey, created_at: ev.created_at, c: s.c, w: s.w, p: s.p });
      live.delete(ev.pubkey + ":" + s.sid);
    }
  } else {
    return;
  }
  dirty = true;
}

// ---- Rendering -----------------------------------------------------------
function drawPath(c, w, p) {
  ctx.strokeStyle = c;
  ctx.fillStyle = c;
  ctx.lineWidth = w;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  if (p.length === 1) {
    ctx.beginPath();
    ctx.arc(p[0][0], p[0][1], w / 2, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  ctx.beginPath();
  ctx.moveTo(p[0][0], p[0][1]);
  for (let i = 1; i < p.length; i++) ctx.lineTo(p[i][0], p[i][1]);
  ctx.stroke();
}

function render() {
  requestAnimationFrame(render);
  if (!dirty) return;
  dirty = false;
  ctx.clearRect(0, 0, W, H);
  const cutoff = sinceTime();
  [...strokes.values()]
    .filter((s) => s.created_at >= cutoff && s.created_at > clearedAt && !(undone.get(s.id) || new Set()).has(s.pubkey))
    .sort((a, b) => a.created_at - b.created_at || (a.id < b.id ? -1 : 1))
    .forEach((s) => drawPath(s.c, s.w, s.p));
  live.forEach((l) => l.p.length && drawPath(l.c, l.w, l.p));
  if (current && current.p.length) drawPath(current.c, current.w, current.p);
}
requestAnimationFrame(render);

// Drop live previews whose author stopped sending (e.g. they closed the tab).
setInterval(() => {
  const now = Date.now();
  live.forEach((l, k) => {
    if (now - l.t > 5000) { live.delete(k); dirty = true; }
  });
}, 1000);

// ---- Relays --------------------------------------------------------------
const sockets = [];
function updateStatus() {
  const open = sockets.filter((ws) => ws.readyState === WebSocket.OPEN).length;
  statusEl.textContent = open + "/" + RELAYS.length + " relays connected";
}
function connect(url) {
  const ws = new WebSocket(url);
  sockets.push(ws);
  ws.onopen = () => {
    updateStatus();
    ws.send(JSON.stringify(["REQ", "board", {
      kinds: [KIND_STROKE, KIND_LIVE],
      "#t": [BOARD],
      since: sinceTime(),
      limit: MAX_STROKES,
    }]));
  };
  ws.onmessage = (m) => {
    try {
      const data = JSON.parse(m.data);
      if (data[0] === "EVENT" && data[1] === "board") addEvent(data[2]);
    } catch (e) {}
  };
  ws.onclose = () => {
    sockets.splice(sockets.indexOf(ws), 1);
    updateStatus();
    setTimeout(() => connect(url), 5000);
  };
  ws.onerror = () => ws.close();
}
RELAYS.forEach(connect);

function publish(kind, tags, content) {
  const ev = finalizeEvent(
    { kind, created_at: Math.floor(Date.now() / 1000), tags: [["t", BOARD], ...tags], content },
    secretKey
  );
  const payload = JSON.stringify(["EVENT", ev]);
  sockets.forEach((ws) => ws.readyState === WebSocket.OPEN && ws.send(payload));
  return ev;
}

// ---- Drawing -------------------------------------------------------------
const newSid = () => Math.random().toString(36).slice(2, 10);

function pointFromEvent(e) {
  const r = canvas.getBoundingClientRect();
  const x = Math.min(W, Math.max(0, Math.round(((e.clientX - r.left) / r.width) * W)));
  const y = Math.min(H, Math.max(0, Math.round(((e.clientY - r.top) / r.height) * H)));
  return [x, y];
}

function startStroke(pt) {
  current = { sid: newSid(), c: colorInput.value, w: Number(widthInput.value), p: [pt], sent: 0 };
  dirty = true;
}

function finishStroke() {
  if (!current) return;
  const s = current;
  current = null;
  flushLive(s);
  const ev = publish(KIND_STROKE, [], JSON.stringify({ sid: s.sid, c: s.c, w: s.w, p: s.p }));
  addEvent(ev);
}

function flushLive(s) {
  if (s.p.length <= s.sent) return;
  const from = s.sent > 0 ? s.sent - 1 : 0; // overlap one point for continuity
  publish(KIND_LIVE, [], JSON.stringify({ sid: s.sid, c: s.c, w: s.w, p: s.p.slice(from) }));
  s.sent = s.p.length;
}
setInterval(() => current && flushLive(current), LIVE_MS);

canvas.addEventListener("pointerdown", (e) => {
  if (e.button !== 0 && e.pointerType === "mouse") return;
  canvas.setPointerCapture(e.pointerId);
  startStroke(pointFromEvent(e));
});
canvas.addEventListener("pointermove", (e) => {
  if (!current) return;
  const pt = pointFromEvent(e);
  const last = current.p[current.p.length - 1];
  if (Math.hypot(pt[0] - last[0], pt[1] - last[1]) < MIN_DIST) return;
  current.p.push(pt);
  dirty = true;
  if (current.p.length >= MAX_POINTS) {
    // Split long strokes so each event stays small.
    const { c, w } = current;
    finishStroke();
    startStroke(pt);
    current.c = c; current.w = w;
  }
});
["pointerup", "pointercancel"].forEach((t) => canvas.addEventListener(t, finishStroke));

document.getElementById("undo").addEventListener("click", () => {
  const mine = [...strokes.values()]
    .filter((s) => s.pubkey === myPub && !(undone.get(s.id) || new Set()).has(myPub))
    .sort((a, b) => b.created_at - a.created_at || (a.id < b.id ? 1 : -1));
  if (!mine.length) return;
  addEvent(publish(KIND_STROKE, [["undo", mine[0].id]], ""));
});

// ---- Clear (call from the browser console) -------------------------------
window.clearBoard = function () {
  addEvent(publish(KIND_STROKE, [["clear", "1"]], ""));
  console.log("Board cleared.");
};
console.info("Whiteboard: run clearBoard() in this console to clear the board for everyone.");
