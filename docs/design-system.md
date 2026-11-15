# Design system: Prontuário (com camadas da Cobertura)

Direção escolhida em 12/11/2026: **A (Prontuário) como base**. Revisões no mesmo dia, a pedido do cliente interno: fonte única (IBM Plex Sans), **menos efeito nas telas de dado** (efeito só em controles, gráficos e na entrada) e nova cena de entrada: o **funil vivo**.
Valores marcados *(proposta)* são decisões minhas ainda **não validadas com a marca do cliente**. Contrastes foram calculados (WCAG 2.x).

> Marca, nome e logo são **configuração** (`web/src/lib/brand.ts`, a criar na Fase 1): a identidade ainda não foi atribuída a um cliente. Nada neste documento usa a Identidade Horizon (laranja/azul-marinho), que é só da agência.

## 1. Conceito

O painel é um **CRM sóbrio e legível**: azul-petróleo, uma fonte única e números alinhados. Quem abre o painel deve sentir calma e precisão, não "mais um dashboard".

- **Assunto:** corretora de planos de saúde. Reduzir o plano do cliente sem perder cobertura é tirar camadas sem quebrar a estrutura. Daí as camadas.
- **Momento-assinatura:** o funil 3D do login (relacionado ao produto: contatos que viram vendas). Fora dele, o efeito se limita a botões, gráficos e ao microfone da Voz; nenhum efeito sobre o dado.
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

> **Revisão de 12/11/2026:** a paleta inicial (papel quente + coral) foi trocada por **azul-petróleo corporativo**, escolhida pelo cliente interno entre três candidatas com contraste calculado. O coral e a menta saíram; o laranja-queimado ficou só para **urgência**.

### Tema claro

| Token | Hex | Uso | Contraste |
|---|---|---|---|
| `--paper` | `#F4F7F8` | Fundo da página | |
| `--card` | `#FFFFFF` | Superfícies elevadas | |
| `--ink` | `#16222B` | Texto principal | 15,03 (AAA) |
| `--mute` | `#55636E` | Texto secundário | 5,74 (AA) |
| `--line` | `#D6DEE2` | Divisórias e bordas | decorativo |
| `--brand` | `#0B6B8A` | Botão primário, links, dados (linhas e barras) | branco: 6,03; sobre o fundo: 5,60 |
| `--deep` | `#10222D` | Botão primário e superfícies escuras. O **menu lateral** acompanha o tema: `--card` com filete no claro, `--deep` no escuro | branco: 16,3 |
| `--sinal` | `#C2410C` | **Urgência**: conversa esperando resposta, lead parado | 5,18 |
| `--ok` / `--warn` / `--bad` | `#15803D` / `#A16207` / `#B91C1C` | Sucesso, atenção, erro | 4,66 / 4,57 / 6,01 (AA) |

### Tema escuro

`--paper #0F1A21`, `--card #162430`, `--ink #E6EEF2` (15,02), `--mute #98A8B2` (7,21), `--brand #4FB3D3` (7,33; texto sobre ele `#0F1A21`), `--ok #4ADE80`, `--warn #F5BE46`, `--bad #FC8181`, `--sinal #FB923C`, `--deep #080F14`. Todos AA.

Regra: azul = ação e dado; laranja = precisa de atenção; verde/âmbar/vermelho = estado. Ação e sucesso nunca dividem a mesma cor.

## 4. Tipografia

| Papel | Fonte | Observação |
|---|---|---|
| Tudo (títulos, texto, números) | **IBM Plex Sans** | Uma família só, pesos 400/500/600/700. Feita para interfaces corporativas; números tabulares (`tabular-nums`) alinham colunas de valores; acentuação completa. Títulos em 600, texto em 400, rótulos em 500. |

> Revisão de 12/11/2026: a combinação inicial (Instrument Serif nos títulos e IBM Plex Mono nos números) cansava a leitura em tela de trabalho. Os papéis `font-display` (título) e `font-mono` (número) continuam existindo como classes, mas apontam para a mesma família.

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
| **Entrada (login)** | Duas colunas: à esquerda o **funil do CRM** em 3D (800 contatos descem por seis anéis, a maioria some pelo caminho, poucos chegam ao fim em verde = venda; taxas ilustrativas); à direita o formulário. SVG estático equivalente no celular, em máquina fraca, sem WebGL e com movimento reduzido. | R3F (shader de pontos) |
| **Gráficos** | Funil do dashboard desenha a linha ao carregar; barras mudam de altura com transição suave ao trocar o período. | GSAP / CSS |
| **Botões** | Resposta ao clique (leve afundamento) e estados de carregando; param com redução de movimento. | CSS |
| **Microfone (Voz)** | Indica o **estado** da ligação, não o áudio (a chamada é pelo telefone): na fila o microfone respira; tocando emite ondas; em ligação aparecem barras de voz e o cronômetro; encerrada, para. Botão Ligar pulsa 3 vezes ao aparecer. Parado com redução de movimento. | CSS |
| ~~Fita de ECG, contagem animada, entrada de página~~ | **Removidos** do painel: competiam com o dado (revisão de 12/11/2026). | — |

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

Para qualquer imagem, ícone ou cena 3D gerados: *"Estilo limpo e corporativo, fundo claro #F4F7F8, tinta #16222B, um único acento azul-petróleo #0B6B8A, laranja #C2410C só para urgência. Sem gradiente roxo/azul, sem brilho neon, sem pessoas estereotipadas, sem cruz médica clichê. Composição assimétrica com respiro.

Cenas: (1) funil visto de cima em 3/4, pontos luminosos descendo em vórtice, anéis finos, fundo petróleo; (2) o mesmo funil estático, em linhas e pontos, para o SVG de reserva; (3) camada vazia tracejada para estados vazios.

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
