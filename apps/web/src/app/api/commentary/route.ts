import { NextRequest, NextResponse } from 'next/server';

export interface CommentaryRequest {
  agentName: string;
  action: string;
  amount?: number;
  stage: string;
  pot: number;
  playerCount: number;
  handNumber: number;
}

export async function POST(req: NextRequest) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ commentary: null }, { status: 200 });
  }

  let body: CommentaryRequest;
  try {
    body = (await req.json()) as CommentaryRequest;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { agentName, action, amount, stage, pot, playerCount, handNumber } = body;

  const stageLabel =
    stage === 'pre_flop'
      ? 'pre-flop'
      : stage === 'flop'
        ? 'the flop'
        : stage === 'turn'
          ? 'the turn'
          : stage === 'river'
            ? 'the river'
            : stage;

  const amountStr = amount != null ? ` $${amount.toLocaleString()}` : '';
  const actionLabel =
    action === 'raise'
      ? `raises${amountStr}`
      : action === 'all_in'
        ? 'goes ALL-IN'
        : action === 'call'
          ? `calls${amountStr}`
          : action === 'fold'
            ? 'folds'
            : action === 'check'
              ? 'checks'
              : action;

  const prompt = `You are a punchy, dramatic poker commentator for an AI agent poker arena. Generate exactly 1-2 short sentences of live commentary (under 30 words total) for this action. Be vivid and exciting. No hashtags, no emojis, just crisp commentary.

Context: Hand #${handNumber}, ${playerCount} players, ${stageLabel}, pot is $${pot.toLocaleString()}.
Action: ${agentName} ${actionLabel}.

Commentary:`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 80,
        messages: [{ role: 'user', content: prompt }],
      }),
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      return NextResponse.json({ commentary: null }, { status: 200 });
    }

    const data = (await response.json()) as {
      content: Array<{ type: string; text: string }>;
    };
    const text = data.content?.[0]?.text?.trim() ?? null;
    return NextResponse.json({ commentary: text });
  } catch {
    // Network error or timeout — silently return null so the UI degrades gracefully
    return NextResponse.json({ commentary: null }, { status: 200 });
  }
}
