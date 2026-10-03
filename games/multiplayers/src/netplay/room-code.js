// 4-letter pronounceable room codes without ambiguous characters (no 0/O, 1/I)
const SAFE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function generateRoomCode(length = 4) {
  let result = '';
  for (let i = 0; i < length; i++) {
    result += SAFE_CHARS.charAt(Math.floor(Math.random() * SAFE_CHARS.length));
  }
  return result;
}

export function sanitizeRoomCode(code) {
  if (!code) return '';
  return code.trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
}

export function getPeerIdForRoom(roomCode) {
  return `partydeck-spyfall-${sanitizeRoomCode(roomCode).toLowerCase()}`;
}

let cachedNetworkHost = null;

if (typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')) {
  const apiEndpoint = window.location.pathname.includes('/games/multiplayers') ? '/games/multiplayers/api/info' : '/api/info';
  fetch(apiEndpoint)
    .then(r => r.json())
    .then(info => {
      if (info && info.localIp && info.localIp !== 'localhost') {
        cachedNetworkHost = `${info.localIp}:${info.port || window.location.port || '3000'}`;
        console.log('[RoomCode] Auto-detected LAN IP for QR code:', cachedNetworkHost);
      }
    })
    .catch(() => {});
}

export function getJoinUrl(roomCode) {
  const url = new URL(window.location.href);
  url.searchParams.set('room', sanitizeRoomCode(roomCode));
  url.searchParams.delete('host');
  
  if (cachedNetworkHost && (url.hostname === 'localhost' || url.hostname === '127.0.0.1')) {
    url.host = cachedNetworkHost;
  }
  return url.toString();
}
