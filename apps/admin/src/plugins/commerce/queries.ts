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

// Phase 2b — Cart & Customer. Customer PII (email/address/phone) is admin-role-gated on the API
// side (stricter than catalog's editor floor); these hooks call the same routes, gating is
// enforced server-side regardless of what the UI shows.

export interface CommerceCustomerSummary {
  id: string;
  email: string;
  name: string;
  phone: string | null;
  emailVerified: boolean;
  disabled: boolean;
  createdAt: string;
}

export interface CommerceCustomerAddress {
  id: string;
  label: string | null;
  recipientName: string;
  line1: string;
  line2: string | null;
  city: string;
  region: string | null;
  postalCode: string;
  country: string;
  phone: string | null;
  isDefault: boolean;
}

export interface CommerceCustomerDetail extends CommerceCustomerSummary {
  addresses: CommerceCustomerAddress[];
}

const customersKey = ['plugins', 'commerce', 'customers'] as const;

function customerByIdKey(customerId: string) {
  return ['plugins', 'commerce', 'customers', 'by-id', customerId] as const;
}

export function useCommerceCustomers(search?: string) {
  return useQuery({
    queryKey: [...customersKey, search ?? ''],
    queryFn: () => {
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      return apiClient.get<CommerceCustomerSummary[]>(`${BASE}/customers?${params.toString()}`);
    },
  });
}

export function useCommerceCustomer(customerId: string) {
  return useQuery({
    queryKey: customerByIdKey(customerId),
    queryFn: () => apiClient.get<CommerceCustomerDetail>(`${BASE}/customers/${customerId}`),
    enabled: Boolean(customerId),
  });
}

export function useUpdateCommerceCustomerDisabled(customerId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (disabled: boolean) =>
      apiClient.patch<CommerceCustomerSummary>(`${BASE}/customers/${customerId}`, { disabled }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: customersKey });
      void queryClient.invalidateQueries({ queryKey: customerByIdKey(customerId) });
    },
  });
}

// Phase 2c — Checkout & Orders. Editor-gated on the API side (matching catalog, not
// admin-customers.ts's stricter admin floor — see routes/admin-orders.ts's own comment).

export type CommerceOrderStatus = 'pending' | 'paid' | 'fulfilled' | 'cancelled' | 'refunded';

export interface CommerceOrderSummary {
  id: string;
  customerId: string | null;
  customerEmail: string;
  customerName: string;
  status: CommerceOrderStatus;
  currency: string;
  totalAmount: number;
  createdAt: string;
}

export interface CommerceOrderItem {
  id: string;
  productId: string | null;
  variantId: string | null;
  productName: string;
  variantName: string | null;
  sku: string | null;
  unitPriceAtPurchase: number;
  quantity: number;
}

export interface CommerceOrderAddress {
  recipientName: string;
  line1: string;
  line2: string | null;
  city: string;
  region: string | null;
  postalCode: string;
  country: string;
  phone: string | null;
}

export interface CommerceOrderPaymentAttempt {
  id: string;
  provider: 'paystack';
  reference: string;
  status: 'pending' | 'success' | 'failed';
  amount: number | null;
  currency: string | null;
  createdAt: string;
  resolvedAt: string | null;
}

export interface CommerceOrderDetail extends CommerceOrderSummary {
  shippingAddress: CommerceOrderAddress;
  items: CommerceOrderItem[];
  payments: CommerceOrderPaymentAttempt[];
}

const ordersKey = ['plugins', 'commerce', 'orders'] as const;

function orderByIdKey(orderId: string) {
  return ['plugins', 'commerce', 'orders', 'by-id', orderId] as const;
}

export function useCommerceOrders(status?: CommerceOrderStatus) {
  return useQuery({
    queryKey: [...ordersKey, status ?? ''],
    queryFn: () => {
      const params = new URLSearchParams();
      if (status) params.set('status', status);
      return apiClient.get<CommerceOrderSummary[]>(`${BASE}/orders?${params.toString()}`);
    },
  });
}

export function useCommerceOrder(orderId: string) {
  return useQuery({
    queryKey: orderByIdKey(orderId),
    queryFn: () => apiClient.get<CommerceOrderDetail>(`${BASE}/orders/${orderId}`),
    enabled: Boolean(orderId),
  });
}

export function useUpdateCommerceOrderStatus(orderId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (status: CommerceOrderStatus) => apiClient.patch<CommerceOrderSummary>(`${BASE}/orders/${orderId}/status`, { status }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ordersKey });
      void queryClient.invalidateQueries({ queryKey: orderByIdKey(orderId) });
    },
  });
}
