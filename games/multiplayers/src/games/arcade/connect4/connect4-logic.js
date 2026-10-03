// Pure Connect 4 rules + AI (no DOM), shared by host and unit tests.
export const COLS = 7;
export const ROWS = 6;

export function createBoard() {
  return Array.from({ length: ROWS }, () => Array(COLS).fill(0));
}

/** Lowest empty row in a column, or -1 if the column is full. */
export function lowestEmptyRow(board, col) {
  if (col < 0 || col >= COLS) return -1;
  for (let r = ROWS - 1; r >= 0; r--) {
    if (board[r][col] === 0) return r;
  }
  return -1;
}

export function isBoardFull(board) {
  return board[0].every(cell => cell !== 0);
}

/** Returns the winning cells through (row, col) or null. */
export function findWin(board, row, col) {
  const val = board[row][col];
  if (!val) return null;
  const dirs = [[0, 1], [1, 0], [1, 1], [1, -1]];
  for (const [dr, dc] of dirs) {
    const cells = [[row, col]];
    for (const sign of [1, -1]) {
      let r = row + dr * sign;
      let c = col + dc * sign;
      while (r >= 0 && r < ROWS && c >= 0 && c < COLS && board[r][c] === val) {
        cells.push([r, c]);
        r += dr * sign;
        c += dc * sign;
      }
    }
    if (cells.length >= 4) return cells;
  }
  return null;
}

function wouldWin(board, col, who) {
  const row = lowestEmptyRow(board, col);
  if (row < 0) return false;
  board[row][col] = who;
  const win = !!findWin(board, row, col);
  board[row][col] = 0;
  return win;
}

/**
 * Friendly but non-trivial AI: win if possible, block the opponent's win, avoid moves
 * that hand the opponent a win right above, otherwise prefer central columns.
 */
export function chooseAiMove(board, me, random = Math.random) {
  const them = me === 1 ? 2 : 1;
  const open = [];
  for (let c = 0; c < COLS; c++) if (lowestEmptyRow(board, c) >= 0) open.push(c);
  if (!open.length) return -1;

  const winning = open.find(c => wouldWin(board, c, me));
  if (winning !== undefined) return winning;
  const blocking = open.find(c => wouldWin(board, c, them));
  if (blocking !== undefined) return blocking;

  const safe = open.filter(c => {
    const row = lowestEmptyRow(board, c);
    if (row <= 0) return true;
    board[row][c] = me;
    const givesWin = wouldWin(board, c, them);
    board[row][c] = 0;
    return !givesWin;
  });
  const pool = safe.length ? safe : open;
  const center = (COLS - 1) / 2;
  const scored = pool.map(c => ({ c, score: -Math.abs(c - center) + random() * 1.5 }));
  scored.sort((a, b) => b.score - a.score);
  return scored[0].c;
}
