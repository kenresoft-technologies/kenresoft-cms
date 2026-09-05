import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiClient } from '@/lib/api-client';

const BASE = '/api/plugins/commerce/v1';

export type CommerceCategoryStatus = 'active' | 'archived';
export type CommerceProductStatus = 'draft' | 'published';
export type CommerceProductType = 'physical' | 'digital' | 'service';

export interface CommerceCategory {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  parentId: string | null;
  imageId: string | null;
  status: CommerceCategoryStatus;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface CommerceProduct {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  shortDescription: string | null;
  status: CommerceProductStatus;
  productType: CommerceProductType;
  basePrice: number;
  currency: string;
  sku: string | null;
  categoryId: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export interface CommerceProductVariant {
  id: string;
  productId: string;
  name: string;
  sku: string | null;
  price: number | null;
  compareAtPrice: number | null;
  stockQty: number;
  status: CommerceCategoryStatus;
  attributes: Record<string, string> | null;
  createdAt: string;
  updatedAt: string;
}

export interface CommerceProductImage {
  id: string;
  productId: string;
  mediaId: string;
  sortOrder: number;
  altText: string | null;
  createdAt: string;
}

export interface CommerceProductDetail extends CommerceProduct {
  variants: CommerceProductVariant[];
  images: CommerceProductImage[];
}

export interface CommerceSettings {
  storeName: string;
  defaultCurrency: string;
}

export interface CommerceProductFilters {
  status?: CommerceProductStatus | undefined;
  categoryId?: string | undefined;
}

const categoriesKey = ['plugins', 'commerce', 'categories'] as const;
const productsKey = ['plugins', 'commerce', 'products'] as const;
const settingsKey = ['plugins', 'commerce', 'settings'] as const;

function productByIdKey(productId: string) {
  return ['plugins', 'commerce', 'products', 'by-id', productId] as const;
}

function buildProductQuery(filters: CommerceProductFilters): string {
  const params = new URLSearchParams();
  if (filters.status) params.set('status', filters.status);
  if (filters.categoryId) params.set('categoryId', filters.categoryId);
  return params.toString();
}

export function useCommerceCategories() {
  return useQuery({
    queryKey: categoriesKey,
    queryFn: () => apiClient.get<CommerceCategory[]>(`${BASE}/categories`),
  });
}

export function useCreateCommerceCategory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      name: string;
      slug: string;
      description?: string | null;
      parentId?: string | null;
      status?: CommerceCategoryStatus;
      sortOrder?: number;
    }) => apiClient.post<CommerceCategory>(`${BASE}/categories`, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: categoriesKey });
    },
  });
}

export function useUpdateCommerceCategory(categoryId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      name?: string;
      slug?: string;
      description?: string | null;
      parentId?: string | null;
      status?: CommerceCategoryStatus;
      sortOrder?: number;
    }) => apiClient.patch<CommerceCategory>(`${BASE}/categories/${categoryId}`, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: categoriesKey });
    },
  });
}

export function useDeleteCommerceCategory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (categoryId: string) => apiClient.delete<void>(`${BASE}/categories/${categoryId}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: categoriesKey });
    },
  });
}

export function useCommerceProducts(filters: CommerceProductFilters = {}) {
  return useQuery({
    queryKey: [...productsKey, filters],
    queryFn: () => apiClient.get<CommerceProduct[]>(`${BASE}/products?${buildProductQuery(filters)}`),
  });
}

export function useCommerceProduct(productId: string) {
  return useQuery({
    queryKey: productByIdKey(productId),
    queryFn: () => apiClient.get<CommerceProductDetail>(`${BASE}/products/${productId}`),
    enabled: Boolean(productId),
  });
}

export function useCreateCommerceProduct() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      name: string;
      slug: string;
      description?: string | null;
      shortDescription?: string | null;
      status?: CommerceProductStatus;
      productType?: CommerceProductType;
      basePrice: number;
      currency: string;
      sku?: string | null;
      categoryId?: string | null;
    }) => apiClient.post<CommerceProduct>(`${BASE}/products`, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: productsKey });
    },
  });
}

export function useUpdateCommerceProduct(productId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      name?: string;
      slug?: string;
      description?: string | null;
      shortDescription?: string | null;
      status?: CommerceProductStatus;
      productType?: CommerceProductType;
      basePrice?: number;
      currency?: string;
      sku?: string | null;
      categoryId?: string | null;
    }) => apiClient.patch<CommerceProduct>(`${BASE}/products/${productId}`, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: productsKey });
      void queryClient.invalidateQueries({ queryKey: productByIdKey(productId) });
    },
  });
}

export function useDeleteCommerceProduct() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (productId: string) => apiClient.delete<void>(`${BASE}/products/${productId}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: productsKey });
    },
  });
}

export function useCreateCommerceVariant(productId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      name: string;
      sku?: string | null;
      price?: number | null;
      compareAtPrice?: number | null;
      stockQty?: number;
      status?: CommerceCategoryStatus;
      attributes?: Record<string, string> | null;
    }) => apiClient.post<CommerceProductVariant>(`${BASE}/products/${productId}/variants`, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: productByIdKey(productId) });
    },
  });
}

export function useUpdateCommerceVariant(productId: string, variantId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      name?: string;
      sku?: string | null;
      price?: number | null;
      compareAtPrice?: number | null;
      stockQty?: number;
      status?: CommerceCategoryStatus;
      attributes?: Record<string, string> | null;
    }) => apiClient.patch<CommerceProductVariant>(`${BASE}/products/${productId}/variants/${variantId}`, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: productByIdKey(productId) });
    },
  });
}

export function useDeleteCommerceVariant(productId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (variantId: string) => apiClient.delete<void>(`${BASE}/products/${productId}/variants/${variantId}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: productByIdKey(productId) });
    },
  });
}

export function useAddCommerceProductImage(productId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { mediaId: string; sortOrder?: number; altText?: string | null }) =>
      apiClient.post<CommerceProductImage>(`${BASE}/products/${productId}/images`, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: productByIdKey(productId) });
    },
  });
}

export function useRemoveCommerceProductImage(productId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (imageId: string) => apiClient.delete<void>(`${BASE}/products/${productId}/images/${imageId}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: productByIdKey(productId) });
    },
  });
}

export function useCommerceSettings() {
  return useQuery({
    queryKey: settingsKey,
    queryFn: () => apiClient.get<CommerceSettings>(`${BASE}/settings`),
  });
}

export function useUpdateCommerceSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CommerceSettings) => apiClient.put<CommerceSettings>(`${BASE}/settings`, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: settingsKey });
    },
  });
}
