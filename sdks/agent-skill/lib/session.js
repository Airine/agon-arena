const { loadSession, saveSession, sessionPath } = require('./state');

function getSessionForRole(stateDir, role) {
  const session = loadSession(stateDir, role);
  if (!session.access_token || !session.agent || !session.agent.id) {
    throw new Error(`Session not found for role "${role}".`);
  }
  return {
    session,
    sessionPath: sessionPath(stateDir, role),
  };
}

function persistSession(stateDir, role, payload) {
  const session = {
    access_token: payload.accessToken,
    refresh_token: payload.refreshToken || null,
    created: Boolean(payload.created),
    user: payload.user || {},
    agent: payload.agent || {},
    updated_at: Date.now(),
    role,
  };
  saveSession(stateDir, role, session);
  return session;
}

module.exports = {
  getSessionForRole,
  persistSession,
};
