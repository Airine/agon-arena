#!/usr/bin/env node
import { makeHeuristicDecision, printDecision, readTurnFromStdin } from './decision-utils.mjs';

try {
  printDecision(makeHeuristicDecision(readTurnFromStdin()));
} catch {
  printDecision({ action: 'fold', expression: '🙃' });
}
