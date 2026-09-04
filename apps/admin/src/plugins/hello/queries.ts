import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiClient } from '@/lib/api-client';

export interface HelloGreeting {
  id: string;
  message: string;
  createdAt: string;
}

const greetingsKey = ['plugins', 'hello', 'greetings'] as const;

export function useHelloGreetings() {
  return useQuery({
    queryKey: greetingsKey,
    queryFn: () => apiClient.get<HelloGreeting[]>('/api/plugins/hello/v1/greetings'),
  });
}

export function useCreateHelloGreeting() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (message: string) =>
      apiClient.post<HelloGreeting>('/api/plugins/hello/v1/greetings', { message }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: greetingsKey });
    },
  });
}
