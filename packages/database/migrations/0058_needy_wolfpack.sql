CREATE TABLE `integration_secrets` (
	`key` text PRIMARY KEY NOT NULL,
	`ciphertext` text NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
