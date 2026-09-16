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
}

export interface EmailSender {
  send(message: EmailMessage): Promise<void>;
}
