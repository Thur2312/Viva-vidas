/**
 * Colunas de sistema de uma jornada (GenericDndColumnSet).
 *
 * Toda jornada tem exatamente uma coluna de cada tipo, nesta ordem:
 *
 *   [ RECEPTION ] [ ...colunas livres... ] [ WIN ] [ LOST ]
 *      position 0                            n-2    n-1
 *
 * Elas não podem ser renomeadas, movidas nem excluídas — o resto do produto
 * depende delas (conversão de lead → oportunidade, `result` da oportunidade,
 * ranking e funil). `GenericDndColumn.systemType` é nulo nas colunas comuns.
 */
export const SYSTEM_COLUMN_TYPES = {
  RECEPTION: 'RECEPTION',
  WIN: 'WIN',
  LOST: 'LOST',
} as const

export type SystemColumnType = (typeof SYSTEM_COLUMN_TYPES)[keyof typeof SYSTEM_COLUMN_TYPES]

/** Nome usado ao CRIAR uma coluna de sistema que esteja faltando. */
export const SYSTEM_COLUMN_DEFAULT_NAME: Record<SystemColumnType, string> = {
  RECEPTION: 'Recepção',
  WIN: 'Win',
  LOST: 'Lost',
}

/** Ordem canônica das colunas de sistema dentro da jornada. */
export const SYSTEM_COLUMN_ORDER: SystemColumnType[] = [
  SYSTEM_COLUMN_TYPES.RECEPTION,
  SYSTEM_COLUMN_TYPES.WIN,
  SYSTEM_COLUMN_TYPES.LOST,
]

/** Tipos que ficam ancorados no fim da jornada, na ordem em que aparecem. */
export const TRAILING_SYSTEM_COLUMN_TYPES: SystemColumnType[] = [SYSTEM_COLUMN_TYPES.WIN, SYSTEM_COLUMN_TYPES.LOST]

export function isSystemColumnType(value: unknown): value is SystemColumnType {
  return typeof value === 'string' && (SYSTEM_COLUMN_ORDER as string[]).includes(value)
}

/** Coluna comum criada junto com uma jornada nova, para ela não nascer vazia. */
export const DEFAULT_JOURNEY_MIDDLE_COLUMNS = [{ name: 'Coluna 1' }]

export const DEFAULT_JOURNEY_COLUMN_SET_NAME = 'Nova Jornada'

/**
 * Espelha o `translate(...)` do backfill.sql da migration
 * 20270801120000_add_system_type_to_generic_dnd_column. Mudou um lado, mude o outro.
 */
const SYSTEM_COLUMN_NAME_MATCHERS: Record<SystemColumnType, string[]> = {
  RECEPTION: ['recepcao', 'reception'],
  WIN: ['win', 'won', 'ganho', 'ganha', 'ganhou', 'ganhos'],
  LOST: ['lost', 'perdido', 'perdida', 'perdidos', 'perda'],
}

export function normalizeColumnName(name: string): string {
  return (name ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
}

/** Devolve o tipo de sistema que o nome sugere, ou null. Deliberadamente estreito. */
export function matchSystemColumnByName(name: string): SystemColumnType | null {
  const normalized = normalizeColumnName(name)
  for (const type of SYSTEM_COLUMN_ORDER) {
    if (SYSTEM_COLUMN_NAME_MATCHERS[type].includes(normalized)) {
      return type
    }
  }
  return null
}

/**
 * Monta a lista de colunas de uma jornada nova: Recepção, o que o chamador pediu
 * no meio, depois Win e Lost.
 *
 * As três de sistema são SEMPRE do servidor. Nomes vindos do cliente que
 * pareçam uma delas são descartados, senão a jornada nasceria com duas "Win" —
 * uma fixa e uma comum.
 */
export function buildInitialJourneyColumns(
  requested: { name?: string; position?: number }[] = [],
): { name: string; position: number; systemType: SystemColumnType | null }[] {
  const middle = [...requested]
    .filter(column => column?.name?.trim())
    .filter(column => matchSystemColumnByName(column.name) === null)
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
    .map(column => column.name.trim())

  return [
    { name: SYSTEM_COLUMN_DEFAULT_NAME.RECEPTION, position: 0, systemType: SYSTEM_COLUMN_TYPES.RECEPTION },
    ...middle.map((name, index) => ({ name, position: index + 1, systemType: null })),
    { name: SYSTEM_COLUMN_DEFAULT_NAME.WIN, position: middle.length + 1, systemType: SYSTEM_COLUMN_TYPES.WIN },
    { name: SYSTEM_COLUMN_DEFAULT_NAME.LOST, position: middle.length + 2, systemType: SYSTEM_COLUMN_TYPES.LOST },
  ]
}

/** Mensagens de erro — mantidas juntas para não divergirem entre os serviços. */
export const SYSTEM_COLUMN_ERRORS = {
  RENAME: 'Esta é uma coluna fixa da jornada e não pode ser renomeada.',
  DELETE: 'Esta é uma coluna fixa da jornada e não pode ser excluída.',
  MOVE: 'Esta é uma coluna fixa da jornada e não pode ser movida.',
  INVALID_TARGET: 'Não é possível mover a coluna para essa posição.',
} as const
