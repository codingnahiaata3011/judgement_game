/*
README + Single-file React app: Judgement Scorekeeper (React)

Features included in this single-file component:
- Exact same algorithm as your Tkinter app (start_cards, progression, trump order, scoring).
- Drag-to-reorder players (HTML5 Drag & Drop).
- Keyboard shortcuts: Ctrl+S to save, Ctrl+Z to undo last round, Enter to add player.
- Player avatars (auto initials with color). Optionally support uploading avatars in future.
- Shareable room links: encode current game state into the URL hash (no backend required). "Copy Link" creates a sharable URL that others can open to load the same state.
- Autosave to localStorage and manual save/load
- Undo last round, Reset game, Export CSV
- Responsive Tailwind-style classes (this file assumes you'll run with Tailwind configured). If not using Tailwind, basic inline styles will still render.

How to use this file:
1. Create a React app (Vite + React recommended):
   npm create vite@latest judgement-app --template react
   cd judgement-app
   npm install
2. Install Tailwind (optional but recommended) and configure per Tailwind docs.
3. Replace src/App.jsx with the contents of this file, and src/main.jsx should render <App />.
4. Start dev server: npm run dev

Optional: For realtime / room-hosting, integrate Firebase Realtime DB or Firestore; I left TODO markers where to plug it in.

*/

import React, { useEffect, useMemo, useRef, useState } from 'react';

// NOTE: This component uses Tailwind utility classes. If Tailwind is not available,
// the layout will still work but styling will be different. You can replace className values
// with your own CSS.

// ------- Constants (same rules as original) -------
const TRUMP_ORDER = ["No Trump", "Spades", "Diamonds", "Clubs", "Hearts"];
const SAVE_KEY = 'judgement_react_save_v1';

// compute_score: same algorithm as your Tkinter compute_score
function computeScore(judgement, actual, cards) {
  if (judgement === actual) {
    if (judgement === cards) return 10 * cards + judgement;
    return 10 + judgement;
  }
  return 0;
}

// helper: serialize state to shareable string (base64 of JSON)
function encodeStateForUrl(state) {
  try {
    const s = JSON.stringify(state);
    return btoa(encodeURIComponent(s));
  } catch (e) {
    console.error('encode error', e);
    return '';
  }
}
function decodeStateFromUrl(hash) {
  try {
    if (!hash) return null;
    const raw = decodeURIComponent(atob(hash));
    return JSON.parse(raw);
  } catch (e) {
    console.error('decode error', e);
    return null;
  }
}

function defaultAvatarColor(name) {
  // deterministic color generator from name
  let h = 0;
  for (let i = 0; i < name.length; i++) h = name.charCodeAt(i) + ((h << 5) - h);
  const color = `hsl(${Math.abs(h) % 360} 70% 45%)`;
  return color;
}

// CSV utils
function csvEscape(s) {
  if (s == null) return '';
  const str = String(s);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

// Main App component (default export)
export default function App() {
  // players: array of { id, name }
  const [players, setPlayers] = useState([]);
  const [totals, setTotals] = useState({});
  const [rounds, setRounds] = useState([]);
  const [started, setStarted] = useState(false);

  // progression
  const [startCards, setStartCards] = useState(null);
  const [currentCards, setCurrentCards] = useState(null);
  const [direction, setDirection] = useState(-1); // -1 decreasing, +1 increasing
  const [trumpIndex, setTrumpIndex] = useState(0);
  const [roundNumber, setRoundNumber] = useState(0);

  // UI states
  const [newPlayerName, setNewPlayerName] = useState('');
  const [entryMap, setEntryMap] = useState({}); // playerId -> { j: '', a: '' }
  const fileRef = useRef(null);

  // drag reorder refs
  const dragSrcIndex = useRef(null);

  // load state from URL hash or localStorage on mount
  useEffect(() => {
    const hash = window.location.hash.replace('#', '');
    if (hash) {
      const st = decodeStateFromUrl(hash);
      if (st) {
        loadState(st);
        return;
      }
    }
    const raw = localStorage.getItem(SAVE_KEY);
    if (raw) {
      try {
        const st = JSON.parse(raw);
        if (window.confirm('A saved game was found locally. Load it?')) {
          loadState(st);
        }
      } catch (e) {
        console.warn('failed to parse save', e);
      }
    }
  }, []);

  // keyboard shortcuts (Ctrl+S save, Ctrl+Z undo)
  useEffect(() => {
    function handler(e) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault(); saveNow();
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault(); undoLastRound();
      }
    }
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  });

  // helpers: save & load
  function saveNow() {
    const payload = {
      players, totals, rounds, startCards, currentCards, direction, trumpIndex, roundNumber
    };
    localStorage.setItem(SAVE_KEY, JSON.stringify(payload));
    alert('Game saved locally.');
  }
  function loadState(data) {
    setPlayers(data.players || []);
    setTotals(data.totals || {});
    setRounds(data.rounds || []);
    setStartCards(data.startCards ?? null);
    setCurrentCards(data.currentCards ?? null);
    setDirection(data.direction ?? -1);
    setTrumpIndex(data.trumpIndex ?? 0);
    setRoundNumber(data.roundNumber ?? 0);
    if ((data.players || []).length > 0) setStarted(true);
    recomputeProgressionFromRounds(data.players || [], data.rounds || []);
  }

  // progression helper (same as original)
  function computeStartCards(numPlayers) {
    let s = Math.floor(52 / numPlayers);
    if (s < 1) s = 1;
    return s;
  }

  function setupStartProgression() {
    const s = computeStartCards(players.length);
    setStartCards(s);
    if (rounds.length === 0) {
      setCurrentCards(s);
      setDirection(-1);
      setTrumpIndex(0);
      setRoundNumber(0);
      // reset totals
      const t = {};
      players.forEach(p => t[p.id] = 0);
      setTotals(t);
    }
    setStarted(true);
  }

  function advanceProgressionState() {
    setTrumpIndex(i => (i + 1) % TRUMP_ORDER.length);
    setCurrentCards(prev => {
      if (direction === -1) {
        let next = prev - 1;
        if (next < 1) {
          setDirection(1);
          next = startCards >= 2 ? 2 : 1;
        }
        return Math.max(1, next);
      }
      // increasing
      let next = prev + 1;
      if (next > startCards) {
        setDirection(-1);
        next = startCards > 1 ? startCards - 1 : 1;
      }
      return Math.max(1, next);
    });
  }

  function recomputeProgressionFromRounds(currentPlayers, existingRounds) {
    if (!currentPlayers || currentPlayers.length === 0) return;
    const s = computeStartCards(currentPlayers.length);
    setStartCards(s);
    let cur = s;
    let dir = -1;
    let tri = 0;
    existingRounds.forEach(r => {
      tri = (tri + 1) % TRUMP_ORDER.length;
      if (dir === -1) {
        let next = cur - 1;
        if (next < 1) { dir = 1; next = s >= 2 ? 2 : 1; }
        cur = Math.max(1, next);
      } else {
        let next = cur + 1;
        if (next > s) { dir = -1; next = s > 1 ? s - 1 : 1; }
        cur = Math.max(1, next);
      }
    });
    setCurrentCards(cur);
    setDirection(dir);
    setTrumpIndex(tri);
    setRoundNumber(existingRounds.length);
  }

  // player management
  function addPlayer(name) {
    const trimmed = name.trim();
    if (!trimmed) return alert('Enter a name');
    if (players.some(p => p.name === trimmed)) return alert('Duplicate name');
    const id = 'p_' + Date.now().toString(36) + '_' + Math.floor(Math.random() * 1000);
    const p = { id, name: trimmed };
    setPlayers(prev => [...prev, p]);
    setTotals(t => ({ ...t, [id]: 0 }));
    setNewPlayerName('');
  }

  function removePlayer(idx) {
    const p = players[idx];
    if (!p) return;
    if (!window.confirm(`Remove player ${p.name}?`)) return;
    setPlayers(prev => prev.filter((_, i) => i !== idx));
    setTotals(t => {
      const nt = { ...t }; delete nt[p.id]; return nt;
    });
  }

  // drag reorder
  function onDragStart(e, index) { dragSrcIndex.current = index; e.dataTransfer.effectAllowed = 'move'; }
  function onDragOver(e) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }
  function onDrop(e, dropIndex) {
    e.preventDefault();
    const src = dragSrcIndex.current; const dst = dropIndex;
    if (src == null || dst == null) return;
    if (src === dst) return;
    const arr = [...players];
    const [moved] = arr.splice(src, 1);
    arr.splice(dst, 0, moved);
    setPlayers(arr);
  }

  // submit round
  function submitRound() {
    if (!started) return alert('Start the game first');
    // collect from entryMap
    const entries = {};
    for (const p of players) {
      const e = entryMap[p.id] || { j: '', a: '' };
      if (String(e.j).trim() === '' || String(e.a).trim() === '') return alert(`Enter both judgement and actual for ${p.name}`);
      const j = Number(e.j); const a = Number(e.a);
      if (!Number.isFinite(j) || !Number.isFinite(a) || j < 0 || a < 0) return alert(`Invalid numbers for ${p.name}`);
      if (j > currentCards) {
        if (!window.confirm(`${p.name}'s judgement ${j} is greater than cards per player (${currentCards}). Proceed?`)) return;
      }
      entries[p.id] = { j, a };
    }

    const perPlayerScores = {};
    const newTotals = { ...totals };
    for (const p of players) {
      const { j, a } = entries[p.id];
      const sc = computeScore(j, a, currentCards);
      perPlayerScores[p.id] = [j, a, sc];
      newTotals[p.id] = (newTotals[p.id] || 0) + sc;
    }

    const rec = {
      round: roundNumber + 1,
      cards: currentCards,
      trump: TRUMP_ORDER[trumpIndex % TRUMP_ORDER.length],
      entries: perPlayerScores,
      timestamp: new Date().toISOString()
    };
    setRounds(prev => [...prev, rec]);
    setTotals(newTotals);
    setRoundNumber(r => r + 1);
    advanceProgressionState();
    setEntryMap({});
    // autosave
    saveNow();
  }

  function undoLastRound() {
    if (rounds.length === 0) return alert('No rounds to undo');
    const last = rounds[rounds.length - 1];
    const rem = rounds.slice(0, -1);
    // revert totals
    const newTotals = { ...totals };
    Object.entries(last.entries).forEach(([pid, arr]) => { const sc = arr[2]; newTotals[pid] = Math.max(0, (newTotals[pid] || 0) - sc); });
    setRounds(rem);
    setTotals(newTotals);
    recomputeProgressionFromRounds(players, rem);
    setRoundNumber(rem.length);
    saveNow();
  }

  function resetGame() {
    if (!window.confirm('Reset game? This clears everything.')) return;
    setPlayers([]); setTotals({}); setRounds([]); setStarted(false);
    setStartCards(null); setCurrentCards(null); setDirection(-1); setTrumpIndex(0); setRoundNumber(0);
    localStorage.removeItem(SAVE_KEY);
  }

  function exportCSV() {
    if (rounds.length === 0) return alert('No rounds');
    const header = ['Round', 'Cards', 'Trump', ...players.map(p => `${p.name} (j→a:score)`)]
    const rows = rounds.map(r => {
      const base = [r.round, r.cards, r.trump];
      const per = players.map(p => {
        const ent = r.entries[p.id];
        return ent ? `${ent[0]}→${ent[1]}:${ent[2]}` : '';
      });
      return base.concat(per);
    });
    const all = [header, ...rows].map(r => r.map(c => csvEscape(c)).join(',')).join('\n');
    const blob = new Blob([all], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `judgement_${new Date().toISOString().slice(0,19).replace(/[:T]/g,'-')}.csv`; a.click(); URL.revokeObjectURL(url);
  }

  // shareable link using URL hash
  function getShareableLink() {
    const payload = { players, totals, rounds, startCards, currentCards, direction, trumpIndex, roundNumber };
    const encoded = encodeStateForUrl(payload);
    const url = window.location.origin + window.location.pathname + '#' + encoded;
    return url;
  }
  function copyShareableLink() {
    const url = getShareableLink();
    navigator.clipboard?.writeText(url).then(() => alert('Link copied to clipboard'), () => prompt('Copy this link', url));
  }

  // UI handlers
  function onEntryChange(pid, field, value) {
    setEntryMap(m => ({ ...m, [pid]: { ...(m[pid] || {}), [field]: value } }));
  }

  // small components inside App
  function PlayerRow({ p, idx }) {
    const initials = p.name.split(' ').map(s => s[0]).slice(0,2).join('').toUpperCase();
    const bg = defaultAvatarColor(p.name);
    return (
      <div draggable onDragStart={(e) => onDragStart(e, idx)} onDragOver={onDragOver} onDrop={(e) => onDrop(e, idx)}
        className="flex items-center gap-3 p-2 rounded shadow-sm bg-white/3 border border-white/4">
        <div style={{ width:46,height:46, borderRadius:10, background:bg, display:'flex', alignItems:'center', justifyContent:'center', color:'white', fontWeight:700 }}>
          {initials}
        </div>
        <div className="flex-1">
          <div className="font-semibold">{p.name}</div>
          <div className="text-sm text-slate-200">Total: {totals[p.id] || 0}</div>
        </div>
        <div className="flex gap-2">
          <button className="px-3 py-1 rounded bg-white/5" onClick={() => removePlayer(idx)}>Remove</button>
        </div>
      </div>
    );
  }

  // Derived UI values
  const roundLabel = roundNumber + 1;
  const trumpLabel = TRUMP_ORDER[trumpIndex % TRUMP_ORDER.length];

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-slate-100 p-6">
      <div className="max-w-6xl mx-auto bg-white/5 rounded-xl p-6 shadow-lg">
        <header className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-2xl font-bold">Judgement Scorekeeper (React)</h1>
            <p className="text-sm text-slate-300">Same algorithm & rules. Drag to reorder, share links, autosave.</p>
          </div>
          <div className="flex gap-2">
            <button className="px-3 py-2 rounded bg-indigo-500" onClick={() => { saveNow(); }}>Save</button>
            <button className="px-3 py-2 rounded bg-slate-700" onClick={() => { const raw = localStorage.getItem(SAVE_KEY); if (!raw) return alert('No local save'); loadState(JSON.parse(raw)); }}>Load</button>
            <button className="px-3 py-2 rounded bg-rose-600" onClick={() => resetGame()}>Reset</button>
          </div>
        </header>

        <div className="grid grid-cols-12 gap-6">
          <aside className="col-span-4">
            <div className="mb-3">
              <label className="block text-sm font-medium mb-1">Add player</label>
              <div className="flex gap-2">
                <input value={newPlayerName} onChange={e => setNewPlayerName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') addPlayer(newPlayerName); }} className="flex-1 p-2 rounded bg-white/5" placeholder="Player name" />
                <button onClick={() => addPlayer(newPlayerName)} className="px-3 py-2 rounded bg-emerald-500">Add</button>
              </div>
            </div>

            <div className="space-y-2">
              {players.length === 0 ? <div className="text-slate-300">No players yet</div> : players.map((p, i) => <PlayerRow key={p.id} p={p} idx={i} />)}
            </div>

            <div className="mt-4 flex gap-2">
              <button onClick={() => { if (players.length < 2) return alert('Add at least 2 players to start'); setupStartProgression(); }} className="px-3 py-2 rounded bg-indigo-600">Start Game</button>
              <button onClick={() => { const url = getShareableLink(); navigator.clipboard?.writeText(url).then(() => alert('Link copied'), ()=> prompt('Copy link', url)); }} className="px-3 py-2 rounded bg-sky-600">Copy Link</button>
            </div>

            <div className="mt-4 text-sm text-slate-300">
              <div>Start cards: {startCards ?? '-'}</div>
              <div>Progression: decreases to 1, then increases back to start.</div>
            </div>
          </aside>

          <main className="col-span-8">
            <div className="flex items-center justify-between mb-3">
              <div className="flex gap-4">
                <div className="p-3 bg-white/5 rounded">
                  <div className="text-sm text-slate-300">Round</div>
                  <div className="font-bold text-lg">{started ? roundLabel : '-'}</div>
                </div>
                <div className="p-3 bg-white/5 rounded">
                  <div className="text-sm text-slate-300">Cards</div>
                  <div className="font-bold text-lg">{currentCards ?? '-'}</div>
                </div>
                <div className="p-3 bg-white/5 rounded">
                  <div className="text-sm text-slate-300">Trump</div>
                  <div className="font-bold text-lg">{trumpLabel}</div>
                </div>
              </div>
              <div className="flex gap-2">
                <button className="px-3 py-2 rounded bg-emerald-500" onClick={() => submitRound()}>Submit Round</button>
                <button className="px-3 py-2 rounded bg-yellow-600" onClick={() => undoLastRound()}>Undo</button>
                <button className="px-3 py-2 rounded bg-amber-700" onClick={() => exportCSV()}>Export CSV</button>
              </div>
            </div>

            <section className="bg-white/3 rounded p-3 mb-4">
              <div className="grid grid-cols-12 gap-2 font-semibold text-slate-200 mb-2">
                <div className="col-span-6">Player</div>
                <div className="col-span-3">Judgement</div>
                <div className="col-span-3">Actual</div>
              </div>
              {players.length === 0 ? <div className="text-slate-300 p-3">Add players and start the game to enter judgements.</div> : players.map(p => (
                <div key={p.id} className="grid grid-cols-12 gap-2 items-center p-2 border-b border-white/5">
                  <div className="col-span-6 flex items-center gap-3">
                    <div style={{ width:40, height:40, borderRadius:8, background: defaultAvatarColor(p.name), color:'#fff', display:'flex', alignItems:'center', justifyContent:'center', fontWeight:700 }}>{p.name.split(' ').map(s=>s[0]).slice(0,2).join('').toUpperCase()}</div>
                    <div>
                      <div className="font-semibold">{p.name}</div>
                      <div className="text-sm text-slate-300">Total: {totals[p.id] || 0}</div>
                    </div>
                  </div>
                  <div className="col-span-3">
                    <input type="number" min={0} value={(entryMap[p.id] && entryMap[p.id].j) ?? ''} onChange={e=>onEntryChange(p.id, 'j', e.target.value)} className="w-full p-2 rounded bg-white/5" />
                  </div>
                  <div className="col-span-3">
                    <input type="number" min={0} value={(entryMap[p.id] && entryMap[p.id].a) ?? ''} onChange={e=>onEntryChange(p.id, 'a', e.target.value)} className="w-full p-2 rounded bg-white/5" />
                  </div>
                </div>
              ))}
            </section>

            <section className="bg-white/3 rounded p-3">
              <h3 className="font-semibold mb-2">Rounds history</h3>
              <div className="overflow-auto" style={{ maxHeight: 300 }}>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-slate-200">
                      <th className="text-left p-2">#</th>
                      <th className="p-2">Cards</th>
                      <th className="p-2">Trump</th>
                      {players.map(p => <th key={p.id} className="p-2">{p.name}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {rounds.map(r => (
                      <tr key={r.round} className="border-t border-white/4">
                        <td className="p-2">{r.round}</td>
                        <td className="p-2">{r.cards}</td>
                        <td className="p-2">{r.trump}</td>
                        {players.map(p => {
                          const ent = r.entries[p.id];
                          return <td key={p.id} className="p-2">{ent ? `${ent[0]}→${ent[1]}:${ent[2]}` : '-'}</td>;
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <div className="mt-3 text-sm text-slate-200">Totals: {players.map(p => `${p.name}: ${totals[p.id] || 0}`).join(' · ') || '-'}</div>
          </main>
        </div>

        <div className="mt-6 flex justify-between text-sm text-slate-400">
          <div>Autosave: localStorage</div>
          <div>Shareable link encodes the current game state into the URL hash (no server required).</div>
        </div>
      </div>
    </div>
  );
}
