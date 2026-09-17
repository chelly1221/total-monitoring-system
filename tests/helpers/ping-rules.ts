// Re-exports so the ping event tests import the pure rules and the transfer gate from one place.
export * from '../../src/lib/ping-event-rules'
import { supportsTransfer } from '../../src/lib/transfer-rules'
export const supportsTransferForKind = supportsTransfer
