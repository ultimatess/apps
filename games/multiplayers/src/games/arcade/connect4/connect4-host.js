import { playRoundStart, playVictory, playTick, playBuzzer } from '../../../utils/audio.js';

const COLS = 7;
const ROWS = 6;

export class Connect4Host {
  constructor(session, container, onReturnToHub) {
    this.session = session;
    this.container = container;
    this.onReturnToHub = onReturnToHub;

    this.phase = 'SETUP'; // 'SETUP' | 'PLAYING' | 'GAME_OVER'
    this.player1Id = null;
    this.player2Id = null;

    this.board = Array(ROWS).fill(null).map(() => Array(COLS).fill(0)); // 0: empty, 1: P1, 2: P2
    this.currentTurn = 1; // 1 or 2
    this.winningCells = [];
    this.winner = null;

    this.setupNetworkHandlers();
  }

  setupNetworkHandlers() {
    this.session.on('playerAction', (playerId, action, payload) => {
      if (this.phase === 'PLAYING' && action === 'DROP_COL') {
        const isP1 = playerId === this.player1Id && this.currentTurn === 1;
        const isP2 = playerId === this.player2Id && this.currentTurn === 2;

        if (isP1 || isP2) {
          this.dropDisc(payload.col);
        }
      }
    });
  }

  startNewGame() {
    const clients = Array.from(this.session.clients.values());
    if (clients.length < 1) {
      alert('At least 1 player required!');
      return;
    }

    this.player1Id = clients[0].id;
    this.player2Id = clients.length >= 2 ? clients[1].id : 'HOST_OR_AI';

    this.board = Array(ROWS).fill(null).map(() => Array(COLS).fill(0));
    this.currentTurn = 1;
    this.winningCells = [];
    this.winner = null;
    this.phase = 'PLAYING';

    playRoundStart();
    this.dispatchRoles();
    this.syncState();
    this.render();
  }

  dispatchRoles() {
    const p1 = this.session.clients.get(this.player1Id);
    const p2 = this.session.clients.get(this.player2Id);

    if (p1) {
      this.session.sendPrivateState(p1.id, {
        game: 'connect4',
        playerNum: 1,
        color: '#ef4444',
        opponentName: p2?.name || 'AI Bot'
      });
    }
    if (p2) {
      this.session.sendPrivateState(p2.id, {
        game: 'connect4',
        playerNum: 2,
        color: '#f59e0b',
        opponentName: p1?.name || 'Player 1'
      });
    }
  }

  dropDisc(col) {
    if (col < 0 || col >= COLS) return;

    // Find lowest empty row in column
    let row = -1;
    for (let r = ROWS - 1; r >= 0; r--) {
      if (this.board[r][col] === 0) {
        row = r;
        break;
      }
    }

    if (row === -1) {
      playBuzzer(); // Column full
      return;
    }

    this.board[row][col] = this.currentTurn;
    playTick(800);

    // Check Win
    if (this.checkWin(row, col)) {
      this.phase = 'GAME_OVER';
      this.winner = this.currentTurn;
      playVictory();
    } else if (this.isBoardFull()) {
      this.phase = 'GAME_OVER';
      this.winner = 'DRAW';
      playVictory();
    } else {
      // Toggle Turn
      this.currentTurn = this.currentTurn === 1 ? 2 : 1;

      // Simple AI move if solo testing
      if (this.currentTurn === 2 && this.player2Id === 'HOST_OR_AI') {
        setTimeout(() => this.makeAiMove(), 600);
      }
    }

    this.syncState();
    this.render();
  }

  makeAiMove() {
    if (this.phase !== 'PLAYING') return;
    const available = [];
    for (let c = 0; c < COLS; c++) {
      if (this.board[0][c] === 0) available.push(c);
    }
    if (available.length > 0) {
      const choice = available[Math.floor(Math.random() * available.length)];
      this.dropDisc(choice);
    }
  }

  isBoardFull() {
    return this.board[0].every(cell => cell !== 0);
  }

  checkWin(row, col) {
    const val = this.board[row][col];
    const dirs = [
      [ [0, 1], [0, -1] ], // Horizontal
      [ [1, 0], [-1, 0] ], // Vertical
      [ [1, 1], [-1, -1] ], // Diagonal \
      [ [1, -1], [-1, 1] ]  // Diagonal /
    ];

    for (const [d1, d2] of dirs) {
      const cells = [[row, col]];
      // Forward
      let r = row + d1[0], c = col + d1[1];
      while (r >= 0 && r < ROWS && c >= 0 && c < COLS && this.board[r][c] === val) {
        cells.push([r, c]);
        r += d1[0]; c += d1[1];
      }
      // Backward
      r = row + d2[0]; c = col + d2[1];
      while (r >= 0 && r < ROWS && c >= 0 && c < COLS && this.board[r][c] === val) {
        cells.push([r, c]);
        r += d2[0]; c += d2[1];
      }

      if (cells.length >= 4) {
        this.winningCells = cells;
        return true;
      }
    }
    return false;
  }

  syncState() {
    const p1 = this.session.clients.get(this.player1Id);
    const p2 = this.session.clients.get(this.player2Id);

    this.session.broadcastPublicState({
      game: 'connect4',
      phase: this.phase,
      board: this.board,
      currentTurn: this.currentTurn,
      winner: this.winner,
      winningCells: this.winningCells,
      p1Name: p1?.name || 'Player 1',
      p2Name: p2?.name || (this.player2Id === 'HOST_OR_AI' ? 'AI Bot' : 'Player 2')
    });
  }

  render() {
    if (!this.container) return;

    const p1 = this.session.clients.get(this.player1Id);
    const p2 = this.session.clients.get(this.player2Id);
    const p1Name = p1?.name || 'Player 1';
    const p2Name = p2?.name || (this.player2Id === 'HOST_OR_AI' ? 'AI Bot' : 'Player 2');

    if (this.phase === 'SETUP') {
      this.container.innerHTML = `
        <div class="host-screen-wrapper">
          <header class="host-header">
            <div class="brand-badge"><span class="pulse-dot"></span><span>CONNECT 4 GRID DUEL</span></div>
            <div class="room-code-display"><span class="code">${this.session.roomCode}</span></div>
          </header>

          <div class="glass-card" style="max-width:800px; margin:0 auto; padding:40px 24px; text-align:center;">
            <div style="font-size:54px; margin-bottom:12px;">🔴🟡</div>
            <h2>Tactical Turn-Based Board Clash</h2>
            <p style="color:var(--text-secondary); margin:12px auto 24px; max-width:550px; line-height:1.5;">
              Classic 4-in-a-row strategy! Drop colored discs into columns from your phone to connect 4 horizontally, vertically, or diagonally.
            </p>

            <div style="display:flex; justify-content:center; gap:20px; margin-bottom:28px;">
              <div class="player-chip" style="border:2px solid #ef4444;">
                <span class="avatar">🔴</span>
                <strong>${p1Name} (Red)</strong>
              </div>
              <div class="player-chip" style="border:2px solid #f59e0b;">
                <span class="avatar">🟡</span>
                <strong>${p2Name} (Yellow)</strong>
              </div>
            </div>

            <div style="display:flex; justify-content:center; gap:12px;">
              <button class="btn-primary-large" id="btnStartC4" style="max-width:280px;">🚀 Start Match</button>
              <button class="btn-secondary" id="btnBackDeck">Back to Party Deck</button>
            </div>
          </div>
        </div>
      `;

      document.getElementById('btnStartC4')?.addEventListener('click', () => this.startNewGame());
      document.getElementById('btnBackDeck')?.addEventListener('click', () => {
        if (this.onReturnToHub) this.onReturnToHub();
      });
    } else {
      const isTurn1 = this.currentTurn === 1;
      this.container.innerHTML = `
        <div class="host-screen-wrapper">
          <header class="host-header" style="padding:10px 24px;">
            <div style="display:flex; align-items:center; gap:16px;">
              <span style="color:#ef4444; font-weight:800; ${isTurn1 ? 'text-decoration:underline;' : ''}">🔴 ${p1Name}</span>
              <span style="color:var(--text-muted); font-size:12px;">VS</span>
              <span style="color:#f59e0b; font-weight:800; ${!isTurn1 ? 'text-decoration:underline;' : ''}">🟡 ${p2Name}</span>
            </div>
            <div class="round-indicator">
              ${this.phase === 'GAME_OVER' ? 'GAME OVER' : `TURN: ${isTurn1 ? p1Name : p2Name}`}
            </div>
            <div class="room-code-mini"><button class="btn-icon" id="btnQuitC4">Exit</button></div>
          </header>

          <!-- The Connect 4 Grid -->
          <div style="display:flex; flex-direction:column; align-items:center; margin-top:20px;">
            <div class="c4-board" style="background:#1e3a8a; padding:16px; border-radius:24px; box-shadow:0 12px 40px rgba(0,0,0,0.8); border:4px solid #3b82f6;">
              ${this.board.map((row, r) => `
                <div style="display:flex; gap:12px; margin-bottom:12px;">
                  ${row.map((cell, c) => {
                    const isWinCell = this.winningCells.some(([wr, wc]) => wr === r && wc === c);
                    return `
                      <div class="c4-cell ${isWinCell ? 'win-pulse' : ''}" style="width:54px; height:54px; border-radius:50%; background:${cell === 1 ? '#ef4444' : cell === 2 ? '#f59e0b' : '#0a0d1d'}; box-shadow:${cell !== 0 ? 'inset 0 -4px 10px rgba(0,0,0,0.5)' : 'inset 0 4px 8px rgba(0,0,0,0.8)'}; border:2px solid rgba(255,255,255,0.1);"></div>
                    `;
                  }).join('')}
                </div>
              `).join('')}
            </div>

            ${this.phase === 'GAME_OVER' ? `
              <div style="text-align:center; margin-top:24px;">
                <h2 style="font-size:32px; color:${this.winner === 1 ? '#ef4444' : this.winner === 2 ? '#f59e0b' : '#fff'};">
                  ${this.winner === 'DRAW' ? "IT'S A DRAW!" : `${this.winner === 1 ? p1Name : p2Name} WINS! 🎉`}
                </h2>
                <div style="display:flex; justify-content:center; gap:12px; margin-top:16px;">
                  <button class="btn-primary" id="btnRematchC4">Play Rematch</button>
                  <button class="btn-secondary" id="btnHubC4">Back to Party Deck</button>
                </div>
              </div>
            ` : ''}
          </div>
        </div>
      `;

      document.getElementById('btnRematchC4')?.addEventListener('click', () => this.startNewGame());
      document.getElementById('btnHubC4')?.addEventListener('click', () => {
        if (this.onReturnToHub) this.onReturnToHub();
      });
      document.getElementById('btnQuitC4')?.addEventListener('click', () => {
        if (this.onReturnToHub) this.onReturnToHub();
      });
    }
  }
}
