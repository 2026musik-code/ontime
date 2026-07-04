import { useState, useEffect } from 'react';
import { Copy, CheckCircle2, Server, Smartphone, Globe, Shield, Link2 } from 'lucide-react';

export default function App() {
  const [localPort, setLocalPort] = useState('8080');
  const [authToken, setAuthToken] = useState(Math.random().toString(36).substring(2, 15));
  const [workerUrl, setWorkerUrl] = useState('');
  const [copiedWorker, setCopiedWorker] = useState(false);
  const [copiedTermux, setCopiedTermux] = useState(false);
  const [originUrl, setOriginUrl] = useState('https://YOUR_WORKER_URL.workers.dev');

  useEffect(() => {
    if (typeof window !== 'undefined') {
      setOriginUrl(window.location.origin);
    }
  }, []);

  const displayUrl = workerUrl.trim() ? (workerUrl.startsWith('http') ? workerUrl : `https://${workerUrl}`) : 'https://YOUR_WORKER.workers.dev';
  const cleanUrl = displayUrl.replace(/\/$/, '');
  const installCmd = `curl -sL ${cleanUrl}/setup | bash`;

  const workerCode = `let tunnelWs = null;
const pendingRequests = new Map();

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const AUTH_TOKEN = "${authToken}";
    const LOCAL_PORT = ${localPort};
    
    // 1. Endpoint instalasi otomatis untuk Termux
    if (url.pathname === '/setup') {
      const script = \`#!/bin/bash
echo -e "\\\\e[1;34m[+]===============================================[+]\\\\e[0m"
echo -e "\\\\e[1;34m |      ONTIME TERMUX TUNNEL INSTALLER           |\\\\e[0m"
echo -e "\\\\e[1;34m[+]===============================================[+]\\\\e[0m"
echo -e "\\\\e[1;32m[+] Menyiapkan Tunnel Localhost ke Cloudflare Worker...\\\\e[0m"

pkg update -y > /dev/null 2>&1
pkg install nodejs -y > /dev/null 2>&1

mkdir -p ~/.termux_tunnel
cd ~/.termux_tunnel

if [ ! -f package.json ]; then
  npm init -y > /dev/null 2>&1
fi
npm install ws > /dev/null 2>&1

cat << 'EOF' > ~/.termux_tunnel/tunnel.js
const WebSocket = require('ws');
const http = require('http');

const WORKER_URL = '\${url.origin}';
const WS_URL = WORKER_URL.replace('http', 'ws') + '/_ws';
const AUTH_TOKEN = '\${AUTH_TOKEN}';
const LOCAL_PORT = \${LOCAL_PORT};

function connect() {
  console.log('[*] Menghubungkan ke ' + WS_URL);
  const ws = new WebSocket(WS_URL, {
    headers: { 'Authorization': 'Bearer ' + AUTH_TOKEN }
  });

  ws.on('open', () => {
    console.log('\\\\x1b[32m[+] Tunnel terhubung! Publik URL Anda:\\\\x1b[0m ' + WORKER_URL);
    console.log('\\\\x1b[36m[*] Meneruskan traffic publik ke localhost:\\\\x1b[0m' + LOCAL_PORT);
  });

  ws.on('message', async (data) => {
    try {
      const reqData = JSON.parse(data.toString());
      
      const options = {
        hostname: '127.0.0.1',
        port: LOCAL_PORT,
        path: new URL(reqData.url).pathname + new URL(reqData.url).search,
        method: reqData.method,
        headers: reqData.headers
      };

      delete options.headers['host']; // Prevent host conflict

      const proxyReq = http.request(options, (proxyRes) => {
        let chunks = [];
        proxyRes.on('data', chunk => chunks.push(chunk));
        proxyRes.on('end', () => {
          const bodyBuffer = Buffer.concat(chunks);
          ws.send(JSON.stringify({
            id: reqData.id,
            status: proxyRes.statusCode,
            headers: proxyRes.headers,
            body: bodyBuffer.toString('base64')
          }));
        });
      });

      proxyReq.on('error', (err) => {
        ws.send(JSON.stringify({
          id: reqData.id,
          status: 502,
          headers: { 'Content-Type': 'text/plain' },
          body: Buffer.from('Bad Gateway: Local server error - ' + err.message).toString('base64')
        }));
      });

      if (reqData.body) {
        proxyReq.write(Buffer.from(reqData.body, 'base64'));
      }
      proxyReq.end();
      
    } catch(e) {
      console.error('[-] Error handling message:', e.message);
    }
  });

  ws.on('close', () => {
    console.log('[-] Koneksi terputus. Mencoba menyambung kembali dalam 5 detik...');
    setTimeout(connect, 5000);
  });
  
  ws.on('error', (err) => {
    console.error('[!] WebSocket Error:', err.message);
  });
}

connect();
EOF

# Menambahkan ke .bashrc agar otomatis jalan saat Termux dibuka
if ! grep -q ".termux_tunnel/tunnel.js" ~/.bashrc; then
  echo "cd ~/.termux_tunnel && node tunnel.js &" >> ~/.bashrc
  echo -e "\\\\e[1;32m[+] Berhasil ditambahkan ke .bashrc\\\\e[0m"
fi

echo -e "\\\\e[1;32m[+] Instalasi Selesai! Menjalankan tunnel sekarang...\\\\e[0m"
cd ~/.termux_tunnel && node tunnel.js
\`;
      return new Response(script, {
        headers: { 
          "Content-Type": "text/plain;charset=UTF-8",
          "Cache-Control": "no-store"
        },
      });
    }

    // 2. Endpoint WebSocket untuk Termux Tunnel Client
    if (url.pathname === '/_ws') {
      if (request.headers.get("Authorization") !== \`Bearer \${AUTH_TOKEN}\`) {
        return new Response("Unauthorized", { status: 401 });
      }
      if (request.headers.get("Upgrade") !== "websocket") {
        return new Response("Expected WebSocket", { status: 426 });
      }

      const webSocketPair = new WebSocketPair();
      const client = webSocketPair[0];
      const server = webSocketPair[1];
      server.accept();
      
      tunnelWs = server;
      server.addEventListener('message', event => {
        try {
          const data = JSON.parse(event.data);
          if (data.id && pendingRequests.has(data.id)) {
            pendingRequests.get(data.id)(data);
          }
        } catch (e) {}
      });
      
      server.addEventListener('close', () => {
        if (tunnelWs === server) tunnelWs = null;
      });

      return new Response(null, { status: 101, webSocket: client });
    }

    // 3. Routing Request Publik ke Localhost Termux
    if (!tunnelWs) {
      return new Response(
        "<h1>502 Bad Gateway</h1><p>Tunnel dari Termux belum terhubung, atau terhubung ke node Cloudflare yang berbeda.</p><p>Pastikan script di Termux sedang berjalan, dan Worker URL sudah benar.</p>", 
        { status: 502, headers: { "Content-Type": "text/html" } }
      );
    }

    const reqId = crypto.randomUUID();
    let reqBodyBase64 = null;
    
    if (request.body) {
      const buffer = await request.arrayBuffer();
      let binary = '';
      const bytes = new Uint8Array(buffer);
      for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      reqBodyBase64 = btoa(binary);
    }

    const reqData = {
      id: reqId,
      method: request.method,
      url: request.url,
      headers: Object.fromEntries(request.headers.entries()),
      body: reqBodyBase64
    };

    const responsePromise = new Promise(resolve => {
      pendingRequests.set(reqId, resolve);
      setTimeout(() => {
        if (pendingRequests.has(reqId)) {
          pendingRequests.delete(reqId);
          resolve({ status: 504, headers: { "Content-Type": "text/plain" }, body: btoa("Gateway Timeout: Termux did not respond in 30s.") });
        }
      }, 30000);
    });

    try {
      tunnelWs.send(JSON.stringify(reqData));
    } catch (e) {
      return new Response("Failed to send request to tunnel", { status: 502 });
    }

    const resData = await responsePromise;
    pendingRequests.delete(reqId);

    let resBody = null;
    if (resData.body) {
      const binaryString = atob(resData.body);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      resBody = bytes;
    }

    return new Response(resBody, {
      status: resData.status,
      headers: resData.headers
    });
  },
};`;

  const handleCopy = (text: string, setter: (val: boolean) => void) => {
    navigator.clipboard.writeText(text);
    setter(true);
    setTimeout(() => setter(false), 2000);
  };

  return (
    <div className="h-screen w-full bg-slate-950 text-slate-200 font-sans flex flex-col overflow-hidden select-none">
      {/* Header Section */}
      <header className="h-16 border-b border-slate-800 px-4 md:px-6 flex items-center justify-between bg-slate-900/50 shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-emerald-500 rounded flex items-center justify-center shrink-0">
            <span className="text-slate-950 font-bold text-xs font-mono">ON</span>
          </div>
          <h1 className="text-base md:text-lg font-semibold tracking-tight text-white uppercase">
            Ontime.Tunnel <span className="text-slate-500 font-normal">v3.0.0</span>
          </h1>
        </div>
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)] animate-pulse"></div>
            <span className="text-xs font-mono uppercase tracking-widest text-emerald-400 hidden sm:inline-block">Bridge Ready</span>
          </div>
          <div className="h-8 w-px bg-slate-800 hidden sm:block"></div>
          <div className="text-xs font-mono text-slate-400 hidden md:block">MODE: REVERSE PROXY</div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 flex flex-col lg:flex-row p-4 md:p-6 gap-6 overflow-y-auto lg:overflow-hidden">
        {/* Left Column: Config */}
        <div className="lg:w-1/3 flex flex-col gap-6 lg:overflow-y-auto">
          <section className="bg-slate-900 border border-slate-800 rounded-lg p-5 flex flex-col gap-4">
            <h2 className="text-xs font-bold uppercase tracking-widest text-slate-500 flex items-center gap-2">
              <Globe className="w-4 h-4" />
              Tunnel Configuration
            </h2>
            <div className="flex flex-col gap-4">
              <div>
                <label className="block text-[10px] text-slate-500 uppercase mb-1 font-mono">Localhost Port (Termux)</label>
                <div className="flex items-center bg-slate-950 border border-slate-700 rounded overflow-hidden">
                  <span className="px-3 text-slate-500 font-mono text-sm border-r border-slate-700">PORT</span>
                  <input
                    type="number"
                    value={localPort}
                    onChange={(e) => setLocalPort(e.target.value)}
                    className="w-full bg-transparent p-2 font-mono text-sm text-emerald-400 outline-none"
                    placeholder="8080"
                  />
                </div>
              </div>
              <div>
                <label className="block text-[10px] text-slate-500 uppercase mb-1 font-mono">Security Token</label>
                <div className="flex items-center bg-slate-950 border border-slate-700 rounded overflow-hidden">
                  <span className="px-3 text-slate-500 font-mono border-r border-slate-700"><Shield className="w-4 h-4" /></span>
                  <input
                    type="text"
                    value={authToken}
                    onChange={(e) => setAuthToken(e.target.value)}
                    className="w-full bg-transparent p-2 font-mono text-sm text-emerald-400 outline-none"
                    placeholder="Secret Token"
                  />
                </div>
              </div>
              <div className="pt-2 border-t border-slate-800">
                <label className="block text-[10px] text-slate-500 uppercase mb-1 font-mono">1. Deploy & Paste Worker URL</label>
                <div className="flex items-center bg-slate-950 border border-slate-700 rounded overflow-hidden">
                  <span className="px-3 text-slate-500 font-mono border-r border-slate-700"><Link2 className="w-4 h-4" /></span>
                  <input
                    type="text"
                    value={workerUrl}
                    onChange={(e) => setWorkerUrl(e.target.value)}
                    className="w-full bg-transparent p-2 font-mono text-sm text-emerald-400 outline-none"
                    placeholder="https://my-tunnel.workers.dev"
                  />
                </div>
                <p className="text-[10px] text-slate-500 leading-relaxed mt-2">
                  Masukkan URL Worker Cloudflare yang telah di-deploy untuk men-generate script instalasi Termux di bawah ini.
                </p>
              </div>
            </div>
            <p className="text-[10px] text-slate-500 leading-relaxed mt-2">
              Konfigurasi ini akan menghasilkan Worker yang mem-forward trafik publik ke port <b>{localPort}</b> di dalam Termux Anda melalui koneksi WebSocket yang aman.
            </p>
          </section>

          <section className="bg-slate-900 border border-slate-800 rounded-lg p-5 flex flex-col gap-3 shrink-0">
            <h2 className="text-xs font-bold uppercase tracking-widest text-slate-500 flex items-center gap-2">
              <Smartphone className="w-4 h-4" />
              2. Auto-Install di Termux
            </h2>
            <div className="bg-slate-950 rounded-md p-4 font-mono text-xs border border-emerald-500/30 leading-relaxed overflow-hidden relative group">
              <span className="text-emerald-500 block break-all pr-8">
                {installCmd}
              </span>
              <button
                onClick={() => handleCopy(installCmd, setCopiedTermux)}
                className="absolute right-2 top-2 w-7 h-7 flex items-center justify-center bg-slate-800 hover:bg-slate-700 text-slate-300 rounded transition-colors"
                title="Copy Termux Command"
              >
                {copiedTermux ? <CheckCircle2 className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
              </button>
            </div>
            <p className="text-[10px] text-slate-500 italic">
              Copy perintah di atas dan jalankan di Termux. Script akan otomatis masuk ke .bashrc.
            </p>
          </section>
        </div>

        {/* Right Column: Terminal/Logs */}
        <div className="flex-1 flex flex-col bg-slate-900 border border-slate-800 rounded-lg overflow-hidden shadow-2xl min-h-[400px]">
          <div className="h-10 bg-slate-800/50 flex items-center justify-between px-4 border-b border-slate-800 shrink-0">
            <div className="flex gap-1.5">
              <div className="w-2.5 h-2.5 rounded-full bg-red-500/50"></div>
              <div className="w-2.5 h-2.5 rounded-full bg-yellow-500/50"></div>
              <div className="w-2.5 h-2.5 rounded-full bg-emerald-500/50"></div>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-[10px] font-mono text-slate-400 uppercase tracking-widest flex items-center gap-2">
                <Server className="w-3.5 h-3.5" /> _worker.js
              </span>
              <button
                onClick={() => handleCopy(workerCode, setCopiedWorker)}
                className="flex items-center gap-1.5 text-[10px] font-mono bg-slate-800 hover:bg-emerald-900/50 text-emerald-400 border border-emerald-500/30 px-3 py-1 rounded transition-colors uppercase tracking-widest"
              >
                {copiedWorker ? <CheckCircle2 className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                {copiedWorker ? 'Copied' : 'Copy Worker Code'}
              </button>
            </div>
          </div>
          <div className="flex-1 p-4 font-mono text-xs leading-relaxed overflow-y-auto bg-slate-950">
            <pre className="text-slate-300 whitespace-pre-wrap break-all">
              <code>{workerCode}</code>
            </pre>
          </div>
          
          {/* Stats Row */}
          <div className="h-16 bg-slate-950 border-t border-slate-800 grid grid-cols-4 divide-x divide-slate-800 shrink-0">
            <div className="flex flex-col items-center justify-center">
              <span className="text-[9px] text-slate-500 uppercase">Architecture</span>
              <span className="text-xs md:text-sm font-bold text-white">Reverse Proxy</span>
            </div>
            <div className="flex flex-col items-center justify-center">
              <span className="text-[9px] text-slate-500 uppercase">Protocol</span>
              <span className="text-xs md:text-sm font-bold text-white">WSS / HTTP</span>
            </div>
            <div className="flex flex-col items-center justify-center">
              <span className="text-[9px] text-slate-500 uppercase">Auth Mode</span>
              <span className="text-xs md:text-sm font-bold text-white">Bearer Token</span>
            </div>
            <div className="flex flex-col items-center justify-center">
              <span className="text-[9px] text-slate-500 uppercase">Auto Start</span>
              <span className="text-xs md:text-sm font-bold text-emerald-400 uppercase">.bashrc</span>
            </div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="h-10 px-4 md:px-6 border-t border-slate-800 flex items-center justify-between text-[10px] font-mono text-slate-500 shrink-0">
        <div className="flex gap-4 uppercase hidden md:flex">
          <span>Env: Production</span>
          <span>Node: cf-edge-sea-09</span>
        </div>
        <div className="flex gap-4 items-center w-full justify-between md:w-auto">
          <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-slate-600"></span> WebSocket: Supported</span>
          <span className="text-slate-400">© 2024 ONTIME LABS</span>
        </div>
      </footer>
    </div>
  );
}
