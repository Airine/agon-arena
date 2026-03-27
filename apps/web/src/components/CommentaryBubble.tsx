'use client';

import { useEffect, useState } from 'react';
import type { CommentaryState } from '../hooks/useCommentary';

interface CommentaryBubbleProps {
  commentary: CommentaryState;
}

export default function CommentaryBubble({ commentary }: CommentaryBubbleProps) {
  const [visible, setVisible] = useState(false);

  // Fade in when text arrives, fade out handled by TTL in hook
  useEffect(() => {
    if (commentary.text || commentary.isLoading) {
      setVisible(true);
    } else {
      setVisible(false);
    }
  }, [commentary.text, commentary.isLoading]);

  if (!visible) return null;

  return (
    <div
      style={{
        position: 'absolute',
        bottom: 16,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 10,
        maxWidth: 480,
        width: '90%',
        animation: 'commentaryFadeIn 0.3s ease-out',
      }}
    >
      <style>{`
        @keyframes commentaryFadeIn {
          from { opacity: 0; transform: translateX(-50%) translateY(8px); }
          to   { opacity: 1; transform: translateX(-50%) translateY(0); }
        }
      `}</style>
      <div
        style={{
          background: '#0B0B18',
          border: '0.5px solid #252540',
          borderRadius: '10px',
          padding: '10px 14px',
          display: 'flex',
          alignItems: 'flex-start',
          gap: '10px',
          boxShadow: '0 4px 24px rgba(0,0,0,0.6)',
        }}
      >
        {/* Mic icon */}
        <div
          style={{
            fontSize: '16px',
            flexShrink: 0,
            marginTop: 1,
            opacity: commentary.isLoading ? 0.5 : 1,
          }}
        >
          🎙️
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: '10px',
              color: '#E8A020',
              fontWeight: 700,
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
              fontFamily: 'JetBrains Mono, monospace',
              marginBottom: 4,
            }}
          >
            AI Commentary
          </div>

          {commentary.isLoading ? (
            <div
              style={{
                fontSize: '13px',
                color: '#555570',
                fontStyle: 'italic',
              }}
            >
              <LoadingDots />
            </div>
          ) : (
            <div
              style={{
                fontSize: '13px',
                color: '#EDE9E2',
                lineHeight: 1.55,
              }}
            >
              {commentary.text}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function LoadingDots() {
  const [dots, setDots] = useState('');
  useEffect(() => {
    const id = setInterval(() => {
      setDots((d) => (d.length >= 3 ? '' : d + '.'));
    }, 300);
    return () => clearInterval(id);
  }, []);
  return <span>Generating commentary{dots}</span>;
}
