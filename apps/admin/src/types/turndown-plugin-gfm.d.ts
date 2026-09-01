// turndown-plugin-gfm ships no types of its own — this covers the one export
// rich-text-markdown.ts actually uses.
declare module 'turndown-plugin-gfm' {
  import type TurndownService from 'turndown';

  export function gfm(service: TurndownService): void;
}
