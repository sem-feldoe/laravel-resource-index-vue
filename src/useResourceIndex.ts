import { computed, ref, shallowRef } from 'vue';

import {
  useApi,
  type ApiController,
  type ApiOptions,
} from './useApi.js';

export type QueryPrimitive = string | number | boolean | null | undefined;
export type FilterValue = QueryPrimitive | QueryPrimitive[];
export type ResourceIndexResponse<T> = {
  data: T[];
  meta?: Record<string, unknown>;
  links?: Record<string, unknown>;
  [key: string]: unknown;
};
export type ResourceIndexPayload<T> = ResourceIndexResponse<T> | T[];
export type ResourceIndexItem<TResponse> =
  TResponse extends readonly (infer TItem)[]
    ? TItem
    : TResponse extends { data: readonly (infer TItem)[] }
      ? TItem
      : never;

export type ResourceIndexParameters = {
  pagination?: boolean;
  page?: number;
  perPage?: number;
  search?: string;
  sort?: string | null;
  filters?: Record<string, FilterValue>;
  limit?: number | null;
  offset?: number | null;
  nested?: boolean;
  prefixFilters?: boolean;
  query?: Record<string, QueryPrimitive>;
};

export type ResourceIndexRequest = <T>(
  controller: ApiController,
  body?: never,
  options?: ApiOptions,
) => Promise<T>;

export type UseResourceIndexOptions<T> = {
  controller: () => ApiController;
  autoFetch?: boolean;
  pagination?: boolean;
  initialPage?: number;
  initialPerPage?: number;
  initialSearch?: string;
  initialSort?: string | null;
  initialFilters?: Record<string, FilterValue>;
  initialLimit?: number | null;
  initialOffset?: number | null;
  initialNested?: boolean;
  prefixFilters?: boolean;
  query?: Record<string, QueryPrimitive>;
  requestOptions?: ApiOptions;
  request?: ResourceIndexRequest;
  mapItems?: (items: T[]) => T[];
};

export function buildResourceIndexQuery(
  parameters: ResourceIndexParameters,
): Record<string, unknown> {
  const query: Record<string, unknown> = { ...parameters.query };
  if (parameters.pagination) {
    query.pagination = true;
    query.page = parameters.page ?? 1;
    query.perPage = parameters.perPage ?? 15;
  } else {
    if (parameters.limit !== null && parameters.limit !== undefined) {
      query.limit = parameters.limit;
    }
    if (parameters.offset !== null && parameters.offset !== undefined) {
      query.offset = parameters.offset;
    }
  }

  const search = parameters.search?.trim();
  if (search) {
    query.search = search;
  }
  if (parameters.sort) {
    query.sort = parameters.sort;
  }
  if (parameters.nested) {
    query.nested = true;
  }

  for (const [key, value] of Object.entries(parameters.filters ?? {})) {
    const values = Array.isArray(value)
      ? value.filter(
          (entry) =>
            entry !== null && entry !== undefined && `${entry}`.length > 0,
        )
      : value;
    if (
      values === null ||
      values === undefined ||
      `${values}`.length === 0 ||
      (Array.isArray(values) && values.length === 0)
    ) {
      continue;
    }

    const filterKey =
      key === 'search' || parameters.prefixFilters === false
        ? key
        : `filter[${key}]`;
    query[Array.isArray(values) ? `${filterKey}[]` : filterKey] = values;
  }

  return query;
}

export async function fetchResourceIndex<T>(
  controller: ApiController,
  parameters: ResourceIndexParameters,
  requestOptions: ApiOptions = {},
  request: ResourceIndexRequest = useApi().request,
): Promise<ResourceIndexResponse<T>> {
  const response = await request<ResourceIndexPayload<T>>(controller, undefined, {
    ...requestOptions,
    query: { ...requestOptions.query, ...buildResourceIndexQuery(parameters) },
  });

  return Array.isArray(response) ? { data: response } : response;
}

export function fetchListingResource<T>(
  controller: ApiController,
  parameters: Record<string, unknown>,
  filters: ResourceIndexParameters['filters'],
  prefixFilters = true,
): Promise<ResourceIndexResponse<T>> {
  const {
    pagination,
    page,
    perPage,
    search,
    sort,
    limit,
    offset,
    nested,
    ...query
  } = parameters as ResourceIndexParameters;

  return fetchResourceIndex<T>(controller, {
    pagination,
    page,
    perPage,
    search,
    sort,
    limit,
    offset,
    nested,
    filters,
    prefixFilters,
    query: query as ResourceIndexParameters['query'],
  });
}

export function useResourceIndex<T>(options: UseResourceIndexOptions<T>) {
  const request = options.request ?? useApi().request;
  const items = shallowRef<T[]>([]);
  const meta = shallowRef<Record<string, unknown> | null>(null);
  const links = shallowRef<Record<string, unknown> | null>(null);
  const extras = shallowRef<Record<string, unknown> | null>(null);
  const loading = ref(false);
  const error = ref<string | null>(null);
  const page = ref(options.initialPage ?? 1);
  const perPage = ref(options.initialPerPage ?? 15);
  const search = ref(options.initialSearch ?? '');
  const sort = ref<string | null>(options.initialSort ?? null);
  const filters = shallowRef<Record<string, FilterValue>>({
    ...options.initialFilters,
  });
  const limit = ref<number | null>(options.initialLimit ?? null);
  const offset = ref<number | null>(options.initialOffset ?? null);
  const nested = ref(options.initialNested ?? false);
  const hasPagination = computed(() => options.pagination ?? false);
  let requestId = 0;

  async function fetch(): Promise<T[]> {
    const currentRequest = ++requestId;
    loading.value = true;
    error.value = null;

    try {
      const response = await fetchResourceIndex<T>(
        options.controller(),
        {
          pagination: hasPagination.value,
          page: page.value,
          perPage: perPage.value,
          search: search.value,
          sort: sort.value,
          filters: filters.value,
          limit: limit.value,
          offset: offset.value,
          nested: nested.value,
          prefixFilters: options.prefixFilters,
          query: options.query,
        },
        options.requestOptions,
        request,
      );
      const {
        data,
        meta: responseMeta,
        links: responseLinks,
        ...responseExtras
      } = response;
      const responseItems = Array.isArray(data) ? data : [];
      const mappedItems = options.mapItems
        ? options.mapItems(responseItems)
        : responseItems;

      if (currentRequest === requestId) {
        items.value = mappedItems;
        meta.value = responseMeta ?? null;
        links.value = responseLinks ?? null;
        extras.value =
          Object.keys(responseExtras).length > 0 ? responseExtras : null;
      }

      return [...mappedItems];
    } catch (error_) {
      if (currentRequest === requestId) {
        error.value =
          error_ instanceof Error ? error_.message : 'request_failed';
        items.value = [];
        meta.value = null;
        links.value = null;
        extras.value = null;
      }
      throw error_;
    } finally {
      if (currentRequest === requestId) {
        loading.value = false;
      }
    }
  }

  if (options.autoFetch ?? true) {
    void fetch().catch(() => {});
  }

  return {
    items,
    meta,
    links,
    extras,
    loading,
    error,
    page,
    perPage,
    search,
    sort,
    filters,
    limit,
    offset,
    nested,
    hasPagination,
    fetch,
    refresh: fetch,
    setPage: (value: number) => {
      page.value = Math.max(1, value);
    },
    setPerPage: (value: number) => {
      perPage.value = Math.max(1, value);
    },
    setSearch: (value: string) => {
      search.value = value;
    },
    setSort: (value: string | null) => {
      sort.value = value;
    },
    setFilter: (key: string, value: FilterValue) => {
      filters.value = { ...filters.value, [key]: value };
    },
    setFilters: (value: Record<string, FilterValue>) => {
      filters.value = { ...value };
    },
    clearFilter: (key: string) => {
      filters.value = Object.fromEntries(
        Object.entries(filters.value).filter(([name]) => name !== key),
      );
    },
    resetFilters: () => {
      filters.value = {};
    },
    setLimit: (value: number | null) => {
      limit.value = value;
    },
    setOffset: (value: number | null) => {
      offset.value = value;
    },
    setNested: (value: boolean) => {
      nested.value = value;
    },
  };
}
