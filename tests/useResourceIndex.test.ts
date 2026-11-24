import { describe, expect, it, vi } from 'vitest';

import {
  buildResourceIndexQuery,
  fetchResourceIndex,
  fetchListingResource,
  useResourceIndex,
  type ResourceIndexRequest,
} from '../src/useResourceIndex.js';

describe('buildResourceIndexQuery', () => {
  it('builds pagination, search, sorting and prefixed filters', () => {
    expect(
      buildResourceIndexQuery({
        pagination: true,
        page: 2,
        perPage: 25,
        search: '  dune  ',
        sort: '-created_at',
        nested: true,
        filters: {
          status: 'published',
          genres: ['drama', null, ''],
          empty: '',
        },
      }),
    ).toEqual({
      pagination: true,
      page: 2,
      perPage: 25,
      search: 'dune',
      sort: '-created_at',
      nested: true,
      'filter[status]': 'published',
      'filter[genres][]': ['drama'],
    });
  });

  it('uses limit and offset without pagination', () => {
    expect(
      buildResourceIndexQuery({
        limit: 10,
        offset: 20,
        filters: { status: 'published' },
        prefixFilters: false,
        query: { locale: 'fr' },
      }),
    ).toEqual({
      locale: 'fr',
      limit: 10,
      offset: 20,
      status: 'published',
    });
  });

  it('omits empty optional parameters and preserves a search filter key', () => {
    expect(
      buildResourceIndexQuery({
        search: '   ',
        sort: null,
        limit: null,
        offset: undefined,
        nested: false,
        filters: {
          search: 'exact',
          nil: null,
          missing: undefined,
          emptyArray: [null, undefined, ''],
        },
      }),
    ).toEqual({ search: 'exact' });
  });

  it('uses pagination defaults', () => {
    expect(buildResourceIndexQuery({ pagination: true })).toEqual({
      pagination: true,
      page: 1,
      perPage: 15,
    });
  });
});

describe('fetchResourceIndex', () => {
  it('merges generated query values after request defaults', async () => {
    const request = vi.fn<ResourceIndexRequest>().mockResolvedValue({ data: [] });

    await fetchResourceIndex(
      { url: '/api/movies', method: 'GET' },
      { page: 3, pagination: true },
      { query: { page: 1, locale: 'fr' } },
      request as ResourceIndexRequest,
    );

    expect(request).toHaveBeenCalledWith(
      { url: '/api/movies', method: 'GET' },
      undefined,
      { query: { page: 3, perPage: 15, pagination: true, locale: 'fr' } },
    );
  });

  it('normalizes a response without a Laravel resource wrapper', async () => {
    const request = vi.fn().mockResolvedValue([{ id: 1 }]);

    await expect(
      fetchResourceIndex(
        { url: '/api/movies', method: 'GET' },
        {},
        {},
        request as ResourceIndexRequest,
      ),
    ).resolves.toEqual({ data: [{ id: 1 }] });
  });
});

describe('fetchListingResource', () => {
  it('extracts resource index parameters from a listing query', async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: [] }), {
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetch);

    await fetchListingResource(
      { url: '/api/movies', method: 'GET' },
      {
        pagination: true,
        page: 2,
        perPage: 10,
        search: 'dune',
        sort: '-id',
        limit: 5,
        offset: 1,
        nested: true,
        locale: 'fr',
      },
      { status: 'published' },
      false,
    );

    const request = new URL(String(fetch.mock.calls[0]?.[0]), 'https://example.test');
    expect(Object.fromEntries(request.searchParams)).toMatchObject({
      pagination: 'true',
      page: '2',
      perPage: '10',
      search: 'dune',
      sort: '-id',
      nested: 'true',
      locale: 'fr',
      status: 'published',
    });
  });
});

describe('useResourceIndex', () => {
  it('keeps the latest response when requests finish out of order', async () => {
    const resolvers: Array<(value: { data: Array<{ id: number }> }) => void> = [];
    const request = vi.fn<ResourceIndexRequest>().mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvers.push(resolve);
        }),
    );
    const resource = useResourceIndex<{ id: number }>({
      autoFetch: false,
      controller: () => ({ url: '/api/movies', method: 'GET' }),
      request: request as ResourceIndexRequest,
    });

    const first = resource.fetch();
    const second = resource.fetch();
    resolvers[1]?.({ data: [{ id: 2 }] });
    await second;
    resolvers[0]?.({ data: [{ id: 1 }] });
    await first;

    expect(resource.items.value).toEqual([{ id: 2 }]);
    expect(resource.loading.value).toBe(false);
  });

  it('does not let a stale failure clear the latest response', async () => {
    const resolvers: Array<{
      resolve: (value: { data: Array<{ id: number }> }) => void;
      reject: (reason: Error) => void;
    }> = [];
    const request = vi.fn(
      () =>
        new Promise((resolve, reject) => {
          resolvers.push({ resolve, reject });
        }),
    );
    const resource = useResourceIndex<{ id: number }>({
      autoFetch: false,
      controller: () => ({ url: '/api/movies', method: 'GET' }),
      request: request as ResourceIndexRequest,
    });

    const first = resource.fetch();
    const second = resource.fetch();
    resolvers[1]?.resolve({ data: [{ id: 2 }] });
    await second;
    resolvers[0]?.reject(new Error('stale'));
    await expect(first).rejects.toThrow('stale');

    expect(resource.items.value).toEqual([{ id: 2 }]);
    expect(resource.error.value).toBeNull();
  });

  it('exposes a failed request and clears stale response data', async () => {
    const request = vi
      .fn<ResourceIndexRequest>()
      .mockResolvedValueOnce({ data: [{ id: 1 }], meta: { total: 1 } })
      .mockRejectedValueOnce(new Error('Unavailable'));
    const resource = useResourceIndex<{ id: number }>({
      autoFetch: false,
      controller: () => ({ url: '/api/movies', method: 'GET' }),
      request: request as ResourceIndexRequest,
    });

    await resource.fetch();
    await expect(resource.fetch()).rejects.toThrow('Unavailable');

    expect(resource.error.value).toBe('Unavailable');
    expect(resource.items.value).toEqual([]);
    expect(resource.meta.value).toBeNull();
  });

  it('maps response data and exposes links and extra fields', async () => {
    const request = vi.fn().mockResolvedValue({
      data: [{ id: 1 }],
      meta: { total: 1 },
      links: { next: '/page/2' },
      custom: true,
    });
    const resource = useResourceIndex<{ id: number }>({
      autoFetch: false,
      controller: () => ({ url: '/api/movies', method: 'GET' }),
      request: request as ResourceIndexRequest,
      pagination: true,
      initialPage: 2,
      initialPerPage: 20,
      initialSearch: 'dune',
      initialSort: '-id',
      initialFilters: { status: 'published' },
      initialLimit: 10,
      initialOffset: 5,
      initialNested: true,
      prefixFilters: false,
      query: { locale: 'fr' },
      requestOptions: { headers: { 'X-Test': 'yes' } },
      mapItems: (items) => items.map((item) => ({ id: item.id + 1 })),
    });

    await expect(resource.fetch()).resolves.toEqual([{ id: 2 }]);

    expect(resource.items.value).toEqual([{ id: 2 }]);
    expect(resource.meta.value).toEqual({ total: 1 });
    expect(resource.links.value).toEqual({ next: '/page/2' });
    expect(resource.extras.value).toEqual({ custom: true });
    expect(resource.hasPagination.value).toBe(true);
  });

  it('updates every query control', () => {
    const resource = useResourceIndex({
      autoFetch: false,
      controller: () => ({ url: '/api/movies', method: 'GET' }),
    });

    resource.setPage(-1);
    resource.setPerPage(0);
    resource.setSearch('alien');
    resource.setSort('title');
    resource.setFilter('status', 'published');
    resource.setFilters({ genre: ['drama'] });
    resource.setFilter('status', 'draft');
    resource.clearFilter('status');
    resource.setLimit(50);
    resource.setOffset(10);
    resource.setNested(true);

    expect(resource.page.value).toBe(1);
    expect(resource.perPage.value).toBe(1);
    expect(resource.search.value).toBe('alien');
    expect(resource.sort.value).toBe('title');
    expect(resource.filters.value).toEqual({ genre: ['drama'] });
    expect(resource.limit.value).toBe(50);
    expect(resource.offset.value).toBe(10);
    expect(resource.nested.value).toBe(true);

    resource.resetFilters();
    expect(resource.filters.value).toEqual({});
  });

  it('normalizes malformed data and non-Error failures', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({ data: null })
      .mockRejectedValueOnce('offline');
    const resource = useResourceIndex({
      autoFetch: false,
      controller: () => ({ url: '/api/movies', method: 'GET' }),
      request: request as ResourceIndexRequest,
    });

    await expect(resource.fetch()).resolves.toEqual([]);
    expect(resource.extras.value).toBeNull();
    await expect(resource.fetch()).rejects.toBe('offline');
    expect(resource.error.value).toBe('request_failed');
  });

  it('fetches automatically by default and absorbs the startup failure', async () => {
    const request = vi.fn().mockRejectedValue(new Error('offline'));
    const resource = useResourceIndex({
      controller: () => ({ url: '/api/movies', method: 'GET' }),
      request: request as ResourceIndexRequest,
    });

    await vi.waitFor(() => expect(resource.loading.value).toBe(false));
    expect(resource.error.value).toBe('offline');
  });
});
