import {
  $fetch,
  FetchError,
  type FetchOptions,
  type FetchResponse,
} from 'ofetch';

import { useBaseUrl } from './useBaseUrl.js';

export type ApiController = { url: string; method: string };
export type ApiOptions = Omit<FetchOptions<'json'>, 'method' | 'body'>;
export type ApiBody = FetchOptions<'json'>['body'];
export type ApiResult<T> =
  | { ok: true; data: T; status: number }
  | { ok: false; data: unknown; status: number; error: FetchError };

export type UseApiOptions = {
  baseUrl?: string;
};

export function useApi(options: UseApiOptions = {}) {
  const { url } = useBaseUrl(options.baseUrl);
  const client = $fetch.create({
    credentials: 'same-origin',
    retry: 0,
    headers: {
      Accept: 'application/json',
      'X-Requested-With': 'XMLHttpRequest',
    },
  });
  let csrfRequest: Promise<void> | undefined;

  function getCsrfToken(): string | undefined {
    if (typeof document === 'undefined') {
      return undefined;
    }

    const cookie = document.cookie
      .split('; ')
      .find((value) => value.startsWith('XSRF-TOKEN='));

    return cookie
      ? decodeURIComponent(cookie.slice('XSRF-TOKEN='.length))
      : undefined;
  }

  function ensureCsrfCookie(): Promise<void> {
    csrfRequest ??= client<void>(url('/sanctum/csrf-cookie')).finally(() => {
      csrfRequest = undefined;
    });

    return csrfRequest;
  }

  async function execute<T>(
    controller: ApiController,
    body?: ApiBody,
    options: ApiOptions = {},
    renewed = false,
  ): Promise<FetchResponse<T>> {
    const method = controller.method.toUpperCase();
    const writes = !['GET', 'HEAD', 'OPTIONS'].includes(method);
    if (writes && !getCsrfToken()) {
      await ensureCsrfCookie();
    }

    const headers = new Headers(options.headers);
    const token = writes ? getCsrfToken() : undefined;
    if (token) {
      headers.set('X-XSRF-TOKEN', token);
    }

    let requestMethod = method;
    let requestBody = body;
    if (body instanceof FormData && ['PUT', 'PATCH'].includes(method)) {
      const form = new FormData();
      for (const [key, value] of body.entries()) {
        form.append(key, value);
      }
      form.set('_method', method);
      requestMethod = 'POST';
      requestBody = form;
    }

    try {
      return await client.raw<T>(url(controller.url), {
        ...options,
        method: requestMethod,
        ...(writes && { body: requestBody }),
        headers,
      });
    } catch (error) {
      if (
        error instanceof FetchError &&
        error.response?.status === 419 &&
        !renewed
      ) {
        await ensureCsrfCookie();
        return execute<T>(controller, body, options, true);
      }
      if (
        error instanceof FetchError &&
        error.response?.status === 409 &&
        error.data?.hash !== undefined
      ) {
        error.data.errors = {
          ...error.data.errors,
          hash: error.data.hash,
          needRefresh: true,
        };
      }
      throw error;
    }
  }

  async function request<T>(
    controller: ApiController,
    body?: ApiBody,
    options?: ApiOptions,
  ): Promise<T> {
    const response = await execute<T>(controller, body, options);
    return response._data as T;
  }

  function api<T>(
    path: string,
    options: FetchOptions<'json'> = {},
  ): Promise<T> {
    const { method = 'GET', body, ...requestOptions } = options;
    return request<T>({ url: path, method }, body, requestOptions);
  }

  async function safe<T>(
    path: string,
    options?: FetchOptions<'json'>,
  ): Promise<T | null> {
    try {
      return await api<T>(path, options);
    } catch (error) {
      if (error instanceof FetchError && error.response?.status === 401) {
        return null;
      }
      throw error;
    }
  }

  async function safeRequest<T>(
    controller: ApiController,
    body?: ApiBody,
    options?: ApiOptions,
  ): Promise<ApiResult<T>> {
    try {
      const response = await execute<T>(controller, body, options);
      return { ok: true, data: response._data as T, status: response.status };
    } catch (error) {
      if (error instanceof FetchError) {
        return {
          ok: false,
          data: error.data,
          status: error.response?.status ?? 0,
          error,
        };
      }
      throw error;
    }
  }

  return {
    api,
    safe,
    request,
    safeRequest,
    ensureCsrfCookie,
    post: <T>(path: string, body?: ApiBody, options?: ApiOptions) =>
      request<T>({ url: path, method: 'POST' }, body, options),
    put: <T>(path: string, body?: ApiBody, options?: ApiOptions) =>
      request<T>({ url: path, method: 'PUT' }, body, options),
    patch: <T>(path: string, body?: ApiBody, options?: ApiOptions) =>
      request<T>({ url: path, method: 'PATCH' }, body, options),
    del: <T>(path: string, body?: ApiBody, options?: ApiOptions) =>
      request<T>({ url: path, method: 'DELETE' }, body, options),
  };
}
