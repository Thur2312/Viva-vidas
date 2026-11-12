export const PANEL_ROLES = ['owner', 'manager', 'viewer'] as const
export type PanelRole = (typeof PANEL_ROLES)[number]

/** Hierarquia: owner > manager > viewer. */
export const ROLE_RANK: Record<PanelRole, number> = { viewer: 1, manager: 2, owner: 3 }

export function isPanelRole(v: unknown): v is PanelRole {
  return typeof v === 'string' && (PANEL_ROLES as readonly string[]).includes(v)
}

export const ACCESS_TOKEN_ISSUER = 'horizon-agent-panel'
export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60
export const REFRESH_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60
