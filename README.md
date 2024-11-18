# batch-loader

A lightweight, efficient data loader utility for batching multiple calls into a single operation. Particularly useful for optimizing database queries and API calls in JavaScript servers, Remix loaders, and React Server Components.

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

```typescript
import { batch } from "@ryanflorence/batch-loader";

// Create a loader for users
const loadUsers = batch(async (ids: string[]) => {
  // Single query/request to load multiple users
  const users = await db.users.findMany({
    where: { id: { in: ids } },
  });

  // Must return array in same order as input ids
  return ids.map(id => users.find(user => user.id === id));
});

// Use the loader - these will be batched automatically
const [user1, user2] = await Promise.all([
  loadUsers("1"),
  loadUsers("2"),
  loadUsers("2"), // will be de-duped
]);
```

## Important Notes

- **Request-Scoped Caching**: Loader caches are never explicitly cleared. The intended usage is to create loaders within the scope of a request or operation. When that operation completes, the cache is automatically garbage collected along with the loader instance. A convenient way to do this is with [async-provider](https://github.com/ryanflorence/async-provider).
- **Batch Function Requirements**: Your batch function must return results in the same order as the input keys. This ensures the loader can correctly match results to individual requests.
- **Error Handling**: If the batch function throws an error, all requests in that batch will receive the same error.

## API

### `batch<Key, T>(batchFn, options?)`

Creates a new data loader that batches calls.

#### Parameters

- `batchFn`: `(keys: Key[]) => Promise<T[]>`

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
