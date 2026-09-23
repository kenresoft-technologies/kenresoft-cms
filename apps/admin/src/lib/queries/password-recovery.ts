import { useQuery, useMutation } from '@tanstack/react-query';

import { apiClient } from '@/lib/api-client';

// All of these are unauthenticated by design (docs/ARCHITECTURE.md's recovery section) —
// apiClient's credentials:'include' doesn't matter here since there's no session to send yet.

// Backs the "email delivery isn't configured" notice on ForgotPasswordPage/
// RecoverWithCodePage — deployment-wide, not per-account, so it carries none of the
// enumeration risk the request/confirm routes below guard against with a generic response.
export function useSystemStatus() {
  return useQuery({
    queryKey: ['system', 'status'],
    queryFn: () =>
      apiClient.get<{ emailConfigured: boolean; authSecretConfigured: boolean; turnstileSiteKey: string | null }>(
        '/api/v1/system/status',
      ),
    // Was Infinity — an admin tab left open across a `pnpm run setup`/`update -- --turnstile`
    // reconfiguration kept showing the old cached value (e.g. Turnstile "Not set") until a hard
    // reload created a fresh QueryClient, even though the server was already correctly
    // reporting the new value. 30s keeps this cheap (a plain, uncached Worker read, no D1 hit)
    // while making Settings > API self-correct on its own without a manual reload.
    staleTime: 30_000,
  });
}

export function useRequestPasswordReset() {
  return useMutation({
    mutationFn: (email: string) =>
      apiClient.post<{ message: string }>('/api/v1/public/password-reset/request', { email }),
  });
}

export function useConfirmPasswordReset() {
  return useMutation({
    mutationFn: ({ token, newPassword }: { token: string; newPassword: string }) =>
      apiClient.post<{ message: string }>('/api/v1/public/password-reset/confirm', { token, newPassword }),
  });
}

export function useRedeemRecoveryCode() {
  return useMutation({
    mutationFn: (input: { email: string; code: string; newPassword: string }) =>
      apiClient.post<{ message: string }>('/api/v1/public/recovery/redeem', input),
  });
}
