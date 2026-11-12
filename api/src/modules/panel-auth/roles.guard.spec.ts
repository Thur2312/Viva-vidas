import { ExecutionContext } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { RolesGuard } from './roles.guard'
import { Roles } from './roles.decorator'
import { Public } from '../auth/public.decorator'

class C {
  @Roles('viewer') v() {}
  @Roles('manager') m() {}
  @Roles('owner') o() {}
  free() {}
  @Public() @Roles('owner') pub() {}
}
const ctx = (handler: any, user?: any) =>
  ({ getHandler: () => handler, getClass: () => C, switchToHttp: () => ({ getRequest: () => ({ user }) }) }) as unknown as ExecutionContext

describe('RolesGuard', () => {
  const g = new RolesGuard(new Reflector())
  const allowed = (h: any, role?: string) => {
    try {
      return g.canActivate(ctx(h, role ? { role } : undefined))
    } catch {
      return false
    }
  }
  it('hierarquia owner > manager > viewer', () => {
    expect(['viewer', 'manager', 'owner'].map((r) => allowed(C.prototype.v, r))).toEqual([true, true, true])
    expect(['viewer', 'manager', 'owner'].map((r) => allowed(C.prototype.m, r))).toEqual([false, true, true])
    expect(['viewer', 'manager', 'owner'].map((r) => allowed(C.prototype.o, r))).toEqual([false, false, true])
  })
  it('falha fechada: sem usuario ou papel desconhecido', () => {
    expect(allowed(C.prototype.v)).toBe(false)
    expect(allowed(C.prototype.v, 'admin')).toBe(false)
  })
  it('sem @Roles ou @Public passa', () => {
    expect(allowed(C.prototype.free)).toBe(true)
    expect(allowed(C.prototype.pub)).toBe(true)
  })
})
