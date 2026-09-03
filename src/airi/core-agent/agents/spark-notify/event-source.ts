import type { MetadataEventSource } from '../../../server-sdk/index.ts'

interface EventSourcePayload {
  source?: string
  metadata?: { source?: MetadataEventSource }
}

function formatMetadataSource(source?: MetadataEventSource) {
  if (!source)
    return undefined

  if ('extension' in source) {
    return `${source.extension.id}:${source.id}`
  }

  return source.id
}

export function getEventSourceKey(event: EventSourcePayload, fallback = 'unknown') {
  return (
    formatMetadataSource(event.metadata?.source)
    ?? event.source
    ?? fallback
  )
}
