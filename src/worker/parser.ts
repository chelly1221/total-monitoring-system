// Buffer parsing for incoming data (Node-RED compatible protocol)

import { PortConfig } from './config'

export interface ParsedData {
  value: string
  rawLength: number
  timestamp: Date
}

/**
 * Parse incoming buffer data according to Node-RED protocol
 * - Buffer inputs: Parse first 20 bytes as string
 * - UTF-8 inputs: Direct string parsing
 */
export function parseBuffer(buffer: Buffer, config: PortConfig): ParsedData {
  const encoding = config.encoding || 'buffer'
  const timestamp = new Date()

  if (encoding === 'utf8') {
    return {
      value: buffer.toString('utf8').trim(),
      rawLength: buffer.length,
      timestamp,
    }
  }

  // Parse first 20 bytes as string (Node-RED protocol)
  const str = buffer.subarray(0, Math.min(20, buffer.length)).toString('utf8').trim()
  return {
    value: str,
    rawLength: buffer.length,
    timestamp,
  }
}

/**
 * Extract numeric value from parsed string
 * Returns null if the string cannot be parsed as a number
 */
export function extractNumericValue(data: ParsedData): number | null {
  const num = parseFloat(data.value)
  return isNaN(num) ? null : num
}
