export const MAFIA_ROLES = [
  {
    "name": "Mafia",
    "team": "mafia",
    "icon": "🔪",
    "desc": "Each night, agree with your fellow Mafia on one person to eliminate. Blend in by day."
  },
  {
    "name": "Doctor",
    "team": "town",
    "icon": "💉",
    "desc": "Each night, protect one person (yourself included) from the Mafia. Not the same person twice in a row."
  },
  {
    "name": "Detective",
    "team": "town",
    "icon": "🔍",
    "desc": "Each night, investigate one player to learn whether they are Mafia."
  },
  {
    "name": "Townsperson",
    "team": "town",
    "icon": "🧑‍🌾",
    "desc": "Find the Mafia through discussion and vote them out by day."
  },
  {
    "name": "Jester",
    "team": "solo",
    "icon": "🃏",
    "desc": "You win alone if the town votes to eliminate YOU. Act suspicious, but not too suspicious!"
  },
  {
    "name": "Vigilante",
    "team": "town",
    "icon": "🎯",
    "desc": "You have one bullet for the whole game. Use it at night on someone you are sure is Mafia."
  }
];

export function roleInfo(name) {
  return MAFIA_ROLES.find(r => r.name === name) || MAFIA_ROLES[3];
}

/** Role list for a table of n players (n >= 3). */
export function buildRoleDeck(n) {
  const mafiaCount = n >= 12 ? 3 : n >= 7 ? 2 : 1;
  const deck = Array(mafiaCount).fill('Mafia');
  deck.push('Doctor');
  if (n >= 4) deck.push('Detective');
  if (n >= 7) deck.push('Jester');
  if (n >= 9) deck.push('Vigilante');
  while (deck.length < n) deck.push('Townsperson');
  return deck.slice(0, n);
}
