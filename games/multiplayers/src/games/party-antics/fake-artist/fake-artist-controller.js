import { requestWakeLock, vibrate } from '../../../utils/wake-lock.js';
import { escapeHtml, controllerHeader, confirmDialog } from '../../../utils/ui.js';
import { drawStrokes } from './fake-artist-host.js';

export class FakeArtistController {
  constructor(session, container) {
    this.session = session;
    this.container = container;
    this.publicState = null;
    this.privateState = null;
    this.isCardRevealed = false;
    this.myStroke = null; // [[x, y], ...] for the current turn
    this.strokeDone = false;
    this.turnKey = null;

    this.session.on('stateUpdate', (state) => {
      const key = `${state.roundId}-${state.phase}-${state.activePlayerId}-${state.strokes?.length}`;
      const changed = key !== this.turnKey;
      this.turnKey = key;
      this.publicState = state;
      if (!changed && this.container.querySelector('#mobileCanvas')) return; // don't wipe a stroke in progress
      if (changed) {
        this.myStroke = null;
        this.strokeDone = false;
        if (state.phase === 'DRAWING' && state.activePlayerId === this.session.playerId) vibrate([80, 40, 80]);
      }
      this.render();
    });

    this.session.on('privatePayload', (data) => {
      if (this.privateState?.roundId !== data.roundId) {
        this.isCardRevealed = false;
        vibrate([80, 40, 80]);
        requestWakeLock();
      }
      this.privateState = data;
      this.render();
    });
  }

  shell(right, inner) {
    this.container.innerHTML = `
      <div class="controller-screen">
        ${controllerHeader(this.session, right)}
        <div class="controller-body">${inner}</div>
      </div>
    `;
  }

  render() {
    if (!this.container) return;
    const s = this.publicState;
    const inRound = s && (s.turnOrder || []).includes(this.session.playerId);

    if (!s || s.phase === 'SETUP') {
      this.shell('', `<div class="glass-card lobby-wait-card"><h2>🎨 Fake Artist</h2><p class="subtitle">Get your drawing finger ready. The host is picking the word pack!</p></div>`);
    } else if (!inRound || !this.privateState) {
      this.shell('', `<div class="glass-card lobby-wait-card"><h2>🎨 Round in progress</h2><p class="subtitle">You'll be dealt in next round. Watch the drawing on the TV!</p></div>`);
    } else if (s.phase === 'DRAWING') {
      this.renderDrawing();
    } else if (s.phase === 'VOTING') {
      this.renderVoting();
    } else if (s.phase === 'IMPOSTER_GUESS') {
      this.renderImposterGuess();
    } else {
      this.renderRoundOver();
    }
  }

  wordCard() {
    const p = this.privateState;
    return `
      <button class="secret-card compact ${p.isImposter ? 'card-spy' : 'card-location'} ${this.isCardRevealed ? 'revealed' : 'hidden'}" id="cardToggle">
        ${this.isCardRevealed ? `
          <div class="card-content">
            <div class="card-badge">${p.isImposter ? '🚨 YOU ARE THE FAKE ARTIST' : '🎨 SECRET WORD'}</div>
            <h1 class="card-title">${p.isImposter ? '???' : escapeHtml(p.secretWord)}</h1>
            <p class="card-desc">Category: <strong>${escapeHtml(p.category)}</strong>${p.isImposter ? '. Bluff a believable line!' : ''}</p>
          </div>
        ` : `<div class="curtain-content"><span class="eye-icon">🔒</span><h3>Secret word</h3><p>Tap to peek</p></div>`}
      </button>
    `;
  }

  bindCard() {
    document.getElementById('cardToggle')?.addEventListener('click', () => {
      this.isCardRevealed = !this.isCardRevealed;
      this.render();
    });
  }

  renderDrawing() {
    const s = this.publicState;
    const isMyTurn = s.activePlayerId === this.session.playerId;
    const myColor = this.privateState.playerColor;

    this.shell(`Line ${s.currentRound}/${s.totalRounds}`, `
      ${this.wordCard()}
      <div class="glass-card canvas-card ${isMyTurn ? 'my-turn' : ''}" style="--accent:${myColor};">
        <div class="canvas-head">
          ${isMyTurn ? `<strong style="color:${myColor};">✏️ YOUR TURN: one continuous line</strong>` : `<span>⏳ ${escapeHtml(s.activePlayerName)} is drawing...</span>`}
        </div>
        <div class="phone-canvas-wrap">
          <canvas id="mobileCanvas" width="800" height="600"></canvas>
        </div>
        ${isMyTurn ? `
          <div class="draw-actions">
            <button class="btn-secondary" id="btnRedo" ${this.myStroke ? '' : 'disabled'}>↺ Redo</button>
            <button class="btn-primary" id="btnSubmitStroke" ${this.strokeDone ? '' : 'disabled'} style="background:${myColor};">✓ Submit Line</button>
          </div>
        ` : ''}
      </div>
    `);
    this.bindCard();
    this.paintCanvas();
    if (isMyTurn) this.attachDrawing(myColor);
  }

  paintCanvas() {
    const canvas = document.getElementById('mobileCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const strokes = [...(this.publicState.strokes || [])];
    if (this.myStroke) strokes.push({ color: this.privateState.playerColor, points: this.myStroke });
    drawStrokes(ctx, strokes, canvas.width, canvas.height, { lineWidth: 8 });
  }

  attachDrawing(color) {
    const canvas = document.getElementById('mobileCanvas');
    if (!canvas) return;
    let drawing = false;
    let pending = [];
    let start = false;
    let scheduled = false;

    const flush = () => {
      scheduled = false;
      if (!pending.length) return;
      this.session.sendAction('STROKE_POINTS', { start, points: pending });
      pending = [];
      start = false;
    };
    const queue = (pt, isStart = false) => {
      if (isStart) start = true;
      pending.push(pt);
      if (!scheduled) {
        scheduled = true;
        requestAnimationFrame(flush);
      }
    };
    const pos = (e) => {
      const r = canvas.getBoundingClientRect();
      const x = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
      const y = Math.max(0, Math.min(1, (e.clientY - r.top) / r.height));
      return [Math.round(x * 1000) / 1000, Math.round(y * 1000) / 1000];
    };

    canvas.addEventListener('pointerdown', (e) => {
      if (this.strokeDone) return; // exactly one line per turn; use Redo to try again
      e.preventDefault();
      canvas.setPointerCapture?.(e.pointerId);
      drawing = true;
      const pt = pos(e);
      this.myStroke = [pt];
      queue(pt, true);
      this.paintCanvas();
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!drawing) return;
      e.preventDefault();
      const pt = pos(e);
      const last = this.myStroke[this.myStroke.length - 1];
      if (Math.abs(pt[0] - last[0]) + Math.abs(pt[1] - last[1]) < 0.004) return;
      this.myStroke.push(pt);
      queue(pt);
      const ctx = canvas.getContext('2d');
      ctx.strokeStyle = color;
      ctx.lineWidth = 8;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(last[0] * canvas.width, last[1] * canvas.height);
      ctx.lineTo(pt[0] * canvas.width, pt[1] * canvas.height);
      ctx.stroke();
    });
    const end = () => {
      if (!drawing) return;
      drawing = false;
      this.strokeDone = true;
      vibrate([20]);
      document.getElementById('btnSubmitStroke')?.removeAttribute('disabled');
      document.getElementById('btnRedo')?.removeAttribute('disabled');
    };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);

    document.getElementById('btnRedo')?.addEventListener('click', () => {
      this.myStroke = null;
      this.strokeDone = false;
      this.session.sendAction('STROKE_CANCEL');
      this.render();
    });
    document.getElementById('btnSubmitStroke')?.addEventListener('click', () => {
      if (!this.strokeDone) return;
      flush();
      vibrate([40]);
      this.session.sendAction('STROKE_SUBMIT');
      document.getElementById('btnSubmitStroke').disabled = true;
    });
  }

  renderVoting() {
    const s = this.publicState;
    const voted = (s.votedIds || []).includes(this.session.playerId);
    const players = (s.players || []).filter(p => p.id !== this.session.playerId);
    this.shell('🗳️ Vote', `
      <div class="glass-card">
        <h2>Who is the Fake Artist?</h2>
        ${voted ? `<div class="vote-confirmed"><span class="check">✓</span><h3>Vote locked in</h3><p>Waiting for the others...</p></div>` : `
          <div class="vote-grid">
            ${players.map(p => `
              <button class="suspect-select-btn" data-player-id="${escapeHtml(p.id)}" style="border-left:5px solid ${p.color};">
                <span class="avatar">${p.avatar}</span><span class="name">${escapeHtml(p.name)}</span>
              </button>
            `).join('')}
          </div>
        `}
      </div>
      ${this.wordCard()}
    `);
    this.bindCard();
    this.container.querySelectorAll('[data-player-id]').forEach(btn => btn.addEventListener('click', () => {
      vibrate([40]);
      this.session.sendAction('CAST_VOTE', { suspectId: btn.dataset.playerId });
      this.container.querySelectorAll('[data-player-id]').forEach(b => { b.disabled = true; });
    }));
  }

  renderImposterGuess() {
    const isImposter = this.privateState.isImposter;
    const options = this.privateState.guessOptions || [];
    this.shell('🎯 Final guess', isImposter ? `
      <div class="glass-card spy-guess-card">
        <h2>You were caught!</h2>
        <p class="highlight-prompt">Pick the secret word to steal the win:</p>
        <div class="guess-locations-grid">
          ${options.map((w, i) => `<button class="guess-loc-btn" data-idx="${i}">${escapeHtml(w)}</button>`).join('')}
        </div>
      </div>
    ` : `
      <div class="glass-card lobby-wait-card"><div class="big-emoji">🎯</div><h2>Fake Artist caught!</h2><p class="subtitle">They're making a final guess. Fingers crossed...</p></div>
    `);
    this.container.querySelectorAll('.guess-loc-btn').forEach(btn => btn.addEventListener('click', async () => {
      const word = options[Number(btn.dataset.idx)];
      if (await confirmDialog(`Final answer: "${word}"?`, { confirmLabel: 'Lock it in', tone: 'ok' })) {
        this.session.sendAction('SUBMIT_GUESS', { guess: word });
      }
    }));
  }

  renderRoundOver() {
    const o = this.publicState.roundOutcome;
    const isImposter = this.privateState.isImposter;
    const fakeWon = o && o.outcome !== 'ARTISTS_WIN' && o.outcome !== 'ABANDONED';
    const won = isImposter ? fakeWon : o?.outcome === 'ARTISTS_WIN';
    this.shell('', `
      <div class="glass-card round-over-mobile">
        <div class="big-emoji">${won ? '🏆' : '😵'}</div>
        <h2>${won ? 'You win this round!' : 'Round lost'}</h2>
        <div class="summary-box">
          <p>Word: <strong>${escapeHtml(o?.secretWord || '')}</strong></p>
          <p>Fake Artist: <strong>${escapeHtml(o?.imposterName || '')}</strong></p>
        </div>
      </div>
    `);
  }
}
