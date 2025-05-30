# batch-loader

A lightweight, efficient data loader utility for batching multiple requests into a single operation. Particularly useful for optimizing database queries and API calls in JavaScript servers, React Router loaders, and React Server Components.

Your code can simply request individual records while the loader automatically combines these requests into efficient batch queries behind the scenes.

Highly inspired by [GraphQL dataloader](https://github.com/graphql/dataloader) but smaller in scope.

## Key Features

- 🚀 Automatic load batching within the same tick of the event loop
- 💾 Request-scoped caching to prevent duplicate loads
- ⚡️ Handles parallel requests for the same key via in-flight request tracking
- 🔄 Support for custom cache implementations
- 📊 Request monitoring via batch operation callbacks

## Installation

```bash
npm install @ryanflorence/batch-loader
```

## Usage

```js
import { batch } from "@ryanflorence/batch-loader";

let loadStuff = batch(async keys => {
  console.log("batching", keys);
  await new Promise(res => setTimeout(res, 2000));
  return keys.map(key => `Loaded ${key}`);
});

let stuff = await Promise.all([
  loadStuff("a"),
  loadStuff("b"),
  loadStuff("c"),
  loadStuff("a"), // deduped
]);

let stuff2 = await Promise.all([
  loadStuff("a"), // cached
  loadStuff("c"), // cached
  loadStuff("d"), // only key in this batch
]);

console.log({ stuff, stuff2 });
```

## Important Notes

- **Request-Scoped Caching**: Loader caches are never explicitly cleared. The intended usage is to create loaders within the scope of a request or operation. When that operation completes, the cache is automatically garbage collected along with the loader instance. A convenient way to do this is with [async-provider](https://github.com/ryanflorence/async-provider). See the [movies example](./examples/movies/app.ts#L10-L18).

- **Batch Function Requirements**: Your batch function must return results in the same order as the input keys. This ensures the loader can correctly match results to individual requests.

- **Error Handling**: If the batch function throws an error, all requests in that batch will receive the same error.

## API

### `batch<Key, T>(batcher, options?)`

Creates a new data loader that batches calls.

#### Parameters

- `batcher`: `(keys: Key[]) => Promise<T[]>`

  - Function that loads multiple items in a single batch
  - Must return results in same order as input keys

- `options`: (optional)
  - `cacheMap`: Custom Map implementation for caching (e.g., LRUMap)
  - `onBatch`: Callback for monitoring batch operations

#### Returns

- `(key: Key) => Promise<T>`
  - Function to load individual items
  - Automatically batches concurrent calls

### Batch Info

The `onBatch` callback receives an object with:

```typescript
{
  batcher: Function,     // The batch function
  requestedKeys: Key[],  // All keys requested in this tick
  inflightKeys: Key[],   // Keys currently being loaded
  cachedKeys: Key[],     // Keys found in cache
  batchedKeys: Key[]     // Keys included in this batch
}
```

## License

MIT
