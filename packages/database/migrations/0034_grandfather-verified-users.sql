-- Custom SQL migration file, put your code below! --
-- One-time grandfathering for the new staff email-verification requirement
-- (apps/api/src/lib/auth-options.ts's requireEmailVerification). Every user row created before
-- this migration predates the concept entirely — `email_verified` has never been set true
-- anywhere in this codebase's history, so applying the new gate retroactively would lock every
-- existing deployment's users, including real production owners, out on their very next sign-in.
-- This is a deliberate, one-time compatibility decision for pre-existing accounts, not a
-- general policy: only rows that already existed when this migration ran are affected. Every
-- account created after this point (self-signup or Add User) starts unverified as designed.
UPDATE `user` SET `email_verified` = 1 WHERE `email_verified` = 0;