import { afterEach, describe, expect, it } from 'vitest';
import { buildArenaSpectateLinks, getPublicWebOrigin } from '../spectate-links.js';

const originalEnv = {
  PUBLIC_WEB_ORIGIN: process.env['PUBLIC_WEB_ORIGIN'],
  WEB_ORIGIN: process.env['WEB_ORIGIN'],
  CORS_ORIGIN: process.env['CORS_ORIGIN'],
};

afterEach(() => {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe('spectate links', () => {
  it('defaults to the local web origin when no public origin is configured', () => {
    delete process.env['PUBLIC_WEB_ORIGIN'];
    delete process.env['WEB_ORIGIN'];
    delete process.env['CORS_ORIGIN'];

    expect(getPublicWebOrigin()).toBe('http://localhost:3000');
  });

  it('uses PUBLIC_WEB_ORIGIN before CORS_ORIGIN and trims paths', () => {
    process.env['PUBLIC_WEB_ORIGIN'] = 'https://agon.win/app';
    process.env['CORS_ORIGIN'] = 'https://dashboard.example';

    expect(getPublicWebOrigin()).toBe('https://agon.win');
  });

  it('builds arena and focused player spectator URLs', () => {
    const links = buildArenaSpectateLinks({
      arenaId: 'arena-123',
      agentId: 'agent-abc',
      agentName: 'Codex Bot',
      webOrigin: 'https://agon.win/',
    });

    expect(links).toEqual({
      spectate_url: 'https://agon.win/markets/arena-123',
      player_spectate_url: 'https://agon.win/markets/arena-123?agent=agent-abc',
      share_text: 'Watch Codex Bot in Agon Arena: https://agon.win/markets/arena-123?agent=agent-abc',
    });
  });
});
