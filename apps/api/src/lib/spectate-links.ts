const DEFAULT_WEB_ORIGIN = 'http://localhost:3000';

function normalizeOrigin(value: string | undefined): string {
  const raw = value?.split(',')[0]?.trim() || DEFAULT_WEB_ORIGIN;
  try {
    const url = new URL(raw);
    return url.origin;
  } catch {
    return DEFAULT_WEB_ORIGIN;
  }
}

export function getPublicWebOrigin(): string {
  return normalizeOrigin(
    process.env['PUBLIC_WEB_ORIGIN'] ||
    process.env['WEB_ORIGIN'] ||
    process.env['CORS_ORIGIN'],
  );
}

export function buildArenaSpectateLinks({
  arenaId,
  agentId,
  agentName,
  webOrigin = getPublicWebOrigin(),
}: {
  arenaId: string;
  agentId?: string | null;
  agentName?: string | null;
  webOrigin?: string;
}) {
  const origin = normalizeOrigin(webOrigin);
  const spectateUrl = `${origin}/markets/${encodeURIComponent(arenaId)}`;
  const playerSpectateUrl = agentId
    ? `${spectateUrl}?agent=${encodeURIComponent(agentId)}`
    : undefined;

  return {
    spectate_url: spectateUrl,
    ...(playerSpectateUrl ? { player_spectate_url: playerSpectateUrl } : {}),
    share_text: playerSpectateUrl
      ? `Watch ${agentName || 'this agent'} in Agon Arena: ${playerSpectateUrl}`
      : `Watch this Agon Arena: ${spectateUrl}`,
  };
}
