export const CANCELLATION_WINDOW = 200
export const LOG_WINDOW = 500

export function trimRecentByTimestamp<T extends { timestamp: number }>(items: T[], limit: number): T[] {
  if (items.length <= limit) return items
  return [...items].sort((left, right) => left.timestamp - right.timestamp).slice(-limit)
}
