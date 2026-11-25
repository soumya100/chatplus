import { Redis } from "@upstash/redis"
import { namespaceRedisPipeline, prefixRedisCommandArgs } from "./redis-keyspace"

let redis: Redis | undefined

function getRedis(): Redis {
    if (redis) return redis

    const url = process.env.UPSTASH_REDIS_REST_URL
    const token = process.env.UPSTASH_REDIS_REST_TOKEN

    if (!url || !token) {
        throw new Error(
            "Upstash Redis is not configured. Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN."
        )
    }

    redis = new Redis({ url, token })
    return redis
}

// Defer client creation until a Redis command is actually used. This prevents
// Next.js from requiring deployment secrets while collecting route page data.
//
// The proxy namespaces direct commands, Lua KEYS arrays, and queued pipeline
// commands consistently. With no REDIS_KEY_PREFIX, production retains its
// existing key names and data without a migration.
export const db = new Proxy({} as Redis, {
    get(_target, property) {
        if (property === "then") return undefined

        const client = getRedis()
        const value = Reflect.get(client, property, client)
        if (typeof value !== "function") return value

        if (property === "pipeline" || property === "multi") {
            return (...args: unknown[]) => namespaceRedisPipeline(value.apply(client, args))
        }

        return (...args: unknown[]) => value.apply(client, prefixRedisCommandArgs(String(property), args))
    },
})
