import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiClient } from '@/lib/api-client';
import { authClient } from '@/lib/auth-client';
import type { AdminUser, Session, UserRole } from '@/lib/types';

const usersKey = ['users'] as const;
const sessionsKey = (userId: string) => ['users', userId, 'sessions'] as const;

export function useUsers() {
  return useQuery({
    queryKey: usersKey,
    queryFn: () => apiClient.get<AdminUser[]>('/api/v1/admin/users'),
  });
}

export function useUpdateUserRole() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, role }: { id: string; role: UserRole }) =>
      apiClient.patch<AdminUser>(`/api/v1/admin/users/${id}/role`, { role }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: usersKey });
      // The acting user may have just changed their own role — every admin-gating check
      // across the app (isAdmin, canManageFields, etc.) reads authClient.useSession()'s
      // client-cached session, not this query, and that cache only refreshes on its own
      // triggers (sign-in/out, a full reload, or an explicit getSession() call). Without
      // this, an admin who demotes themselves keeps seeing admin-only UI until they reload,
      // even though the server already treats every subsequent request as the new role.
      void authClient.getSession();
    },
  });
}

export function useCreateUser() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { name: string; email: string }) =>
      apiClient.post<{ user: AdminUser; temporaryPassword: string }>('/api/v1/admin/users', input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: usersKey });
    },
  });
}

export function useDeleteUser() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => apiClient.delete<void>(`/api/v1/admin/users/${id}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: usersKey });
    },
  });
}

export function useUserSessions(userId: string, enabled: boolean) {
  return useQuery({
    queryKey: sessionsKey(userId),
    queryFn: () => apiClient.get<Session[]>(`/api/v1/admin/users/${userId}/sessions`),
    enabled,
  });
}

export function useRevokeSession(userId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (sessionId: string) =>
      apiClient.delete<void>(`/api/v1/admin/users/${userId}/sessions/${sessionId}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: sessionsKey(userId) });
    },
  });
}

export function useUpdateUserDisabled() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, disabled }: { id: string; disabled: boolean }) =>
      apiClient.patch<AdminUser>(`/api/v1/admin/users/${id}/disabled`, { disabled }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: usersKey });
    },
  });
}

// A password re-check, not tied to any one action — the caller elevates, then attempts
// whatever elevation-gated action prompted it (disabling an admin, transferring ownership).
export function useElevate() {
  return useMutation({
    mutationFn: (password: string) =>
      apiClient.post<{ elevated: boolean }>('/api/v1/admin/security/elevate', { password }),
  });
}

export function useTransferOwnership() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (targetUserId: string) =>
      apiClient.post<AdminUser>('/api/v1/admin/security/ownership/transfer', { targetUserId }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: usersKey });
      // The acting user just relinquished ownership (or, for the target, gained it) — same
      // stale-client-session concern useUpdateUserRole's onSuccess already handles.
      void authClient.getSession();
    },
  });
}

const recoveryCodesKey = ['security', 'recovery-codes'] as const;

// How many of the caller's own recovery codes haven't been redeemed yet — never the codes
// themselves, which are only ever returned once, from useGenerateRecoveryCodes below.
export function useRecoveryCodesStatus() {
  return useQuery({
    queryKey: recoveryCodesKey,
    queryFn: () => apiClient.get<{ remaining: number }>('/api/v1/admin/security/recovery-codes'),
  });
}

export function useGenerateRecoveryCodes() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => apiClient.post<{ codes: string[] }>('/api/v1/admin/security/recovery-codes/generate', {}),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: recoveryCodesKey });
    },
  });
}

export function useRevokeRecoveryCodes() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => apiClient.delete<{ revoked: boolean }>('/api/v1/admin/security/recovery-codes'),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: recoveryCodesKey });
    },
  });
}
