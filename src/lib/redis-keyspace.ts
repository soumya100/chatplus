/**
 * Redis keyspace isolation for deployments sharing one Upstash database.
 *
 * Production keeps the historical unprefixed keys when REDIS_KEY_PREFIX is
 * unset. Set REDIS_KEY_PREFIX=staging: only on the staging deployment.
 */
const configuredPrefix = process.env.REDIS_KEY_PREFIX || ""

if (configuredPrefix && !/^[a-z0-9][a-z0-9:_-]{0,62}:$/i.test(configuredPrefix)) {
    throw new Error("REDIS_KEY_PREFIX must be a short Redis-safe namespace ending in ':'")
}

export const redisKeyPrefix = configuredPrefix

export function prefixRedisKey(value: unknown): unknown {
    if (typeof value !== "string" || !redisKeyPrefix || value.startsWith(redisKeyPrefix)) return value
    return `${redisKeyPrefix}${value}`
}

const multiKeyCommands = new Set([
    "del", "unlink", "exists", "touch", "mget", "pfcount",
    "sunion", "sinter", "sdiff", "sunionstore", "sinterstore", "sdiffstore",
    "rename", "renamenx", "rpoplpush", "brpoplpush", "smove", "copy",
])

/** Prefix key arguments for the Redis commands used by this application. */
export function prefixRedisCommandArgs(method: string, input: unknown[]): unknown[] {
    if (!redisKeyPrefix || input.length === 0) return input

    const args = [...input]
    if (method === "eval" || method === "evalsha" || method === "eval_ro") {
        if (Array.isArray(args[1])) args[1] = (args[1] as unknown[]).map(prefixRedisKey)
        return args
    }

    if (multiKeyCommands.has(method)) {
        return args.map(prefixRedisKey)
    }

    // Redis commands used by the app (GET/SET, hashes, sets, sorted sets,
    // lists, KEYS, EXPIRE, TTL, etc.) take their key as the first argument.
    args[0] = prefixRedisKey(args[0])
    return args
}

/** Wrap a pipeline/transaction so queued commands use the same keyspace. */
export function namespaceRedisPipeline<T extends object>(pipeline: T): T {
    if (!redisKeyPrefix) return pipeline
    const proxy = new Proxy(pipeline, {
        get(target, property) {
            const value = Reflect.get(target, property, target)
            if (typeof value !== "function") return value
            if (property === "exec" || property === "execAtomic" || property === "then") return value.bind(target)
            return (...args: unknown[]) => {
                const result = value.apply(target, prefixRedisCommandArgs(String(property), args))
                // Most Upstash pipeline methods return the same pipeline for chaining.
                return result === target ? proxy : result
            }
        },
    })
    return proxy
}
