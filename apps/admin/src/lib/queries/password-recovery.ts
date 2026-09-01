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
    queryFn: () => apiClient.get<{ emailConfigured: boolean }>('/api/v1/system/status'),
    staleTime: Infinity,
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
