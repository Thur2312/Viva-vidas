import { Module } from '@nestjs/common'

import { MetaVideoSourceService } from './services/meta-video-source.service'

/**
 * Modulo-FOLHA: nao importa nada.
 *
 * O `MetaVideoSourceService` recebe token e conta por argumento e nao toca no banco,
 * exatamente para poder ser usado pelas strategies do sync E pela analise de criativo
 * (que vive em `agent/dashboard`) sem que um lado precise importar o modulo do outro.
 * E o mesmo motivo que levou o commit 801dab80 a inlinar `carregarTokensDePagina` em
 * vez de injetar `MetaLeadFormsService`: aquele caminho fechava um ciclo.
 */
@Module({
  providers: [MetaVideoSourceService],
  exports: [MetaVideoSourceService],
})
export class MetaVideoSourceModule {}
