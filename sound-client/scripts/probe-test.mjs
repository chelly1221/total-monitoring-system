// Dependency-free tester for the Sound Client Discovery Protocol (v1).
//
//   node scripts/probe-test.mjs                      broadcast a probe, print `here` replies for 2 s
//   node scripts/probe-test.mjs identify <ip> [sec]  send identify to a client, print the ack
//   node scripts/probe-test.mjs config <ip> <serverIp> <port> [name]   push a target (on=SOUND/off=SILENCE)
//
import dgram from "node:dgram";
import { randomBytes } from "node:crypto";

const PORT = Number(process.env.PORT || 7790);
const [mode = "probe", ...rest] = process.argv.slice(2);

function nonce() {
  return randomBytes(8).toString("hex");
}

function command(t, extra = {}) {
  const n = nonce();
  const msg = { v: 1, t, nonce: n, ...extra };
  return msg;
}

function open() {
  const sock = dgram.createSocket({ type: "udp4", reuseAddr: true });
  return new Promise((resolve) => sock.bind(0, () => resolve(sock)));
}

function send(sock, msg, host) {
  const buf = Buffer.from(JSON.stringify(msg), "utf8");
  return new Promise((resolve, reject) =>
    sock.send(buf, PORT, host, (err) => (err ? reject(err) : resolve())),
  );
}

async function probe() {
  const sock = await open();
  sock.setBroadcast(true);
  const msg = command("probe");
  const seen = new Map();
  sock.on("message", (data, rinfo) => {
    try {
      const reply = JSON.parse(data.toString("utf8"));
      if (reply.v !== 1 || reply.t !== "here") return;
      const ok = reply.nonce === msg.nonce;
      if (!seen.has(reply.id)) {
        seen.set(reply.id, reply);
        console.log(`here from ${rinfo.address}:${rinfo.port} nonce=${ok ? "match" : "MISMATCH"}`);
        console.log(JSON.stringify(reply, null, 2));
      }
    } catch {
      /* ignore non-JSON */
    }
  });
  console.log(`probe -> 255.255.255.255:${PORT} nonce=${msg.nonce}`);
  await send(sock, msg, "255.255.255.255");
  await new Promise((r) => setTimeout(r, 300));
  await send(sock, msg, "255.255.255.255"); // second probe, like the server
  await new Promise((r) => setTimeout(r, 2000));
  console.log(`${seen.size} client(s) replied`);
  sock.close();
  process.exitCode = seen.size > 0 ? 0 : 1;
}

async function sendCommand(ip, msg) {
  const sock = await open();
  const done = new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), 3000);
    sock.on("message", (data, rinfo) => {
      try {
        const reply = JSON.parse(data.toString("utf8"));
        if (reply.t === "ack" && reply.nonce === msg.nonce) {
          clearTimeout(timer);
          resolve({ reply, rinfo });
        }
      } catch {
        /* ignore */
      }
    });
  });
  console.log(`${msg.t} -> ${ip}:${PORT}`, JSON.stringify(msg));
  await send(sock, msg, ip);
  const res = await done;
  sock.close();
  if (!res) {
    console.log("no ack within 3 s");
    process.exitCode = 1;
    return;
  }
  console.log(`ack from ${res.rinfo.address}:${res.rinfo.port}`, JSON.stringify(res.reply));
  process.exitCode = res.reply.ok ? 0 : 2;
}

if (mode === "probe") {
  await probe();
} else if (mode === "identify") {
  const [ip, sec = "5"] = rest;
  if (!ip) throw new Error("usage: identify <ip> [sec]");
  await sendCommand(ip, command("identify", { sec: Number(sec) }));
} else if (mode === "config") {
  const [ip, serverIp, port, name] = rest;
  if (!ip || !serverIp || !port) throw new Error("usage: config <ip> <serverIp> <port> [name]");
  const extra = { target: { ip: serverIp, port: Number(port) }, on: "SOUND", off: "SILENCE", intervalMs: 5000 };
  if (name) extra.name = name;
  await sendCommand(ip, command("config", extra));
} else {
  throw new Error(`unknown mode ${mode}`);
}
