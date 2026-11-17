/** Lê o corpo de uma resposta fetch como blocos de bytes, aceitando ReadableStream (getReader) ou iterável assíncrono. */
export async function* readBody(body: any): AsyncIterable<Uint8Array> {
  if (!body) return
  if (typeof body.getReader === 'function') {
    const reader = body.getReader()
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) return
        if (value?.length) yield value
      }
    } finally {
      try { reader.releaseLock() } catch { /* já liberado */ }
    }
  }
  for await (const chunk of body) yield typeof chunk === 'string' ? Buffer.from(chunk) : chunk
}

/** Eventos SSE (`data: ...`) a partir de blocos de bytes; junta linhas partidas entre blocos. */
export async function* sseData(body: any): AsyncIterable<string> {
  const dec = new TextDecoder()
  let buf = ''
  for await (const chunk of readBody(body)) {
    buf += dec.decode(chunk, { stream: true })
    let idx: number
    while ((idx = buf.search(/\r?\n\r?\n/)) >= 0) {
      const raw = buf.slice(0, idx)
      buf = buf.slice(idx).replace(/^\r?\n\r?\n/, '')
      const data = raw.split(/\r?\n/).filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trimStart()).join('\n')
      if (data) yield data
    }
  }
  const tail = buf.trim()
  if (tail.startsWith('data:')) yield tail.slice(5).trimStart()
}
