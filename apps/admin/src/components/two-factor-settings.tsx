import { useState } from 'react';
import { Copy, ShieldCheck, ShieldOff } from 'lucide-react';
import QRCode from 'qrcode';
import { toast } from 'sonner';

import { authClient } from '@/lib/auth-client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

function BackupCodesList({ codes }: { codes: string[] }) {
  function copyAll() {
    navigator.clipboard.writeText(codes.join('\n'));
    toast.success('Backup codes copied');
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-2 gap-1.5 rounded-lg border bg-muted/40 p-3 font-mono text-sm">
        {codes.map((code) => (
          <span key={code}>{code}</span>
        ))}
      </div>
      <Button type="button" variant="outline" size="sm" className="w-fit gap-1.5" onClick={copyAll}>
        <Copy className="size-3.5" />
        Copy all
      </Button>
      <p className="text-xs text-muted-foreground">
        Each code works once. Store them somewhere safe — this is the only time they're shown in
        full.
      </p>
    </div>
  );
}

// Enrollment is deliberately two steps, matching better-auth's own default
// (skipVerificationOnEnable: false, not overridden in apps/api/src/lib/auth-options.ts): enable()
// alone does not flip user.twoFactorEnabled on — only a subsequent successful verifyTotp() does,
// so a broken scan or typo can never leave someone's account "protected" by a code they can't
// actually produce.
function EnableTwoFactorDialog({ onOpenChange }: { onOpenChange: (open: boolean) => void }) {
  const [step, setStep] = useState<'password' | 'verify'>('password');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [totpURI, setTotpURI] = useState('');
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handlePasswordSubmit() {
    setIsSubmitting(true);
    setError(null);
    const { data, error: authError } = await authClient.twoFactor.enable({ password, issuer: 'Kenresoft CMS' });
    setIsSubmitting(false);

    if (authError || !data) {
      setError(authError?.message ?? 'Could not start enrollment — check your password.');
      return;
    }
    // enable() defaults to TOTP enrollment when `method` isn't passed (as here) — the `method:
    // 'otp'` branch only exists because better-auth's response type is a discriminated union
    // covering both enrollment kinds; this project deliberately only offers TOTP + backup codes.
    if (data.method !== 'totp') {
      setError('Unexpected enrollment method returned.');
      return;
    }

    setTotpURI(data.totpURI);
    setBackupCodes(data.backupCodes);
    setQrDataUrl(await QRCode.toDataURL(data.totpURI));
    setStep('verify');
  }

  async function handleVerifySubmit() {
    setIsSubmitting(true);
    setError(null);
    const { error: authError } = await authClient.twoFactor.verifyTotp({ code });
    setIsSubmitting(false);

    if (authError) {
      setError(authError.message ?? 'Invalid code — check your authenticator app and try again.');
      return;
    }

    toast.success('Two-factor authentication enabled');
    onOpenChange(false);
  }

  if (step === 'password') {
    return (
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Enable two-factor authentication</DialogTitle>
          <DialogDescription>Confirm your password to start setup.</DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            handlePasswordSubmit();
          }}
        >
          <div className="flex flex-col gap-2">
            <Label htmlFor="2fa-enable-password">Password</Label>
            <Input
              id="2fa-enable-password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </div>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <DialogFooter>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Checking…' : 'Continue'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    );
  }

  return (
    <DialogContent className="max-w-md">
      <DialogHeader>
        <DialogTitle>Scan this QR code</DialogTitle>
        <DialogDescription>
          Scan with an authenticator app (Google Authenticator, 1Password, Authy, ...), then enter
          the 6-digit code it shows.
        </DialogDescription>
      </DialogHeader>
      <div className="flex flex-col gap-4">
        {qrDataUrl ? (
          <img src={qrDataUrl} alt="Scan this QR code with your authenticator app" className="mx-auto size-48" />
        ) : null}
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer select-none">Can't scan? Enter this key manually</summary>
          <code className="mt-1 block break-all rounded bg-muted/40 p-2">{totpURI}</code>
        </details>
        <div className="flex flex-col gap-2">
          <Label className="text-sm font-medium">Backup codes</Label>
          <BackupCodesList codes={backupCodes} />
        </div>
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            handleVerifySubmit();
          }}
        >
          <div className="flex flex-col gap-2">
            <Label htmlFor="2fa-verify-code">Code from your app</Label>
            <Input
              id="2fa-verify-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="123456"
              required
              value={code}
              onChange={(event) => setCode(event.target.value)}
            />
          </div>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <DialogFooter>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Verifying…' : 'Verify and enable'}
            </Button>
          </DialogFooter>
        </form>
      </div>
    </DialogContent>
  );
}

function DisableTwoFactorDialog({ onOpenChange }: { onOpenChange: (open: boolean) => void }) {
  const [password, setPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    setIsSubmitting(true);
    setError(null);
    const { error: authError } = await authClient.twoFactor.disable({ password });
    setIsSubmitting(false);

    if (authError) {
      setError(authError.message ?? 'Could not disable — check your password.');
      return;
    }

    toast.success('Two-factor authentication disabled');
    onOpenChange(false);
  }

  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Disable two-factor authentication</DialogTitle>
        <DialogDescription>
          Your account will only need a password to sign in afterward. Confirm your password to
          continue.
        </DialogDescription>
      </DialogHeader>
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          handleSubmit();
        }}
      >
        <div className="flex flex-col gap-2">
          <Label htmlFor="2fa-disable-password">Password</Label>
          <Input
            id="2fa-disable-password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </div>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <DialogFooter>
          <Button type="submit" variant="destructive" disabled={isSubmitting}>
            {isSubmitting ? 'Disabling…' : 'Disable two-factor authentication'}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}

function RegenerateBackupCodesDialog({ onOpenChange }: { onOpenChange: (open: boolean) => void }) {
  const [password, setPassword] = useState('');
  const [codes, setCodes] = useState<string[] | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    setIsSubmitting(true);
    setError(null);
    const { data, error: authError } = await authClient.twoFactor.generateBackupCodes({ password });
    setIsSubmitting(false);

    if (authError || !data) {
      setError(authError?.message ?? 'Could not regenerate — check your password.');
      return;
    }
    setCodes(data.backupCodes);
  }

  if (codes) {
    return (
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New backup codes</DialogTitle>
          <DialogDescription>Your old backup codes no longer work.</DialogDescription>
        </DialogHeader>
        <BackupCodesList codes={codes} />
        <DialogFooter>
          <Button type="button" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    );
  }

  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Regenerate backup codes</DialogTitle>
        <DialogDescription>
          This invalidates your existing backup codes. Confirm your password to continue.
        </DialogDescription>
      </DialogHeader>
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          handleSubmit();
        }}
      >
        <div className="flex flex-col gap-2">
          <Label htmlFor="2fa-regen-password">Password</Label>
          <Input
            id="2fa-regen-password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </div>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <DialogFooter>
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? 'Regenerating…' : 'Regenerate codes'}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}

export function TwoFactorSettings({ enabled }: { enabled: boolean }) {
  const [enableOpen, setEnableOpen] = useState(false);
  const [disableOpen, setDisableOpen] = useState(false);
  const [regenOpen, setRegenOpen] = useState(false);

  return (
    <div className="flex flex-col gap-3 rounded-lg border p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {enabled ? (
            <ShieldCheck className="size-4 text-success" />
          ) : (
            <ShieldOff className="size-4 text-muted-foreground" />
          )}
          <span className="text-sm font-medium">Two-factor authentication</span>
        </div>
        <Badge variant={enabled ? 'default' : 'secondary'}>{enabled ? 'Enabled' : 'Not enabled'}</Badge>
      </div>
      <p className="text-sm text-muted-foreground">
        {enabled
          ? 'Signing in also requires a code from your authenticator app.'
          : 'Require a code from an authenticator app in addition to your password when signing in.'}
      </p>
      <div className="flex gap-2">
        {enabled ? (
          <>
            <Dialog open={regenOpen} onOpenChange={setRegenOpen}>
              <DialogTrigger asChild>
                <Button type="button" variant="outline" size="sm">
                  Regenerate backup codes
                </Button>
              </DialogTrigger>
              <RegenerateBackupCodesDialog onOpenChange={setRegenOpen} />
            </Dialog>
            <Dialog open={disableOpen} onOpenChange={setDisableOpen}>
              <DialogTrigger asChild>
                <Button type="button" variant="outline" size="sm">
                  Disable
                </Button>
              </DialogTrigger>
              <DisableTwoFactorDialog onOpenChange={setDisableOpen} />
            </Dialog>
          </>
        ) : (
          <Dialog open={enableOpen} onOpenChange={setEnableOpen}>
            <DialogTrigger asChild>
              <Button type="button" size="sm">
                Enable two-factor authentication
              </Button>
            </DialogTrigger>
            <EnableTwoFactorDialog onOpenChange={setEnableOpen} />
          </Dialog>
        )}
      </div>
    </div>
  );
}
