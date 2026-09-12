// Current club membership is not a provider identity. An imported official
// roster can join historical statistics only through its verified numeric ID.
export function verifiedRosterStatRows(store, routeIds, rows) {
  if (store?.identityPolicy !== 'verified-provider-id') return null;
  const ids = new Set(routeIds.map(String));
  const player = (store.players ?? []).find(row => ids.has(String(row.id)) || (row.legacyIds ?? []).some(id => ids.has(String(id))));
  if (!player) return null; // A purely historical statistics route.
  if (!Number.isInteger(player.balldontlieId) || player.balldontlieId < 1) return [];
  return rows.filter(row => Number(row?.player?.id ?? row?.player_id) === player.balldontlieId);
}
