# Governance

Kenresoft CMS is maintained by **Kenresoft Technologies Ltd.** This document describes how
decisions get made today, and how that's expected to evolve as the project and its contributor
base grow.

## Current model

The project is currently maintained by a small core team at Kenresoft Technologies, who:

- Review and merge pull requests.
- Triage issues and security reports.
- Set architectural direction (recorded in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md), whose
  Changelog section is the authoritative record of design decisions and why they were made).
- Cut releases.

This is a lightweight, benevolent-maintainer model, not a formal foundation or committee
structure — appropriate for the project's current size. As the external contributor base grows,
this document will be updated to reflect a more formal process (e.g., a documented path to
becoming a maintainer, a defined RFC process for larger changes).

## Decision-making

- **Day-to-day changes** (bug fixes, small features, docs): reviewed and merged by any
  maintainer.
- **Architectural changes** (new domain concepts, breaking API changes, changes to the security
  model): require discussion in an issue first and sign-off from a Kenresoft Technologies
  maintainer before implementation, per [`CONTRIBUTING.md`](CONTRIBUTING.md).
- **Disagreements**: where consensus can't be reached, Kenresoft Technologies has final say, as
  the project's steward and the entity responsible for its long-term maintenance and the
  `@kenresoft-cms` npm scope.

## Becoming a maintainer

There's no formal process yet. Consistent, high-quality contributions and engagement with issues
and reviews are how anyone becomes a candidate — reach out if you're interested in taking on more
responsibility.

## Trademark

"Kenresoft," "Kenresoft CMS," and associated logos are trademarks of Kenresoft Technologies Ltd.
This open-source license grants rights to use, modify, and redistribute the *software*; it does
not grant rights to use the Kenresoft name or branding in a way that implies endorsement or
affiliation. A formal trademark policy is a planned addition — flagged here rather than left
unaddressed.
