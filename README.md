# laravel-resource-index-vue

Vue 3 composables for Laravel JSON APIs, designed to work with
[`feldoe/laravel-resource-index`](https://github.com/sem-feldoe/laravel-resource-index).

## Compatibility

The npm and Composer packages follow Semantic Versioning independently. A
breaking change to their shared HTTP contract requires a new major version on
both sides; minor and patch versions do not need to stay synchronized.

| `laravel-resource-index-vue` | `feldoe/laravel-resource-index` | Status |
| --- | --- | --- |
| `0.1.x` | `1.9.1` | Tested contract |

Do not assume that arbitrary latest versions are compatible. This table is
updated when a new pair is verified. The Vue package will move to `1.0.0` once
its integration in a real application has validated the public API.

## Installation

```bash
bun add laravel-resource-index-vue
```

The package expects Vue 3.5 or newer in the consuming application.

## Resource index

```ts
import { useResourceIndex } from 'laravel-resource-index-vue';

type Movie = { id: number; title: string };

const movies = useResourceIndex<Movie>({
  controller: () => ({ url: '/api/movies', method: 'GET' }),
  pagination: true,
  initialPerPage: 25,
  initialSort: '-created_at',
  initialFilters: { status: 'published' },
});
```

The composable exposes reactive `items`, `meta`, `links`, `loading`, `error`,
pagination and filter state, plus `fetch()` and `refresh()`.

## Laravel Wayfinder

Wayfinder is the recommended integration when it is available. First, declare
the item resource on the Laravel controller so that
`feldoe/laravel-resource-index` can expose the response type to Wayfinder:

> **Wayfinder version:** response type generation currently requires
> `laravel/wayfinder:dev-next`; it is not available in the regular stable
> release yet. Install the development branch and commit `composer.lock` so the
> exact revision remains reproducible:
>
> ```bash
> composer require laravel/wayfinder:dev-next --dev
> ```
>
> Revisit this constraint when the response-generation feature is released in
> a tagged Wayfinder version.

```php
use App\Http\Resources\MovieResource;
use App\Models\Movie;
use Atx\ResourceIndex\Attributes\ResourceIndexResponse;
use Atx\ResourceIndex\Contracts\ResourceIndex;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

#[ResourceIndexResponse(MovieResource::class)]
public function __invoke(Request $request, ResourceIndex $resourceIndex): JsonResponse
{
    return $resourceIndex
        ->from(Movie::class)
        ->processRequest($request)
        ->response();
}
```

After generating Wayfinder files, use both its controller function and its
generated response type in Vue:

```ts
import {
  useResourceIndex,
  type ResourceIndexItem,
} from 'laravel-resource-index-vue';

import MovieIndex from '@/wayfinder/App/Http/Controllers/Movie/Index';
import type { App } from '@/wayfinder/types';

type MovieIndexResponse =
  App.Http.Controllers.Movie.Index.__invoke.Response;
type Movie = ResourceIndexItem<MovieIndexResponse>;

const movies = useResourceIndex<Movie>({
  controller: MovieIndex,
  pagination: true,
  initialPerPage: 25,
  initialSort: '-created_at',
  initialFilters: { status: 'published' },
});
```

`MovieIndex()` returns Wayfinder's typed `{ url, method }` route definition,
which is the controller contract expected by this package. `ResourceIndexItem`
extracts the item type from either a wrapped `{ data: Movie[] }` response or an
unwrapped `Movie[]` response. This avoids a hard-coded endpoint and keeps the
item type synchronized with the Laravel `JsonResource`.

Laravel's default `{ data: [...] }` resource envelope is recommended so the
runtime response and Wayfinder type stay aligned. `useResourceIndex` consumes
that transport envelope and exposes the collection as the reactive `items`
property. Unwrapped arrays, including legacy responses produced with
`JsonResource::$wrap = null`, remain accepted as a migration aid.

## API client

```ts
import { useApi } from 'laravel-resource-index-vue';

const { request } = useApi({ baseUrl: import.meta.env.VITE_APP_BASE_URL });
const movie = await request<Movie>({ url: '/api/movies/1', method: 'GET' });
```

Write requests support Laravel Sanctum's CSRF cookie flow, a single retry after
a `419` response, and method spoofing for `FormData` sent with `PUT` or `PATCH`.

## Development

```bash
bun install
bun run check
bun run test
bun run build
```

The test command enforces 100% coverage for statements, branches, functions,
and lines. Publishing runs all checks automatically through `prepublishOnly`.
