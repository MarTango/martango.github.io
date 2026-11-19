// Chatroom over public Nostr relays (websockets, no account or server needed).
// Each message is a signed kind-1 event tagged with SITE. Relays store events
// for their own retention period; we only ask for the last 30 days.
//
// To clear history: set CLEARED_AT to the current unix time (seconds), e.g.
// `date +%s`. Older events remain on the relays but are no longer shown.
const SITE = "martango.github.io";
const CLEARED_AT = 0;
const RELAYS = ["wss://relay.damus.io", "wss://nos.lol", "wss://relay.primal.net"];
const TTL_S = 30 * 24 * 60 * 60;
const MAX_SHOWN = 50;
const MAX_LEN = 500;

const { generateSecretKey, getPublicKey, finalizeEvent, verifyEvent } = NostrTools;

// Throwaway identity, kept in this browser.
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

// Username derived from the pubkey: stable per device, and unspoofable since
// the pubkey is verified by the event signature.
const ADJ = ["swift", "calm", "brave", "witty", "sunny", "quiet", "bold", "lucky", "keen", "mellow", "plucky", "zesty", "gentle", "jolly", "nimble", "clever"];
const NOUN = ["otter", "falcon", "panda", "maple", "comet", "badger", "heron", "lynx", "willow", "fox", "koala", "raven", "cedar", "gecko", "tiger", "moose"];
function nameFor(pubkey) {
  const b = (i) => parseInt(pubkey.slice(i * 2, i * 2 + 2), 16);
  return ADJ[b(0) & 15] + "-" + NOUN[b(1) & 15] + "-" + pubkey.slice(4, 8);
}

const ul = document.querySelector("ul");
const msgInput = document.querySelector("input#msg");

const sinceTime = () => Math.max(Math.floor(Date.now() / 1000) - TTL_S, CLEARED_AT);

const seen = new Map(); // event id -> event
function render() {
  const cutoff = sinceTime();
  const events = [...seen.values()]
    .filter((e) => e.created_at >= cutoff)
    .sort((a, b) => a.created_at - b.created_at)
    .slice(-MAX_SHOWN);
  ul.replaceChildren(
    ...events.map((e) => {
      const li = document.createElement("li");
      const name = document.createElement("strong");
      name.textContent = nameFor(e.pubkey);
      li.append(name, ": " + e.content);
      return li;
    })
  );
}

function addEvent(ev) {
  if (seen.has(ev.id)) return;
  if (!ev.tags.some((t) => t[0] === "t" && t[1] === SITE)) return;
  if (typeof ev.content !== "string" || ev.content.length > MAX_LEN) return;
  if (!verifyEvent(ev)) return;
  seen.set(ev.id, ev);
  render();
}

const sockets = [];
function connect(url) {
  const ws = new WebSocket(url);
  ws.onopen = () => {
    ws.send(
      JSON.stringify([
        "REQ",
        "chat",
        {
          kinds: [1],
          "#t": [SITE],
          since: sinceTime(),
          limit: MAX_SHOWN,
        },
      ])
    );
  };
  ws.onmessage = (m) => {
    try {
      const data = JSON.parse(m.data);
      if (data[0] === "EVENT" && data[1] === "chat") addEvent(data[2]);
    } catch (e) {}
  };
  ws.onclose = () => setTimeout(() => connect(url), 5000);
  ws.onerror = () => ws.close();
  sockets.push(ws);
}
RELAYS.forEach(connect);

document.querySelector("form").addEventListener("submit", function (e) {
  e.preventDefault();
  const text = msgInput.value.trim().slice(0, MAX_LEN);
  if (!text) return;
  const ev = finalizeEvent(
    {
      kind: 1,
      created_at: Math.floor(Date.now() / 1000),
      tags: [["t", SITE]],
      content: text,
    },
    secretKey
  );
  const payload = JSON.stringify(["EVENT", ev]);
  sockets.forEach((ws) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(payload);
  });
  addEvent(ev);
  msgInput.value = "";
});
