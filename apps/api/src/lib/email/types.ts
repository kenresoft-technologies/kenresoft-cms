export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
  // Set when a message is a reply sent on a real person's behalf (form-submission-replies.ts)
  // rather than a system notification — so the recipient's own reply lands in that person's
  // real inbox rather than the deployment's configured EMAIL_FROM, which may not even be a
  // monitored mailbox.
  replyTo?: string;
  // Overrides the provider's default From (EMAIL_FROM). Only set for admin-initiated mail, from
  // the configured sender identity; system mail leaves it unset.
  from?: string;
  // Provider-agnostic; each provider maps this to its own wire format. Already validated and
  // size-limited by collectAttachments() before it gets here.
  attachments?: EmailAttachment[];
}

export interface EmailAttachment {
  filename: string;
  contentType: string;
  content: Uint8Array;
  // Set when the file came from the Media Library (recorded in the reply log; providers ignore).
  mediaId?: string;
}

export interface EmailSender {
  send(message: EmailMessage): Promise<void>;
}
