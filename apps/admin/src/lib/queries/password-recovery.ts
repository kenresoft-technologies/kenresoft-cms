import { useMutation } from '@tanstack/react-query';

import { apiClient } from '@/lib/api-client';

// All three of these are unauthenticated by design (docs/ARCHITECTURE.md's recovery section) —
// apiClient's credentials:'include' doesn't matter here since there's no session to send yet.

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
