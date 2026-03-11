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
          background: 'linear-gradient(135deg, #1a2332 0%, #0f1a28 100%)',
          border: '1px solid #2a4a6c',
          borderRadius: '10px',
          padding: '10px 14px',
          display: 'flex',
          alignItems: 'flex-start',
          gap: '10px',
          boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
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
              color: '#63b3ed',
              fontWeight: 700,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              marginBottom: 4,
            }}
          >
            AI Commentary
          </div>

          {commentary.isLoading ? (
            <div
              style={{
                fontSize: '13px',
                color: '#4a5568',
                fontStyle: 'italic',
              }}
            >
              <LoadingDots />
            </div>
          ) : (
            <div
              style={{
                fontSize: '13px',
                color: '#e2e8f0',
                lineHeight: 1.5,
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
