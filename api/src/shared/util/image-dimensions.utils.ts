/**
 * Largura em pixels lida do CABECALHO da imagem, sem decodificar os pixels.
 *
 * Existe porque a chave do espelho de thumbnail carrega o tamanho (`{sha1}-1080.jpg`) e
 * esse numero precisa ser uma MEDICAO, nao uma promessa. Antes ele vinha da constante
 * `THUMBNAIL_TARGET_PX` — ou seja, do que foi PEDIDO a Meta. Quando a Meta devolvia um
 * criativo pequeno (ela ignora `thumbnail_width` em varios casos, e a cadeia de resolucao
 * prefere `image_url`, que nao aceita o parametro), um arquivo de 64px era gravado como
 * `-1080.jpg` e passava a ser invisivel para todos os guards de reprocessamento: ficava
 * borrado para sempre, e nenhum sync conseguia mais alcanca-lo.
 *
 * Formatos cobertos: os tres que a Meta serve em `image_url`/`thumbnail_url`.
 * Devolve null quando nao reconhece o cabecalho — o chamador decide o fallback.
 */
export function readImageWidth(buffer: Buffer): number | null {
  if (!buffer || buffer.length < 16) return null

  // PNG: assinatura de 8 bytes, depois chunk IHDR com width nos bytes 16-19 (big-endian).
  if (buffer.length >= 24 && buffer.readUInt32BE(0) === 0x89504e47) {
    return buffer.readUInt32BE(16)
  }

  // WebP: "RIFF" .... "WEBP" + variante VP8 / VP8L / VP8X.
  if (buffer.length >= 30 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') {
    const variante = buffer.toString('ascii', 12, 16)
    if (variante === 'VP8 ') {
      // frame lossy: largura nos 14 bits baixos do uint16 em 26
      return buffer.readUInt16LE(26) & 0x3fff
    }
    if (variante === 'VP8L') {
      // lossless: 14 bits de largura, menos 1, logo apos o byte de assinatura 0x2f
      return (buffer.readUInt16LE(21) & 0x3fff) + 1
    }
    if (variante === 'VP8X') {
      // estendido: 24 bits little-endian, menos 1
      return (buffer[24] | (buffer[25] << 8) | (buffer[26] << 16)) + 1
    }
    return null
  }

  // JPEG: percorre os segmentos ate um Start Of Frame, onde ficam as dimensoes.
  if (buffer[0] === 0xff && buffer[1] === 0xd8) {
    let offset = 2
    while (offset + 9 < buffer.length) {
      if (buffer[offset] !== 0xff) {
        offset++
        continue
      }
      const marcador = buffer[offset + 1]

      // SOF0..SOF15 carregam as dimensoes; C4 (Huffman), C8 (JPG extension) e CC (DAC)
      // compartilham a faixa mas NAO sao frames.
      const eSOF =
        marcador >= 0xc0 && marcador <= 0xcf &&
        marcador !== 0xc4 && marcador !== 0xc8 && marcador !== 0xcc
      if (eSOF) {
        // [marcador][len:2][precisao:1][altura:2][largura:2]
        return buffer.readUInt16BE(offset + 7)
      }

      // Marcadores sem payload: nao trazem tamanho, entao nao da para pular por ele.
      if (marcador === 0xd8 || marcador === 0x01 || (marcador >= 0xd0 && marcador <= 0xd7)) {
        offset += 2
        continue
      }
      if (marcador === 0xd9 || marcador === 0xda) return null // fim / inicio do scan

      const tamanho = buffer.readUInt16BE(offset + 2)
      if (tamanho < 2) return null
      offset += 2 + tamanho
    }
  }

  return null
}
