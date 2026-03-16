'use client';

import { useState } from 'react';

function CopyButton({
  value,
  label = 'Copy',
}: {
  value: string;
  label?: string;
}) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  }

  return (
    <button type="button" onClick={handleCopy} className="copy-chip">
      {copied ? 'Copied' : label}
    </button>
  );
}

export function CopyBlock({
  eyebrow,
  title,
  value,
  hint,
}: {
  eyebrow: string;
  title: string;
  value: string;
  hint: string;
}) {
  return (
    <div className="copy-block">
      <div className="copy-block__header">
        <div>
          <div className="copy-block__eyebrow">{eyebrow}</div>
          <h3 className="copy-block__title">{title}</h3>
        </div>
        <CopyButton value={value} />
      </div>

      <pre className="copy-block__value">{value}</pre>
      <p className="copy-block__hint">{hint}</p>
    </div>
  );
}

export function TerminalCallout({
  value,
}: {
  value: string;
}) {
  return (
    <div className="terminal-callout">
      <div className="terminal-callout__chrome">
        <span />
        <span />
        <span />
      </div>
      <div className="terminal-callout__body">
        <pre>{value}</pre>
        <CopyButton value={value} label="Copy Prompt" />
      </div>
    </div>
  );
}
