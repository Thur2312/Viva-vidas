# Design system: Prontuário (com camadas da Cobertura)

Direção escolhida em 12/11/2026: **A (Prontuário) como base** + o exploded view de camadas da **B (Cobertura)** só no login e no onboarding.
Valores marcados *(proposta)* são decisões minhas ainda **não validadas com a marca do cliente**. Contrastes foram calculados (WCAG 2.x).

> Marca, nome e logo são **configuração** (`web/src/lib/brand.ts`, a criar na Fase 1): a identidade ainda não foi atribuída a um cliente. Nada neste documento usa a Identidade Horizon (laranja/azul-marinho), que é só da agência.

## 1. Conceito

O painel é um **prontuário bem organizado**: papel quente, tipografia de revista, números grandes em mono e uma única linha viva, a de batimento. Quem abre o painel deve sentir calma e precisão, não "mais um dashboard".

- **Assunto:** corretora de planos de saúde. Reduzir o plano do cliente sem perder cobertura é tirar camadas sem quebrar a estrutura. Daí as camadas.
- **Momento-assinatura:** ao entrar, camadas de vidro empilhadas se **abrem** e revelam o painel (login e onboarding). No dia a dia, uma **fita de batimento (ECG)** atravessa o cabeçalho e cada lead novo é um batimento.
- **Tom:** humano, direto, sem jargão de SaaS. "Quem respondeu hoje", não "Engagement rate".

## 2. Princípios (o que evitar e o que buscar)

Evitar: grade de 4 KPIs idênticos; `rounded-xl` em tudo; tudo centralizado; gradiente roxo→azul; emoji como ícone de seção; espaçamento uniforme.

Buscar:
1. **Número como manchete.** O dado principal é tipografia grande, não caixa. Contexto em "marginália" (texto pequeno ao lado).
2. **Assimetria com intenção.** Coluna principal larga + coluna de notas estreita; seções numeradas (01, 02...) como folhas de prontuário.
3. **Ritmo irregular de espaço** (escala abaixo), mais ar em volta do que importa.
4. **Cantos variados:** retos (2 px) em dados e tabelas, 10 px em superfícies de ação, pílula só em chips e botões primários.
5. **Cor com função.** Coral = "precisa de você". Verde = ok. Âmbar = atenção. Menta é só decoração.
6. **Camadas** (translucidez, profundidade) só em destaque: login, onboarding, topo, estados vazios, conquista. **Nunca** sobre tabelas e formulários.
7. **É um CRM.** Ferramenta de trabalho o dia inteiro: densidade, escaneabilidade e velocidade vêm antes do efeito. Tabelas e filas compactas, atalhos de teclado, o que precisa de ação sempre à vista, estados claros (aguardando, atrasado, ok). Todo efeito visual é opcional e nunca atrasa uma ação.

## 3. Tokens de cor (CSS em `:root`)

Todo valor visual no código vem de um token. Nada de hex solto em componente.

### Tema claro "papel" (padrão)

| Token | Hex | Uso | Contraste |
|---|---|---|---|
| `--papel` | `#F4EFE6` | Fundo da página | |
| `--cartao` | `#FBF8F2` | Superfícies elevadas | |
| `--tinta` | `#14231F` | Texto principal | 14,21 (AAA) sobre papel |
| `--mudo` | `#566360` | Texto secundário | 5,47 (AA) sobre papel |
| `--linha` | `#D9D1C1` | Divisórias e bordas | só decorativo |
| `--acao` | `#C73627` | Botão primário, links, texto de destaque | branco: 5,27; sobre papel: 4,60 (AA) |
| `--sinal` | `#E5483A` | Gráficos, fita de ECG, pontos de alerta (nunca texto) | 3,45 (ok para gráfico) |
| `--ok` | `#2B6A52` | Sucesso | 5,58 (AA) |
| `--aviso` | `#8A5A00` | Atenção | 5,18 (AA) |
| `--erro` | `#A8261B` | Erro | 6,20 (AA) |
| `--menta` | `#7FB5A0` | **Decoração apenas** (camadas, ilustração) | 2,03 (não usar em texto) |

### Tema escuro "noite"

| Token | Hex | Contraste |
|---|---|---|
| `--papel` | `#101A17` | |
| `--cartao` | `#17241F` | |
| `--tinta` | `#EDE6D8` | 14,31 (AAA) |
| `--mudo` | `#A7B3AD` | 8,20 (AAA) |
| `--linha` | `#2A3A34` | |
| `--acao` | `#FF7A6B` | 6,98 (AA) |
| `--sinal` | `#FF7A6B` | |
| `--ok` | `#8FD1B5` | 10,11 (AAA) |
| `--aviso` | `#F0B955` | 9,96 (AAA) |
| `--erro` | `#FF8F86` | AA |
| `--menta` | `#8FD1B5` | decoração |

### Camadas (B) — só login/onboarding, sobre fundo petróleo

`--petroleo #0B2B2B` e `--limao #C8F169` (11,65 AAA) para a cena de entrada. O texto sobre ela usa `--tinta` do tema escuro (12,13 AAA).

## 4. Tipografia

| Papel | Fonte | Observação |
|---|---|---|
| Títulos e manchetes | **Instrument Serif** | Peso único; tamanhos grandes. Nunca em texto corrido. |
| Texto e interface | **Schibsted Grotesk** | 400/500/600. |
| Números e dados | **IBM Plex Mono** | `font-variant-numeric: tabular-nums`; números grandes são a manchete. |

Carregadas com `next/font/google` (`display: swap`). Escala fluida (`clamp`): manchete numérica 3rem → 5.5rem; título de página 2rem → 3.5rem; seção 1.25rem; corpo 1rem (16 px, nunca menor que 14 px); legenda 0.8125rem. Texto corrido com no máximo 68ch.

## 5. Espaço, forma e profundidade

- **Escala irregular (px):** 4 · 8 · 12 · 20 · 32 · 52 · 84 · 136. Use saltos grandes entre grupos e pequenos dentro deles.
- **Raios:** `--r-seco: 2px` (dados), `--r-acao: 10px`, `--r-pilula: 999px`.
- **Profundidade:** sombra suave e única (`0 1px 0 var(--linha)` + `0 12px 32px -16px rgb(20 35 31 / .18)`) só em itens que flutuam. Sem sombras em tudo.
- **Alvos de toque:** mínimo 44 px. **Foco:** anel de 3 px em `--acao`, sempre visível.

## 6. Movimento e 3D

Regras: a animação serve à narrativa; sempre respeita `prefers-reduced-motion`; anima só `transform` e `opacity`; sem easing de bounce/elastic.

| Momento | O que acontece | Ferramenta |
|---|---|---|
| **Entrada (assinatura)** | Cinco camadas de vidro empilhadas se abrem ao autenticar e revelam o painel. | R3F + GSAP |
| **Fita de ECG** | Linha em SVG/canvas no cabeçalho; um pulso a cada lead novo (no máximo 1 a cada 2 s). | GSAP / CSS |
| **Entrada de página** | Manchetes revelam por palavra; números contam até o valor. | GSAP (SplitText) |
| **Estados vazios** | Camadas vazias respiram devagar. | CSS / R3F leve |
| **Rolagem suave** | Só nas páginas de leitura longa (decisão do piloto). | Lenis |

**Fallback obrigatório** (sem WebGL, celular fraco ou `prefers-reduced-motion`): a mesma composição como SVG estático, com o painel já aberto. O 3D carrega sob demanda (`dynamic import`, `Suspense`, placeholder), e o painel funciona sem ele. Orçamento: o 3D não pode entrar no bundle das telas de trabalho.

Modelo: começa **procedural** (geometria em código, sem arquivo) e migra para `.glb` com Draco/Meshopt quando houver arte final.

## 7. Direção por tela (Fase 2 em diante)

- **Decisão do piloto / Dashboard:** uma manchete numérica ("custo por qualificado") ocupando a coluna larga; as demais métricas como marginália; o funil como linha de batimento, não barras idênticas.
- **Funil:** colunas por etapa em papel, cartões de lead com cantos secos e marca de urgência em `--sinal`.
- **Conversas:** duas colunas assimétricas; mensagem do lead em `--cartao`, do agente em tinta invertida; "aguardando você" em coral.
- **Disparos, Voz, Integrações, Origem, Agente:** mesma gramática (seção numerada + manchete + marginália), tabelas densas e sem camadas.

## 8. Acessibilidade (não negociável)

Contraste AA no mínimo; foco visível; alvos ≥ 44 px; `prefers-reduced-motion`; tema claro/escuro; texto real no HTML mesmo com animação; leitor de tela (rótulos nos controles, `role` em gráficos). Gráficos não dependem só de cor (rótulo ou forma junto).

## 9. Prompts visuais (bloco de estilo comum)

Para qualquer imagem, ícone ou cena 3D gerados: *"Estilo editorial clínico e caloroso, papel creme `#F4EFE6`, tinta verde-escura `#14231F`, um único acento coral `#E5483A`, detalhes em menta `#7FB5A0`. Vidro fosco translúcido em camadas finas, bordas nítidas, luz suave lateral, sem gradiente roxo/azul, sem brilho neon, sem pessoas estereotipadas, sem cruz médica clichê. Composição assimétrica com respiro."*

Cenas: (1) cinco lâminas de vidro empilhadas se separando (3/4, levemente de cima); (2) fita de ECG extrudada em 3D; (3) camada vazia tracejada para estados vazios.

## 10. Checklist de assets (o que falta fornecer)

- [ ] Nome e logo do cliente (ou decisão de produto próprio) e versão para fundo escuro.
- [ ] Cores da marca do cliente, se existirem (podem substituir `--acao`/`--sinal`).
- [ ] Favicon e imagem de compartilhamento.
- [ ] (Opcional) Modelo `.glb` das camadas com peças separadas; sem ele usamos o procedural.
- [ ] Textos legais da `/privacidade` (controlador, operador, encarregado).

## 11. Fases da reconstrução

1. **Fase 1 (concluída em 12/11/2026):** tokens + fontes + `brand.ts` + shell (menu, cabeçalho com fita de ECG, tema) + **login com a cena de camadas** + fallback. As telas existentes herdam a paleta e as fontes novas pelo remapeamento dos tokens; o desenho de cada uma (manchete numérica, marginália, sem grade de cartões idênticos) é das Fases 2 a 4.
2. **Fase 2:** Dashboard e Decisão do piloto.
3. **Fase 3:** Funil e Conversas (incluindo a gaveta do lead e o agendamento).
4. **Fase 4:** Disparos, Voz, Integrações, Origem, Agente, Privacidade.

Cada fase termina com `typecheck`, `build`, checagem de contraste e teste de teclado; a lógica (hooks, BFF, tipos) não muda.

## 12. Dependências

Instaladas na Fase 1 (aprovadas em 12/11/2026): `three` 0.187, `@react-three/fiber` **9.8.2**, `gsap` 3.15, `@gsap/react` 2.1 e `@types/three`.

**React 19.3.1:** o Next 15 roda o App Router com React 19 embutido, e o fiber 8 (React 18) quebrava o login (`ReactCurrentOwner`). O fiber 9 exige React 19 (`>=19 <19.4`), então `react`, `react-dom` e os tipos subiram junto. O projeto já usava o React 19 do Next em execução; agora as versões instaladas batem.

**Não instaladas (sem necessidade real até agora):** `@react-three/drei` (pesado; a cena usa só primitivas) e `lenis` (rolagem suave, só se a Decisão do piloto pedir).

O 3D vive em `src/app/login/` e é carregado por `dynamic import` (`ssr: false`): não entra no bundle das telas de trabalho. Aviso de console `THREE.Clock deprecated` vem do próprio fiber 9, não do nosso código.
