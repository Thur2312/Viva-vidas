import 'reflect-metadata'

const FREE_FORM_DTO_KEY = 'hdm:free-form-dto'

/**
 * Marca um DTO de entrada (`@Body`/`@Query`) como "campos livres": o `HdmValidationPipe` NÃO
 * aplica `whitelist` a ele, então todas as propriedades enviadas chegam ao controller.
 *
 * Por que isto existe: com `whitelist: true`, o NestJS apaga toda propriedade sem decorator do
 * `class-validator`. Um DTO sem nenhum decorator vira `{}` antes de chegar ao serviço. Isso já
 * derrubou, em produção, a criação de leads e de transações (incidente de 09/10 a 14/10/2026).
 *
 * Use SOMENTE quando o contrato do payload é aberto de propósito (ex.: ~200 apelidos de campo
 * aceitos por um pipe de transformação, ou webhook de terceiro com formato variável) e a
 * validação é feita de forma imperativa no serviço. Para os demais casos, o caminho certo é
 * decorar o DTO com `class-validator` (`@IsString()`, `@IsOptional()`, ...).
 *
 * Todo DTO marcado precisa estar na lista de `dto-coverage.spec.ts`: adicionar um novo exige
 * editar o teste, para a decisão passar pela revisão.
 */
export function FreeFormDto(): ClassDecorator {
  return (target) => {
    Reflect.defineMetadata(FREE_FORM_DTO_KEY, true, target)
  }
}

/** Verdadeiro se a classe (ou uma classe da qual ela herda) foi marcada com `@FreeFormDto()`. */
export function isFreeFormDto(target: unknown): boolean {
  return typeof target === 'function' && Reflect.getMetadata(FREE_FORM_DTO_KEY, target) === true
}
