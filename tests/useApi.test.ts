import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useApi } from '../src/useApi.js';

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('useApi', () => {
  beforeEach(() => {
    document.cookie = 'XSRF-TOKEN=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('requests JSON with the configured base URL', async () => {
    const fetch = vi.fn().mockResolvedValue(jsonResponse({ id: 1 }));
    vi.stubGlobal('fetch', fetch);
    const api = useApi({ baseUrl: '/app' });

    await expect(
      api.request<{ id: number }>({ url: '/api/movies/1', method: 'get' }),
    ).resolves.toEqual({ id: 1 });

    expect(fetch).toHaveBeenCalledOnce();
    expect(String(fetch.mock.calls[0]?.[0])).toBe('/app/api/movies/1');
  });

  it('gets a CSRF cookie and sends its decoded value on writes', async () => {
    const fetch = vi.fn().mockImplementation((request: RequestInfo | URL) => {
      if (String(request).endsWith('/sanctum/csrf-cookie')) {
        document.cookie = 'XSRF-TOKEN=token%20value; path=/';
        return Promise.resolve(new Response(null, { status: 204 }));
      }

      return Promise.resolve(jsonResponse({ saved: true }));
    });
    vi.stubGlobal('fetch', fetch);
    const api = useApi();

    await expect(api.post('/api/movies', { title: 'Dune' })).resolves.toEqual({
      saved: true,
    });

    expect(fetch).toHaveBeenCalledTimes(2);
    const options = fetch.mock.calls[1]?.[1] as RequestInit;
    expect(new Headers(options.headers).get('X-XSRF-TOKEN')).toBe('token value');
  });

  it.each(['PUT', 'PATCH'])('spoofs %s requests containing FormData', async (method) => {
    document.cookie = 'XSRF-TOKEN=token; path=/';
    const fetch = vi.fn().mockResolvedValue(jsonResponse({ saved: true }));
    vi.stubGlobal('fetch', fetch);
    const body = new FormData();
    body.set('title', 'Dune');

    const api = useApi();
    const result =
      method === 'PUT'
        ? api.put('/api/movies/1', body)
        : api.patch('/api/movies/1', body);
    await result;

    const options = fetch.mock.calls[0]?.[1] as RequestInit;
    expect(options.method).toBe('POST');
    expect((options.body as FormData).get('_method')).toBe(method);
    expect((options.body as FormData).get('title')).toBe('Dune');
  });

  it('renews the CSRF cookie and retries once after a 419', async () => {
    document.cookie = 'XSRF-TOKEN=old; path=/';
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ message: 'expired' }, 419))
      .mockImplementationOnce(() => {
        document.cookie = 'XSRF-TOKEN=new; path=/';
        return Promise.resolve(new Response(null, { status: 204 }));
      })
      .mockResolvedValueOnce(jsonResponse({ saved: true }));
    vi.stubGlobal('fetch', fetch);

    await expect(useApi().del('/api/movies/1')).resolves.toEqual({ saved: true });
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('adds refresh details to hash conflicts', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({ hash: 'new-hash', errors: { title: ['Invalid'] } }, 409),
      ),
    );

    await expect(
      useApi().request({ url: '/api/movies', method: 'GET' }),
    ).rejects.toMatchObject({
      data: {
        errors: {
          title: ['Invalid'],
          hash: 'new-hash',
          needRefresh: true,
        },
      },
    });
  });

  it('returns null only for unauthorized safe requests', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ message: 'unauthorized' }, 401))
      .mockResolvedValueOnce(jsonResponse({ id: 1 }))
      .mockResolvedValueOnce(jsonResponse({ message: 'missing' }, 404));
    vi.stubGlobal('fetch', fetch);
    const api = useApi();

    await expect(api.safe('/api/me')).resolves.toBeNull();
    await expect(api.safe('/api/me')).resolves.toEqual({ id: 1 });
    await expect(api.safe('/api/missing')).rejects.toMatchObject({
      response: { status: 404 },
    });
  });

  it('returns discriminated safe request results', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ id: 1 }, 201))
      .mockResolvedValueOnce(jsonResponse({ message: 'invalid' }, 422));
    vi.stubGlobal('fetch', fetch);
    const api = useApi();

    await expect(
      api.safeRequest({ url: '/api/movies', method: 'GET' }),
    ).resolves.toEqual({ ok: true, data: { id: 1 }, status: 201 });
    await expect(
      api.safeRequest({ url: '/api/movies', method: 'GET' }),
    ).resolves.toMatchObject({
      ok: false,
      data: { message: 'invalid' },
      status: 422,
    });
  });

  it('reports status zero when an HTTP request has no response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network')));

    await expect(
      useApi().safeRequest({ url: '/api/movies', method: 'GET' }),
    ).resolves.toMatchObject({ ok: false, status: 0 });
  });

  it('supports api options and the remaining method helpers', async () => {
    document.cookie = 'XSRF-TOKEN=token; path=/';
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ api: true }))
      .mockResolvedValueOnce(jsonResponse({ put: true }))
      .mockResolvedValueOnce(jsonResponse({ patch: true }));
    vi.stubGlobal('fetch', fetch);
    const api = useApi();

    await expect(
      api.api('/api/movies', { method: 'HEAD', headers: { 'X-Test': 'yes' } }),
    ).resolves.toBeUndefined();
    await expect(api.put('/api/movies/1', { title: 'A' })).resolves.toEqual({
      put: true,
    });
    await expect(api.patch('/api/movies/1', { title: 'B' })).resolves.toEqual({
      patch: true,
    });
  });

  it('can initiate a write when document is unavailable', async () => {
    vi.stubGlobal('document', undefined);
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(jsonResponse({ saved: true }));
    vi.stubGlobal('fetch', fetch);

    await expect(useApi().post('/api/movies')).resolves.toEqual({ saved: true });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('rethrows non-HTTP failures from safeRequest', async () => {
    vi.stubGlobal(
      'Headers',
      class {
        constructor() {
          throw new Error('headers unavailable');
        }
      },
    );

    await expect(
      useApi().safeRequest({ url: '/api/movies', method: 'GET' }),
    ).rejects.toThrow('headers unavailable');
  });
});
