import { useState } from 'react';
import { Terminal, Copy, CheckCircle2, Server, Smartphone, Code2 } from 'lucide-react';

export default function App() {
  const [bashScript, setBashScript] = useState<string>(
    '# Tampilkan pesan selamat datang\necho -e "\\e[1;32mWelcome to Termux!\\e[0m"\n\n# Update package secara otomatis (opsional)\n# pkg update -y\n\n# Jalankan script atau aplikasi lain\n# python3 main.py'
  );

  const [copiedWorker, setCopiedWorker] = useState(false);
  const [copiedTermux, setCopiedTermux] = useState(false);

  const workerCode = `export default {
  async fetch(request, env, ctx) {
    const script = \`#!/bin/bash
${bashScript.replace(/`/g, '\\`')}
\`;
    return new Response(script, {
      headers: {
        "Content-Type": "text/plain;charset=UTF-8",
        "Cache-Control": "no-store"
      },
    });
  },
};`;

  const termuxCommand = `echo 'curl -sL https://YOUR_WORKER_URL.workers.dev | bash' >> ~/.bashrc`;

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
            Ontime.Termux <span className="text-slate-500 font-normal">v2.4.0</span>
          </h1>
        </div>
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]"></div>
            <span className="text-xs font-mono uppercase tracking-widest text-emerald-400 hidden sm:inline-block">Worker: Active</span>
          </div>
          <div className="h-8 w-px bg-slate-800 hidden sm:block"></div>
          <div className="text-xs font-mono text-slate-400 hidden md:block">REGION: LOCAL</div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 flex flex-col lg:flex-row p-4 md:p-6 gap-6 overflow-y-auto lg:overflow-hidden">
        {/* Left Column: Config */}
        <div className="lg:w-1/3 flex flex-col gap-6 lg:overflow-y-auto">
          <section className="bg-slate-900 border border-slate-800 rounded-lg p-5 flex flex-col gap-4">
            <h2 className="text-xs font-bold uppercase tracking-widest text-slate-500 flex items-center gap-2">
              <Code2 className="w-4 h-4" />
              Execution Policy
            </h2>
            <div className="flex-1 min-h-[200px] flex flex-col">
              <label className="block text-[10px] text-slate-500 uppercase mb-1 font-mono">Bash Script Payload</label>
              <textarea
                value={bashScript}
                onChange={(e) => setBashScript(e.target.value)}
                className="w-full flex-1 min-h-[160px] bg-slate-950 border border-slate-700 rounded p-3 font-mono text-xs md:text-sm text-emerald-400 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 outline-none resize-y lg:resize-none"
                placeholder="echo 'Hello World'"
                spellCheck={false}
              />
            </div>
          </section>

          <section className="bg-slate-900 border border-slate-800 rounded-lg p-5 flex flex-col gap-3 shrink-0">
            <h2 className="text-xs font-bold uppercase tracking-widest text-slate-500 flex items-center gap-2">
              <Smartphone className="w-4 h-4" />
              Quick Installation
            </h2>
            <div className="bg-slate-950 rounded-md p-4 font-mono text-xs border border-emerald-500/30 leading-relaxed overflow-hidden relative group">
              <span className="text-emerald-500 block break-all pr-8">{termuxCommand}</span>
              <button
                onClick={() => handleCopy(termuxCommand, setCopiedTermux)}
                className="absolute right-2 top-2 w-7 h-7 flex items-center justify-center bg-slate-800 hover:bg-slate-700 text-slate-300 rounded transition-colors"
                title="Copy Termux Command"
              >
                {copiedTermux ? <CheckCircle2 className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
              </button>
            </div>
            <p className="text-[10px] text-slate-500 italic">
              Run this command inside Termux to sync startup triggers with this Cloudflare Worker. (Replace URL first)
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
                className="flex items-center gap-1.5 text-[10px] font-mono bg-slate-800 hover:bg-slate-700 text-slate-300 px-2 py-1 rounded transition-colors uppercase tracking-widest"
              >
                {copiedWorker ? <CheckCircle2 className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                {copiedWorker ? 'Copied' : 'Copy'}
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
              <span className="text-[9px] text-slate-500 uppercase">Payload</span>
              <span className="text-xs md:text-lg font-bold text-white">{workerCode.length} B</span>
            </div>
            <div className="flex flex-col items-center justify-center">
              <span className="text-[9px] text-slate-500 uppercase">Lines</span>
              <span className="text-xs md:text-lg font-bold text-white">{workerCode.split('\n').length}</span>
            </div>
            <div className="flex flex-col items-center justify-center">
              <span className="text-[9px] text-slate-500 uppercase">Format</span>
              <span className="text-xs md:text-lg font-bold text-white">ESM</span>
            </div>
            <div className="flex flex-col items-center justify-center">
              <span className="text-[9px] text-slate-500 uppercase">Status</span>
              <span className="text-xs md:text-lg font-bold text-emerald-400 uppercase">Ready</span>
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
          <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-slate-600"></span> Storage: OK</span>
          <span className="text-slate-400">© 2024 ONTIME LABS</span>
        </div>
      </footer>
    </div>
  );
}
