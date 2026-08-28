import { useQuery } from '@tanstack/react-query';

import { apiClient } from '@/lib/api-client';

export interface OpenApiOperation {
  summary?: string;
  description?: string;
}

// Only the shape the Developer panel reads — the real document (served at
// /api/v1/openapi.json, see apps/api/src/index.ts) has far more on it.
export interface OpenApiDocument {
  paths?: Record<string, Partial<Record<'get' | 'post' | 'patch' | 'put' | 'delete', OpenApiOperation>>>;
}

// The aggregated OpenAPI document is the source of truth for which endpoints exist and what
// they do (docs/ARCHITECTURE.md §16) — fetching it here means the Developer panel can never
// drift from the API by hand-duplicating an endpoint registry.
export function useOpenApiDoc(enabled = true) {
  return useQuery({
    queryKey: ['openapi-document'],
    queryFn: () => apiClient.get<OpenApiDocument>('/api/v1/openapi.json'),
    staleTime: 5 * 60 * 1000,
    enabled,
  });
}

export function getOpenApiOperation(
  doc: OpenApiDocument | undefined,
  path: string,
  method: 'get' | 'post' | 'patch' | 'put' | 'delete',
): OpenApiOperation | undefined {
  return doc?.paths?.[path]?.[method];
}
