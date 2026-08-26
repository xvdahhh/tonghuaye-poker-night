type SeatPlayer = { id: string };

function anchorToPlayer(ids: string[], playerId: string) {
  const playerIndex = ids.indexOf(playerId);
  if (playerIndex <= 0) return ids;
  return [...ids.slice(playerIndex), ...ids.slice(0, playerIndex)];
}

export function seatOrderForPlayers(players: SeatPlayer[], playerId: string) {
  return anchorToPlayer(players.map((player) => player.id), playerId);
}

export function reconcileSeatOrder(current: string[], players: SeatPlayer[], playerId: string) {
  const activeIds = new Set(players.map((player) => player.id));
  const retained = current.filter((id) => activeIds.has(id));
  const retainedIds = new Set(retained);
  const arrivals = players.map((player) => player.id).filter((id) => !retainedIds.has(id));
  return anchorToPlayer([...retained, ...arrivals], playerId);
}

