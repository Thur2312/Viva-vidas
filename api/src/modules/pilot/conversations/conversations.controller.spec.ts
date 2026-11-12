import 'reflect-metadata'
import { ROLES_KEY } from '../../panel-auth/roles.decorator'
import { ConversationsController } from './conversations.controller'

describe('ConversationsController (papéis)', () => {
  const roles = (fn: unknown) => Reflect.getMetadata(ROLES_KEY, fn as object)
  const p = ConversationsController.prototype
  it('leitura exige viewer; envio exige manager', () => {
    expect(roles(p.list)).toEqual(['viewer'])
    expect(roles(p.stats)).toEqual(['viewer'])
    expect(roles(p.messages)).toEqual(['viewer'])
    expect(roles(p.send)).toEqual(['manager'])
  })
})
