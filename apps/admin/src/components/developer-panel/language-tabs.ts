// Astro first — see @kenresoft-cms/astro, the only framework this CMS ships an actual client for.
// Shared across every Developer panel (content type, entry, form) so the tab set — and its
// order — can't drift between them.
export const LANGUAGE_TABS = [
  { value: 'astro', label: 'Astro' },
  { value: 'typescript', label: 'TypeScript' },
  { value: 'javascript', label: 'JavaScript' },
  { value: 'react', label: 'React' },
  { value: 'nextjs', label: 'Next.js' },
  { value: 'curl', label: 'cURL' },
] as const;
