import { SetMetadata } from '@nestjs/common'

export const IS_PUBLIC_KEY = 'isPublic'

/**
 * Marca uma rota como publica — pula JwtAuthGuard e TenantGuard globais.
 * Uso: @Public() no metodo ou no controller inteiro.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true)
