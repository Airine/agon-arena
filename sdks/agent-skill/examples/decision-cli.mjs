#!/usr/bin/env node
import { printDecision, readTurnFromStdin, runCliDecision } from './decision-utils.mjs';

const kind = process.argv[2] || 'heuristic';

try {
  printDecision(runCliDecision(kind, readTurnFromStdin()));
} catch {
  printDecision({ action: 'fold', expression: '🙃' });
}
