// Pure argv parsing for scripts/update.mjs, split out so it's testable without importing
// configure.mjs (which pulls in wrangler-cli.mjs/deploy-helpers.mjs — real process-spawning
// modules) or update.mjs itself (a script whose module body runs `main()` on import).
export const CONFIGURE_CATEGORIES = ['auth', 'email', 'storage', 'database', 'domain'];

// Any single run only ever targets one configuration category — running two at once would make
// the resulting "what changed" summary ambiguous, and each category already has its own
// confirmation/warning flow meant to be read in isolation. `--branch` is mutually exclusive with
// a category flag for a different reason: it only applies to the plain code-pull update, not a
// standalone config change, which never touches git at all.
export function parseUpdateArgs(argv, env = process.env) {
  const ci = argv.includes('--ci');

  const categoryFlags = CONFIGURE_CATEGORIES.filter((category) => argv.includes(`--${category}`));
  if (categoryFlags.length > 1) {
    throw new Error(`Only one of ${CONFIGURE_CATEGORIES.map((c) => `--${c}`).join(', ')} may be given at a time.`);
  }
  const category = categoryFlags[0] ?? null;

  const branchFlagIndex = argv.findIndex((arg) => arg === '--branch' || arg.startsWith('--branch='));
  let branch;
  if (branchFlagIndex !== -1) {
    const flag = argv[branchFlagIndex];
    branch = flag.includes('=') ? flag.slice(flag.indexOf('=') + 1) : argv[branchFlagIndex + 1];
    if (!branch) throw new Error('--branch requires a value, e.g. --branch develop.');
  } else if (env.UPDATE_BRANCH) {
    branch = env.UPDATE_BRANCH;
  }
  if (branch && category) {
    throw new Error('--branch only applies to the plain code-pull update, not --auth/--email/--storage/--database.');
  }

  return { ci, branch: branch ?? null, category };
}
