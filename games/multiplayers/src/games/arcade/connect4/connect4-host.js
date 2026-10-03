import { playRoundStart, playVictory, playTick, playBuzzer } from '../../../utils/audio.js';
import { escapeHtml, ChallengerQueue, Disposer } from '../../../utils/ui.js';
import { COLS, ROWS, createBoard, lowestEmptyRow, isBoardFull, findWin, chooseAiMove } from './connect4-logic.js';

export const AI_ID = 'AI_BOT';
const COLORS = { 1: '#ef4444', 2: '#facc15' };

export class Connect4Host {
  constructor(session, container, onReturnToHub) {
    this.session = session;
    this.container = container;
    this.onReturnToHub = onReturnToHub;
    this.disposer = new Disposer();

    this.phase = 'SETUP'; // 'SETUP' | 'PLAYING' | 'GAME_OVER'
    this.queue = new ChallengerQueue();
    this.player1Id = null;
    this.player2Id = null;
    this.board = createBoard();
    this.currentTurn = 1;
    this.winningCells = [];
    this.winner = null; // 1 | 2 | 'DRAW'
    this.lastMove = null;
    this.wins = {}; // playerId -> match wins this session
    this.matchNumber = 0;

    this.setupNetworkHandlers();
  }

  setupNetworkHandlers() {
    this.session.on('playerAction', (playerId, action, payload) => {
      if (this.phase !== 'PLAYING' || action !== 'DROP_COL') return;
      const seat = playerId === this.player1Id ? 1 : playerId === this.player2Id ? 2 : 0;
      if (seat && seat === this.currentTurn) this.dropDisc(Number(payload.col));
    });

    this.session.on('rosterChange', () => {
      this.syncQueue();
      if (this.phase !== 'PLAYING') this.render();
      this.syncState();
    });

    this.session.on('playerLeave', (player) => {
      if (this.phase !== 'PLAYING') return;
      if (player.id === this.player1Id) this.finish(2, 'forfeit');
      else if (player.id === this.player2Id) this.finish(1, 'forfeit');
    });
  }

  destroy() {
    this.disposer.dispose();
  }

  syncQueue() {
    this.queue.sync(this.session.getPlayers().map(p => p.id));
  }

  nameOf(id) {
    if (id === AI_ID) return '🤖 AI Bot';
    return this.session.clients.get(id)?.name || 'Player';
  }

  avatarOf(id) {
    if (id === AI_ID) return '🤖';
    return this.session.clients.get(id)?.avatar || '👤';
  }

  startMatch(seats = null) {
    this.syncQueue();
    const valid = (id) => id === AI_ID || this.session.clients.has(id);
    let [p1, p2] = seats && seats.every(valid) ? seats : this.queue.pair();
    if (!p1) return;
    if (!p2) p2 = AI_ID;
    this.player1Id = p1;
    this.player2Id = p2;

    this.board = createBoard();
    this.currentTurn = 1;
    this.winningCells = [];
    this.winner = null;
    this.lastMove = null;
    this.endReason = null;
    this.phase = 'PLAYING';
    this.matchNumber++;

    playRoundStart();
    this.syncState();
    this.render();
    this.maybeAiTurn();
  }

  nextChallenger() {
    const winnerId = this.winner === 1 ? this.player1Id : this.winner === 2 ? this.player2Id : null;
    const loserId = this.winner === 1 ? this.player2Id : this.winner === 2 ? this.player1Id : null;
    if (winnerId && loserId && winnerId !== AI_ID && loserId !== AI_ID) {
      this.queue.winnerStays(winnerId, loserId);
    } else if (this.winner === 'DRAW' && this.player1Id !== AI_ID && this.player2Id !== AI_ID) {
      // Draw: both step aside for the next pair
      this.queue.winnerStays(this.player1Id, this.player2Id);
      this.queue.order.push(this.queue.order.shift());
    }
    this.startMatch();
  }

  dropDisc(col) {
    if (!Number.isInteger(col)) return;
    const row = lowestEmptyRow(this.board, col);
    if (row === -1) {
      playBuzzer();
      return;
    }

    this.board[row][col] = this.currentTurn;
    this.lastMove = { row, col, n: (this.lastMove?.n || 0) + 1 };
    playTick(500 + row * 80);

    const cells = findWin(this.board, row, col);
    if (cells) {
      this.winningCells = cells;
      this.finish(this.currentTurn, 'connect');
      return;
    }
    if (isBoardFull(this.board)) {
      this.finish('DRAW', 'full');
      return;
    }

    this.currentTurn = this.currentTurn === 1 ? 2 : 1;
    this.syncState();
    this.render();
    this.maybeAiTurn();
  }

  maybeAiTurn() {
    const aiSeat = this.player1Id === AI_ID ? 1 : this.player2Id === AI_ID ? 2 : 0;
    if (this.phase !== 'PLAYING' || aiSeat !== this.currentTurn) return;
    const match = this.matchNumber;
    this.disposer.timeout(() => {
      if (this.phase !== 'PLAYING' || match !== this.matchNumber || this.currentTurn !== aiSeat) return;
      this.dropDisc(chooseAiMove(this.board, aiSeat));
    }, 700);
  }

  finish(winner, reason) {
    this.phase = 'GAME_OVER';
    this.winner = winner;
    this.endReason = reason;
    const winnerId = winner === 1 ? this.player1Id : winner === 2 ? this.player2Id : null;
    if (winnerId && winnerId !== AI_ID) this.wins[winnerId] = (this.wins[winnerId] || 0) + 1;
    playVictory();
    this.syncState();
    this.render();
  }

  syncState() {
    this.syncQueue();
    const waiting = this.queue.order.filter(id => id !== this.player1Id && id !== this.player2Id);
    this.session.broadcastPublicState({
      game: 'connect4',
      phase: this.phase,
      board: this.board,
      currentTurn: this.currentTurn,
      winner: this.winner,
      endReason: this.endReason,
      winningCells: this.winningCells,
      lastMove: this.lastMove,
      p1Id: this.player1Id,
      p2Id: this.player2Id,
      p1Name: this.nameOf(this.player1Id),
      p2Name: this.nameOf(this.player2Id),
      queue: (this.phase === 'SETUP' ? this.queue.order : waiting).map(id => ({ id, name: this.nameOf(id) }))
    });
  }

  render() {
    if (!this.container) return;
    if (this.phase === 'SETUP') this.renderSetup();
    else this.renderBoard();
  }

  renderSetup() {
    this.syncQueue();
    const [a, b] = this.queue.pair();
    const rest = this.queue.order.slice(2);

    this.container.innerHTML = `
      <div class="host-screen-wrapper">
        <header class="host-header">
          <div class="brand-badge"><span class="pulse-dot"></span><span>CONNECT 4 GRID DUEL</span></div>
          <div class="room-code-display"><span class="label">ROOM</span><span class="code">${escapeHtml(this.session.roomCode)}</span></div>
        </header>

        <div class="glass-card setup-card">
          <div class="setup-icon">🔴🟡</div>
          <h2>Four in a row wins</h2>
          <p class="setup-desc">Drop discs from your phone. Line up 4 horizontally, vertically or diagonally. <strong>Winner stays on</strong>, and the next person in line takes on the champion.</p>

          <div class="versus-row">
            <div class="player-chip big" style="border-color:${COLORS[1]};">
              <span class="avatar">${a ? this.avatarOf(a) : '⏳'}</span>
              <div><small style="color:${COLORS[1]};">RED · MOVES FIRST</small><br/><strong>${a ? escapeHtml(this.nameOf(a)) : 'Waiting for a player'}</strong></div>
            </div>
            <span class="vs">VS</span>
            <div class="player-chip big" style="border-color:${COLORS[2]};">
              <span class="avatar">${b ? this.avatarOf(b) : '🤖'}</span>
              <div><small style="color:${COLORS[2]};">YELLOW</small><br/><strong>${b ? escapeHtml(this.nameOf(b)) : 'AI Bot (solo practice)'}</strong></div>
            </div>
          </div>

          ${rest.length ? `<p class="queue-line">Next up: ${rest.map(id => escapeHtml(this.nameOf(id))).join(' → ')}</p>` : ''}

          <div class="setup-actions">
            <button class="btn-primary-large" id="btnStartC4" ${a ? '' : 'disabled'}>🚀 Start Match</button>
            <button class="btn-secondary" id="btnBackDeck">Back to Lobby</button>
          </div>
        </div>
      </div>
    `;

    document.getElementById('btnStartC4')?.addEventListener('click', () => this.startMatch());
    document.getElementById('btnBackDeck')?.addEventListener('click', () => this.onReturnToHub?.());
  }

  renderBoard() {
    const p1Name = escapeHtml(this.nameOf(this.player1Id));
    const p2Name = escapeHtml(this.nameOf(this.player2Id));
    const over = this.phase === 'GAME_OVER';
    const turnName = this.currentTurn === 1 ? p1Name : p2Name;
    const waiting = this.queue.order.filter(id => id !== this.player1Id && id !== this.player2Id);
    const humanMatch = this.player1Id !== AI_ID && this.player2Id !== AI_ID;

    let resultHtml = '';
    if (over) {
      const winName = this.winner === 1 ? p1Name : this.winner === 2 ? p2Name : '';
      const title = this.winner === 'DRAW' ? "IT'S A DRAW!" : `${winName} WINS! 🎉`;
      const sub = this.endReason === 'forfeit' ? 'Opponent left the room.' : this.winner === 'DRAW' ? 'The board is full.' : 'Four in a row!';
      resultHtml = `
        <div class="c4-result">
          <h2 style="color:${this.winner === 'DRAW' ? '#fff' : COLORS[this.winner]};">${title}</h2>
          <p class="muted">${sub}</p>
          <div class="setup-actions">
            ${humanMatch && waiting.length ? `<button class="btn-primary" id="btnNextC4">👑 Winner Stays: Next Challenger (${escapeHtml(this.nameOf(waiting[0]))})</button>` : ''}
            <button class="${humanMatch && waiting.length ? 'btn-secondary' : 'btn-primary'}" id="btnRematchC4">🔁 Rematch (swap colors)</button>
            <button class="btn-secondary" id="btnHubC4">Back to Lobby</button>
          </div>
        </div>
      `;
    }

    const boardHtmlMoveN = this.lastMove?.n;
    this.container.innerHTML = `
      <div class="host-screen-wrapper">
        <header class="host-header compact">
          <div class="versus-mini">
            <span class="${!over && this.currentTurn === 1 ? 'turn-active' : ''}" style="color:${COLORS[1]};">🔴 ${p1Name} <small>${this.wins[this.player1Id] || 0}W</small></span>
            <span class="vs">VS</span>
            <span class="${!over && this.currentTurn === 2 ? 'turn-active' : ''}" style="color:${COLORS[2]};">🟡 ${p2Name} <small>${this.wins[this.player2Id] || 0}W</small></span>
          </div>
          <div class="round-indicator">${over ? 'MATCH OVER' : `${turnName}'s TURN`}</div>
          <button class="btn-icon" id="btnQuitC4">Exit</button>
        </header>

        <div class="c4-stage">
          <div class="c4-board" style="--rows:${ROWS}; --cols:${COLS};">
            ${this.board.map((row, r) => row.map((cell, c) => {
              const isWin = this.winningCells.some(([wr, wc]) => wr === r && wc === c);
              // Animate the drop only the first time this move is drawn.
              const isLast = this.lastMove && this.lastMove.row === r && this.lastMove.col === c && this.lastMove.n !== this.animatedMoveN;
              return `<div class="c4-cell ${cell ? `p${cell}` : ''} ${isWin ? 'win-pulse' : ''} ${isLast ? 'drop' : ''}" style="--drop-rows:${r + 1};"></div>`;
            }).join('')).join('')}
          </div>
          ${over ? resultHtml : `<p class="muted c4-hint">Tap a column on your phone to drop your disc.${waiting.length ? ` Next up: ${escapeHtml(this.nameOf(waiting[0]))}` : ''}</p>`}
        </div>
      </div>
    `;

    this.animatedMoveN = boardHtmlMoveN;
    document.getElementById('btnNextC4')?.addEventListener('click', () => this.nextChallenger());
    document.getElementById('btnRematchC4')?.addEventListener('click', () => this.rematch());
    document.getElementById('btnHubC4')?.addEventListener('click', () => this.onReturnToHub?.());
    document.getElementById('btnQuitC4')?.addEventListener('click', () => this.onReturnToHub?.());
  }

  rematch() {
    // Swap colours so the other player moves first this time.
    this.startMatch([this.player2Id, this.player1Id]);
  }
}
