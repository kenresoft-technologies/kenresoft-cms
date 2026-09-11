// Shared interactive-prompt helpers — originally lived only in scripts/setup.mjs, pulled out
// here once scripts/rename-worker.mjs also needed the same ask()/confirm() pair rather than a
// second, drifting copy.
//
// The readline interface is created lazily, on first actual use, rather than at module load —
// creating it eagerly attaches an open handle to process.stdin that keeps the process (and, more
// immediately, `node --test`) alive even for a module that only imports pure helpers from a
// sibling file (e.g. configure.mjs's resolveInput()) and never prompts at all.
import { createInterface } from 'node:readline/promises';

let rl;
function getRl() {
  return (rl ??= createInterface({ input: process.stdin, output: process.stdout }));
}

export async function ask(question, defaultValue) {
  const suffix = defaultValue ? ` (${defaultValue})` : '';
  const answer = (await getRl().question(`${question}${suffix}: `)).trim();
  return answer || defaultValue || '';
}

export async function confirm(question, defaultYes) {
  const suffix = defaultYes ? 'Y/n' : 'y/N';
  const answer = (await getRl().question(`${question} [${suffix}] `)).trim().toLowerCase();
  if (!answer) return defaultYes;
  return answer === 'y' || answer === 'yes';
}

export function closePrompt() {
  rl?.close();
}

// Numbered-choice menu — used by setup.mjs's rerun summary and configure.mjs's per-field
// Keep/Change/Reset/Cancel prompts. `options` is [{ value, label }]; returns the chosen `value`.
export async function select(question, options) {
  console.log(`\n${question}`);
  options.forEach((option, index) => console.log(`  ${index + 1}) ${option.label}`));
  for (;;) {
    const answer = (await getRl().question(`Choice [1-${options.length}]: `)).trim();
    const index = Number(answer) - 1;
    if (Number.isInteger(index) && index >= 0 && index < options.length) return options[index].value;
    console.log(`Please enter a number between 1 and ${options.length}.`);
  }
}
