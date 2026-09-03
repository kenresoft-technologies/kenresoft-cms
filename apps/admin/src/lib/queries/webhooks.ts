import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiClient } from '@/lib/api-client';
import type { Webhook, WebhookDelivery, WebhookEvent, WebhookWithSecret } from '@/lib/types';

const webhooksKey = ['webhooks'] as const;
const deliveriesKey = (webhookId: string) => ['webhooks', webhookId, 'deliveries'] as const;

export function useWebhooks() {
  return useQuery({
    queryKey: webhooksKey,
    queryFn: () => apiClient.get<Webhook[]>('/api/v1/admin/webhooks'),
  });
}

export function useWebhookDeliveries(webhookId: string | null) {
  return useQuery({
    queryKey: deliveriesKey(webhookId ?? ''),
    queryFn: () => apiClient.get<WebhookDelivery[]>(`/api/v1/admin/webhooks/${webhookId}/deliveries`),
    enabled: webhookId !== null,
  });
}

export interface WebhookInput {
  url: string;
  events: WebhookEvent[];
  contentTypeId: string | null;
  enabled?: boolean;
}

export function useCreateWebhook() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: WebhookInput) => apiClient.post<WebhookWithSecret>('/api/v1/admin/webhooks', input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: webhooksKey });
    },
  });
}

export function useUpdateWebhook() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, ...input }: Partial<WebhookInput> & { id: string }) =>
      apiClient.patch<Webhook>(`/api/v1/admin/webhooks/${id}`, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: webhooksKey });
    },
  });
}

export function useRegenerateWebhookSecret() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => apiClient.post<WebhookWithSecret>(`/api/v1/admin/webhooks/${id}/regenerate-secret`, {}),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: webhooksKey });
    },
  });
}

export function useDeleteWebhook() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => apiClient.delete<void>(`/api/v1/admin/webhooks/${id}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: webhooksKey });
    },
  });
}
