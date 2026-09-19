import { useState } from 'react';
import { toast } from 'sonner';

import { ApiError } from '@/lib/api-client';
import { useUpdateSettings } from '@/lib/queries/settings';
import type { Settings } from '@/lib/types';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SettingsSaveBar, SettingsSection, toSettingsInput } from '@/pages/settings/shared';

interface SectionProps {
  settings: Settings | null;
  readOnly: boolean;
}

// Optional From identity for admin-initiated mail only; system mail (password reset,
// verification) always uses EMAIL_FROM. Replies go to the sending staff member's own address.
export function EmailSenderSettings({ settings, readOnly }: SectionProps) {
  const updateSettings = useUpdateSettings();

  const [name, setName] = useState(settings?.emailSenderName ?? '');
  const [savedName, setSavedName] = useState(settings?.emailSenderName ?? '');
  const [email, setEmail] = useState(settings?.emailSenderEmail ?? '');
  const [savedEmail, setSavedEmail] = useState(settings?.emailSenderEmail ?? '');
  const [error, setError] = useState<string | null>(null);

  const dirty = name !== savedName || email !== savedEmail;

  async function handleSave() {
    setError(null);
    const trimmedName = name.trim();
    const trimmedEmail = email.trim();
    if (trimmedEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      setError('Sender email must be a valid email address');
      return;
    }
    try {
      await updateSettings.mutateAsync({
        ...toSettingsInput(settings),
        emailSenderName: trimmedName || null,
        emailSenderEmail: trimmedEmail || null,
      });
      setName(trimmedName);
      setSavedName(trimmedName);
      setEmail(trimmedEmail);
      setSavedEmail(trimmedEmail);
      toast.success('Settings saved');
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to save settings';
      setError(message);
      toast.error(message);
    }
  }

  return (
    <SettingsSection
      title="Email sender"
      description="The From identity for emails staff send from the CMS, such as replies to form submissions. Leave blank to use the deployment's default sender."
      footer={
        <SettingsSaveBar
          dirty={dirty}
          pending={updateSettings.isPending}
          readOnly={readOnly}
          onSave={() => void handleSave()}
          onDiscard={() => {
            setName(savedName);
            setEmail(savedEmail);
            setError(null);
          }}
        />
      }
    >
      <div className="flex flex-col gap-2">
        <Label htmlFor="settings-email-sender-name">Sender name</Label>
        <Input
          id="settings-email-sender-name"
          placeholder="Acme Support"
          disabled={readOnly}
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="settings-email-sender-email">Sender email</Label>
        <Input
          id="settings-email-sender-email"
          type="email"
          placeholder="hello@yourdomain.com"
          disabled={readOnly}
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
        <p className="text-sm text-muted-foreground">
          The sender's domain must be verified with your email provider (Resend: a verified domain;
          Cloudflare Email Service: a domain onboarded for Email Sending), or delivery will fail.
          Replies go to the sending staff member's own email address, so they arrive in their normal
          mailbox. System emails (password reset, verification) are not affected.
        </p>
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </SettingsSection>
  );
}
