# CLAUDE.md — Horizon Agent (projeto)

Regras deste repositório. Têm prioridade sobre o `CLAUDE.md` global do Thur.

## Estrutura

Monorepo com duas pastas: `api/` (NestJS) e `web/` (Next.js). O front só fala com a API pelo BFF (`web/src/app/api/**`). Detalhes nos READMEs de cada pasta. Branch principal: `Dev-Daniel`; o trabalho entra por `Dev-Thulio`.

## Identidade do projeto

Direção **Prontuário** (editorial, calor humano) com o exploded view de **camadas** só no login e no onboarding. Documento completo, com tokens, tipografia, movimento e fases: [`docs/design-system.md`](docs/design-system.md).

- **Conceito:** CRM sóbrio e legível. Efeito só em botões, gráficos e no microfone da Voz.
- **Paleta (azul-petróleo, escolhida em 12/11/2026):** fundo `#F4F7F8`, tinta `#16222B`, ação `#0B6B8A`, menu `#10222D`, urgência `#C2410C`; tema escuro `#0F1A21`. Contraste AA calculado em `docs/design-system.md`.
- **Fonte:** IBM Plex Sans em tudo (títulos 600, texto 400, números tabulares). Sem Inter e sem serifa decorativa: é um CRM, legibilidade primeiro.
- **Login:** duas colunas com o funil 3D do CRM (relacionado ao produto) e formulário acessível (mostrar senha, aviso de Caps Lock, erro ligado aos campos). Há página `/esqueci-senha`; a senha é redefinida por quem administra (`npm run panel:reset-password`). Sem animação sobre dado.
- **Tom:** humano e direto, em pt-BR.
- A marca (nome, logo) é configuração (`web/src/lib/brand.ts`): ainda não foi atribuída a um cliente. **Não usar a Identidade Horizon** (laranja/azul-marinho) neste painel.

## Regras de UI

- Todo valor visual vem de um token CSS. Nada de hex solto em componente.
- Nada de grade de cards idênticos, `rounded-xl` em tudo, gradiente roxo→azul ou emoji como ícone.
- 3D e translucidez só em login, onboarding, topo e estados vazios; nunca sobre tabelas e formulários.
- Sempre `prefers-reduced-motion`, fallback estático do 3D e contraste AA (verificar antes de fixar uma cor nova).
- A lógica (hooks, BFF, tipos) não muda em redesenho: só a camada visual.
- É um **CRM** de uso diário: densidade e velocidade antes do efeito (ver princípio 7 do design system).
- Antes de instalar dependência nova, perguntar. Já instaladas: three, @react-three/fiber 9 (React 19), gsap, @gsap/react. Não instaladas: drei, lenis.
