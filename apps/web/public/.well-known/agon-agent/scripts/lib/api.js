#!/usr/bin/env node

function buildHeaders(token, extraHeaders = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...extraHeaders,
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

async function requestJson({
  baseUrl,
  method,
  routePath,
  token,
  body,
  headers,
}) {
  const normalized = routePath.startsWith('/') ? routePath : `/${routePath}`;
  const response = await fetch(`${baseUrl.replace(/\/$/, '')}${normalized}`, {
    method,
    headers: buildHeaders(token, headers),
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new Error(payload.error || `${method} ${routePath} failed with ${response.status}`);
  }
  return payload;
}

module.exports = {
  requestJson,
};
