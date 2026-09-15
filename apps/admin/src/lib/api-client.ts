export const API_URL = import.meta.env.VITE_API_URL;

interface ValidationIssue {
  path?: (string | number)[];
  message?: string;
}

export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

// Every validation-error response across this API shares one shape: { error: 'Validation
// failed', issues: [{ path, message }, ...] } — both @hono/zod-openapi's own defaultHook
// (createOpenApiApp) and the hand-rolled public form-submission validator produce it. The
// top-level `error` string alone ("Validation failed") told the admin user nothing about what
// was actually wrong, even though the API had already sent the real field-level detail — this
// folds that detail into the thrown error's own message so every existing `err.message` call
// site becomes descriptive for free, with no need to touch each one individually.
function formatValidationIssues(issues: unknown): string | null {
  if (!Array.isArray(issues) || issues.length === 0) return null;
  const parts = (issues as ValidationIssue[])
    .map((issue) => {
      const field = Array.isArray(issue.path) && issue.path.length > 0 ? issue.path.join('.') : null;
      const message = typeof issue.message === 'string' ? issue.message : null;
      if (field && message) return `${field}: ${message}`;
      return field ?? message;
    })
    .filter((part): part is string => Boolean(part));
  return parts.length > 0 ? parts.join('; ') : null;
}

async function handleResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    const baseMessage =
      body && typeof body === 'object' && 'error' in body && typeof body.error === 'string'
        ? body.error
        : `Request failed with status ${response.status}`;
    const issueDetail =
      body && typeof body === 'object' && 'issues' in body ? formatValidationIssues(body.issues) : null;
    const message = issueDetail ? `${baseMessage}: ${issueDetail}` : baseMessage;
    throw new ApiError(response.status, message);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...init?.headers,
    },
  });
  return handleResponse<T>(response);
}

export const apiClient = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body: unknown) =>
    request<T>(path, { method: 'POST', body: JSON.stringify(body) }),
  patch: <T>(path: string, body: unknown) =>
    request<T>(path, { method: 'PATCH', body: JSON.stringify(body) }),
  put: <T>(path: string, body: unknown) => request<T>(path, { method: 'PUT', body: JSON.stringify(body) }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
  // No Content-Type header here — fetch sets multipart/form-data with the correct boundary
  // itself when the body is a FormData instance, which request()'s default JSON header would
  // otherwise override incorrectly.
  upload: <T>(path: string, formData: FormData) =>
    fetch(`${API_URL}${path}`, { method: 'POST', credentials: 'include', body: formData }).then(
      (response) => handleResponse<T>(response),
    ),
};
