/**
 * Shared UI helpers: HTML escaping, non-blocking toasts and in-page confirm dialogs.
 * Never use window.alert/confirm on the host screen: they freeze timers, game loops
 * and network sync for every player in the room.
 */

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' };

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"'`]/g, ch => ESCAPES[ch]);
}

/** Strip markup-significant characters from user supplied display text. */
export function cleanText(value, maxLength = 16) {
  return String(value ?? '')
    .replace(/[<>&"'`\\]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function ensureLayer(id) {
  let layer = document.getElementById(id);
  if (!layer) {
    layer = document.createElement('div');
    layer.id = id;
    document.body.appendChild(layer);
  }
  return layer;
}

export function toast(message, { tone = 'info', duration = 2600 } = {}) {
  if (typeof document === 'undefined') return;
  const layer = ensureLayer('toastLayer');
  // Keep at most 3 on screen so bursts (e.g. everyone joining) never bury the game.
  while (layer.children.length >= 3) layer.firstElementChild.remove();
  const el = document.createElement('div');
  el.className = `toast toast-${tone}`;
  el.textContent = message;
  layer.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 300);
  }, duration);
}

/** Promise-based confirm dialog rendered in the page (does not block the event loop). */
export function confirmDialog(message, { confirmLabel = 'Yes', cancelLabel = 'Cancel', tone = 'danger' } = {}) {
  return new Promise(resolve => {
    const layer = ensureLayer('dialogLayer');
    layer.innerHTML = `
      <div class="modal-overlay ui-dialog" role="dialog" aria-modal="true">
        <div class="modal-card">
          <p class="ui-dialog-msg">${escapeHtml(message)}</p>
          <div class="ui-dialog-actions">
            <button class="btn-secondary" data-answer="no">${escapeHtml(cancelLabel)}</button>
            <button class="btn-primary ${tone === 'danger' ? 'btn-danger' : ''}" data-answer="yes">${escapeHtml(confirmLabel)}</button>
          </div>
        </div>
      </div>
    `;
    const finish = (answer) => {
      layer.innerHTML = '';
      resolve(answer);
    };
    layer.querySelector('[data-answer="yes"]').addEventListener('click', () => finish(true));
    layer.querySelector('[data-answer="no"]').addEventListener('click', () => finish(false));
    layer.querySelector('.modal-overlay').addEventListener('click', (e) => {
      if (e.target.classList.contains('modal-overlay')) finish(false);
    });
  });
}

export function shuffle(list) {
  const arr = [...list];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Tally votes { voterId: choiceId } and return the unique leader, or null on a tie / no votes.
 * Choices listed in `ignore` (e.g. 'SKIP') still count toward ties but can never "win".
 */
export function tallyVotes(votes, { ignore = [] } = {}) {
  const counts = {};
  Object.values(votes || {}).forEach(choice => {
    if (choice == null) return;
    counts[choice] = (counts[choice] || 0) + 1;
  });
  let leader = null;
  let best = 0;
  let tied = false;
  for (const [choice, count] of Object.entries(counts)) {
    if (count > best) {
      best = count;
      leader = choice;
      tied = false;
    } else if (count === best) {
      tied = true;
    }
  }
  if (tied || leader === null || ignore.includes(leader)) return { leader: null, counts, best };
  return { leader, counts, best };
}

/** Tracks timers, animation frames and DOM listeners so a game can tear down cleanly. */
export class Disposer {
  constructor() {
    this.items = [];
    this.disposed = false;
  }

  interval(fn, ms) {
    const id = setInterval(fn, ms);
    this.items.push(() => clearInterval(id));
    return id;
  }

  timeout(fn, ms) {
    const id = setTimeout(fn, ms);
    this.items.push(() => clearTimeout(id));
    return id;
  }

  listen(target, type, fn, opts) {
    target.addEventListener(type, fn, opts);
    this.items.push(() => target.removeEventListener(type, fn, opts));
  }

  add(fn) {
    this.items.push(fn);
  }

  dispose() {
    this.disposed = true;
    this.items.splice(0).forEach(fn => {
      try { fn(); } catch (e) { /* ignore */ }
    });
  }
}

/** Standard phone header: avatar + name on the left, a status pill on the right. */
export function controllerHeader(session, rightHtml = '', rightStyle = '') {
  return `
    <header class="controller-header">
      <div class="user-pill">${session.avatar} ${escapeHtml(session.playerName)}</div>
      <div class="room-pill" ${rightStyle ? `style="${rightStyle}"` : ''}>${rightHtml || `ROOM ${escapeHtml(session.roomCode)}`}</div>
    </header>
  `;
}

/** Ordered "winner stays on" queue for 2-player games played by a bigger group. */
export class ChallengerQueue {
  constructor() {
    this.order = [];
  }

  sync(playerIds) {
    const present = new Set(playerIds);
    this.order = this.order.filter(id => present.has(id));
    playerIds.forEach(id => {
      if (!this.order.includes(id)) this.order.push(id);
    });
    return this.order;
  }

  pair() {
    return [this.order[0] || null, this.order[1] || null];
  }

  /** Winner keeps their spot at the front; the loser goes to the back of the line. */
  winnerStays(winnerId, loserId) {
    if (!winnerId || !loserId) return;
    this.order = this.order.filter(id => id !== loserId && id !== winnerId);
    this.order.unshift(winnerId);
    this.order.push(loserId);
  }

  positionOf(id) {
    return this.order.indexOf(id);
  }
}
