/**
 * User supplied function that loads batched keys from a data source
 */
export type Batch<Key = any, T = unknown> = (
  keys: Key[],
) => Promise<T[] | Map<Key, T>>;

/**
 * Returned from {@link batch}, applications use this to load records by key.
 */
export type Loader<Key, T> = (key: Key) => Promise<T | undefined>;

/**
 * Creates a data loader that will automatically batch queries for records
 * across the application in the same tick of the event loop
 */
export function batch<Key, T>(
  batcher: Batch<Key, T>,
  options: BatchOptions<Key, T> = {},
): Loader<Key, T> {
  let state: BatchState<Key, T> = {
    cache: options.cacheMap ?? new Map<Key, T>(),
    inflight: new Map<Key, Promise<void>>(),
    queue: new Set<{
      key: Key;
      resolve: (value: T | undefined) => void;
      reject: (error: unknown) => void;
    }>(),
  };

  return async (key) => {
    return new Promise((resolve, reject) => {
      state.queue.add({ key, resolve, reject });
      if (state.queue.size === 1) {
        queueMicrotask(() => {
          dispatch(state, batcher, options);
        });
      }
    });
  };
}

/**
 * Configuration options
 */
export type BatchOptions<Key, T> = {
  /** Callback for batch call introspection */
  onBatch?: (info: BatchInfo<Key, T>) => void;

  /** Can provide custom map for the cache, like an LRU map */
  cacheMap?: Map<Key, T>;
};

/**
 * Information about a batch operation provided to onBatch callback
 */
export type BatchInfo<Key = any, T = any> = {
  batcher: Batch<Key, T>;
  requestedKeys: Key[];
  inflightKeys: Key[];
  cachedKeys: Key[];
  batchedKeys: Key[];
};

type LoaderCall<Key, T> = Set<{
  key: Key;
  resolve: (value: T | undefined) => void;
  reject: (error: unknown) => void;
}>;

type BatchState<Key, T> = {
  /**
   * Tracks loader calls for this tick of the event loop so they can be
   * dispatched and batched as a single query in the batchFn
   */
  queue: LoaderCall<Key, T>;

  /**
   * Loader calls results are cached for the lifespan of the loader to avoid
   * re-loaded the same data
   */
  cache: Map<Key, T | undefined>;

  /**
   * Tracks inflight loads to avoid reloading data that is not yet in the cache
   * but is already in flight
   */
  inflight: Map<Key, Promise<void>>;
};

async function dispatch<Key, T>(
  state: BatchState<Key, T>,
  batcher: Batch<Key, T>,
  options: BatchOptions<Key, T>,
): Promise<void> {
  let queue = new Set(state.queue);

  // reset for next tick
  state.queue.clear();

  let requestedKeys = Array.from(queue.values(), (q) => q.key);

  // used for onBatch reporting
  let cachedKeys = new Set<Key>();
  let inflightKeys = new Set<Key>();

  // dedupe and remove cached/inflight
  let batchedKeys = Array.from(new Set(requestedKeys)).filter((key) => {
    if (state.cache.has(key)) {
      cachedKeys.add(key);
      return false;
    }
    if (state.inflight.has(key)) {
      inflightKeys.add(key);
      return false;
    }
    return true;
  });

  if (options.onBatch) {
    options.onBatch({
      batcher,
      batchedKeys,
      requestedKeys,
      cachedKeys: [...cachedKeys],
      inflightKeys: [...inflightKeys],
    });
  }

  // nothing new to fetch, it's all cached or in flight
  if (batchedKeys.length === 0) {
    resolveLoaders();
    return;
  }

  let batchPromise = batcher(batchedKeys)
    .then(async (results) => {
      cacheResults(results);
      clearInflight();
      resolveLoaders();
    })
    .catch((error) => {
      clearInflight();
      rejectLoaders(error);
    });

  // store batch so subsequent batches can await keys across ticks
  for (let key of batchedKeys) {
    state.inflight.set(key, batchPromise);
  }

  // helpers
  async function resolveLoaders() {
    await awaitInflight();
    for (let loaderCall of queue) {
      loaderCall.resolve(state.cache.get(loaderCall.key));
    }
  }

  async function awaitInflight() {
    let inflight = new Set();
    for (let { key } of queue) {
      if (state.inflight.has(key)) {
        inflight.add(state.inflight.get(key));
      }
    }
    await Promise.all([...inflight]);
  }

  function clearInflight() {
    for (let key of batchedKeys) {
      state.inflight.delete(key);
    }
  }

  function cacheResults(batchResults: Array<T> | Map<Key, T>) {
    if (Array.isArray(batchResults)) {
      for (let [index, key] of batchedKeys.entries()) {
        state.cache.set(key, batchResults[index]);
      }
    } else {
      for (let key of batchedKeys) {
        state.cache.set(key, batchResults.get(key));
      }
    }
  }

  function rejectLoaders(error: unknown) {
    for (let loaderCall of queue) {
      loaderCall.reject(error);
    }
  }
}
