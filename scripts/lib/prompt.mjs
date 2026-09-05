// Shared interactive-prompt helpers — originally lived only in scripts/setup.mjs, pulled out
// here once scripts/rename-worker.mjs also needed the same ask()/confirm() pair rather than a
// second, drifting copy.
import { createInterface } from 'node:readline/promises';

const rl = createInterface({ input: process.stdin, output: process.stdout });

export async function ask(question, defaultValue) {
  const suffix = defaultValue ? ` (${defaultValue})` : '';
  const answer = (await rl.question(`${question}${suffix}: `)).trim();
  return answer || defaultValue || '';
}

export async function confirm(question, defaultYes) {
  const suffix = defaultYes ? 'Y/n' : 'y/N';
  const answer = (await rl.question(`${question} [${suffix}] `)).trim().toLowerCase();
  if (!answer) return defaultYes;
  return answer === 'y' || answer === 'yes';
}

export function closePrompt() {
  rl.close();
}
