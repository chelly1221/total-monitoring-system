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

  // Node-RED protocol: the value lives in the first 20 bytes. Decode the bytes
  // FIRST and then slice by character — slicing the raw buffer at byte offset 20
  // can cut a multi-byte UTF-8 sequence in half and inject U+FFFD into the value.
  const str = buffer.toString('utf8').slice(0, 20).trim()
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
  // Reject values corrupted by a decode error (U+FFFD replacement char) — a
  // partially-decoded string would otherwise yield a plausible-but-wrong number.
  if (data.value.includes('�')) return null
  const num = parseFloat(data.value)
  return isNaN(num) ? null : num
}
