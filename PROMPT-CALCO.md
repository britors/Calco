# PROMPT DE IMPLEMENTAÇÃO — CALCO

> **Produto:** Calco — Editor de planilhas da suíte Atelier (W3TI)
> **Licença:** GPLv3
> **Stack:** Electron + TypeScript
> **Identidade visual:** Verde-lima (cor primária da marca)
> **Público-alvo:** Usuário final não-técnico (mesmo perfil do Lyra OS)

---

## 1. Contexto e posicionamento

Você vai implementar o **Calco**, um editor de planilhas desktop, open-source (GPLv3), parte da suíte Atelier da W3TI — ao lado do **Prosa** (texto) e do **Pulso** (apresentações).

Regras de posicionamento que NÃO podem ser violadas:

1. **O Calco é um app standalone.** O nome "Atelier" nunca aparece para o usuário. Nada de "Atelier Calco" em janela, menu, instalador ou about. O produto se chama apenas **Calco**.
2. **Sem integração com Nexus** (Filo/Orbi/Gero). O Calco não conhece o ecossistema proprietário.
3. **Simplicidade acima de completude.** O Calco não compete com o Excel em quantidade de features — compete em clareza. Se uma feature exige manual, ela está errada ou fica fora do MVP.
4. Será distribuído via **Flatpak** (canal principal do Lyra OS) e **AUR** (pacote `calco`, seguindo o padrão do `prosa`). Também gerar builds para Windows (NSIS) e macOS (dmg) via electron-builder.

---

## 2. Arquitetura Electron (obrigatória)

Mesmo modelo de segurança do Lyrae:

- `contextIsolation: true`
- `nodeIntegration: false`
- `sandbox: true` no renderer
- Toda I/O de arquivo acontece no **main process**, exposta ao renderer via `contextBridge` + IPC tipado (canal por operação, payloads validados).
- Nenhum `remote`, nenhum `eval`, nenhum `shell.openExternal` sem allowlist de protocolos (`https:` apenas).
- CSP estrita no `index.html`.

### Processos

```
main/          → ciclo de vida, janelas, menu nativo, file I/O, recent files, auto-update (desligado por padrão em Flatpak)
preload/       → contextBridge com API tipada (CalcoAPI)
renderer/      → UI + engine de planilha (roda 100% sem privilégio)
shared/        → tipos compartilhados (contratos IPC, modelo de documento)
```

### Contrato IPC mínimo (tipar em `shared/ipc.ts`)

```typescript
interface CalcoAPI {
  file: {
    open(): Promise<OpenResult | null>;          // dialog + leitura
    save(doc: SerializedWorkbook): Promise<SaveResult>;
    saveAs(doc: SerializedWorkbook): Promise<SaveResult>;
    export(doc: SerializedWorkbook, format: 'xlsx' | 'csv' | 'pdf'): Promise<SaveResult>;
    getRecent(): Promise<RecentFile[]>;
  };
  app: {
    getVersion(): Promise<string>;
    onMenuAction(cb: (action: MenuAction) => void): void;
  };
}
```

---

## 3. Engine de cálculo — decisão fechada

Usar **HyperFormula** como engine de fórmulas.

Justificativa (não reavaliar): é GPLv3 — mesma licença do Calco, zero conflito —, tem ~400 funções compatíveis com Excel, grafo de dependências incremental, suporte a ranges, named expressions e undo/redo nativo. Escrever engine própria de fórmulas está **fora de escopo**.

Configuração:
- Locale de funções: **pt-BR** (HyperFormula suporta tradução de nomes de função — `SOMA`, `SE`, `PROCV` etc.). Manter também aceitação dos nomes em inglês na entrada.
- Separador de argumentos: `;` (padrão pt-BR), decimal `,` — respeitando o locale do sistema, com override nas preferências.

---

## 4. Renderização da grade — decisão fechada

A grade é renderizada em **Canvas 2D com virtualização** (desenhar apenas células visíveis + buffer). NÃO usar DOM por célula (uma `<div>`/`<td>` por célula não escala).

Requisitos de performance:
- Scroll fluido (60fps) com **100.000 linhas × 1.000 colunas** de capacidade nominal.
- Modelo de dados **esparso** (Map por célula preenchida, nunca matriz densa).
- Edição inline: um único `<input>`/`<textarea>` overlay posicionado sobre a célula ativa.
- Camadas separadas: grade/gridlines → conteúdo → seleção/borda ativa → cabeçalhos congelados.
- Suporte a DPI alto (devicePixelRatio).

Sugestão: implementar a grade como módulo isolado (`renderer/grid/`) com API própria, sem dependência do resto da UI — facilita testes e reuso futuro.

---

## 5. Formato de arquivo

### Formato nativo: `.calco`

ZIP contendo:
```
manifest.json      → versão do formato, versão do app, metadados
workbook.json      → sheets, células (valores + fórmulas como texto), estilos, larguras/alturas, merges, named ranges
media/             → imagens embutidas (pós-MVP)
```

Regras:
- Fórmulas são persistidas como **string canônica em inglês com separador `,`** (formato interno estável); a tradução pt-BR é só camada de apresentação. Isso evita corromper arquivos ao trocar de locale.
- Versionamento do formato desde o dia 1 (`formatVersion: 1`), com política de leitura forward-tolerant.

### Interoperabilidade

- **Importar:** `.xlsx` (via SheetJS ou exceljs — avaliar fidelidade de estilos; exceljs preferido por licença MIT e suporte a estilos), `.csv` (com diálogo de delimitador/encoding).
- **Exportar:** `.xlsx`, `.csv`, `.pdf` (impressão da área usada, via `webContents.printToPDF`).
- `.ods` fica **pós-MVP** (registrar em ROADMAP).

---

## 6. Escopo funcional do MVP

### Incluído

| Área | Funcionalidades |
|---|---|
| Pastas e abas | Múltiplas sheets, renomear, reordenar (drag), duplicar, excluir, cor da aba |
| Edição | Digitação direta, F2, autocomplete de funções com assinatura, referências clicáveis ao editar fórmula, preenchimento por arraste (fill handle) com detecção de série (números, datas, dias da semana) |
| Seleção | Ranges, múltiplos ranges (Ctrl), linhas/colunas inteiras, Ctrl+A progressivo |
| Formatação | Negrito/itálico/sublinhado, fonte e tamanho, cor de texto/fundo, bordas, alinhamento, quebra de texto, mesclar células |
| Formato numérico | Geral, número (casas decimais), moeda (R$ por locale), porcentagem, data/hora, texto |
| Estrutura | Inserir/excluir linhas e colunas, redimensionar (mouse + duplo-clique para autofit), ocultar/reexibir, congelar painéis |
| Dados | Ordenar range (asc/desc, múltiplas chaves), filtro automático simples (dropdown por coluna), localizar e substituir |
| Fórmulas | Tudo que o HyperFormula oferece; barra de fórmulas; indicador de erro por célula (`#REF!`, `#DIV/0!` etc. com tooltip explicativo em português claro) |
| Clipboard | Copiar/recortar/colar interno com estilos; colar de/para Excel e Google Sheets via TSV + HTML clipboard; colar especial (valores, fórmulas, formatação) |
| Histórico | Undo/redo ilimitado na sessão, agrupamento de ações compostas |
| Gráficos | **Básico no MVP:** colunas, barras, linhas e pizza, a partir de um range selecionado, como objeto flutuante. Usar Chart.js ou ECharts (avaliar peso). Sem editor avançado de gráfico no MVP |
| Arquivo | Novo, abrir, salvar, salvar como, recentes, autosave de recuperação (snapshot temporário a cada 60s), aviso de alterações não salvas |
| Impressão | Visualizar/exportar PDF com área de impressão, orientação e escala básica |

### Explicitamente FORA do MVP (registrar em `ROADMAP.md`)

Tabelas dinâmicas, validação de dados, formatação condicional, macros/scripting, colaboração em tempo real, comentários, proteção de células, imagens embutidas, `.ods`, tema de gráficos avançado.

---

## 7. UI/UX

- **Identidade:** cor primária **verde-lima** (definir tokens: `--calco-primary`, variações hover/active, e par acessível para texto sobre o verde — validar contraste WCAG AA). Ícone e splash próprios do Calco.
- Layout clássico e imediatamente reconhecível: barra de menus nativa + toolbar de formatação + barra de fórmulas (com caixa de nome à esquerda) + grade + barra de abas + status bar (soma/média/contagem da seleção à direita, como Excel).
- **Tema claro e escuro**, seguindo o sistema por padrão (importante: o Lyra OS usa dark por padrão).
- Idioma da UI: **pt-BR primeiro**, com i18n estruturado desde o início (arquivos de tradução JSON, en-US como segunda língua).
- Atalhos padrão de mercado (Ctrl+B/I/U, Ctrl+Z/Y, Ctrl+F/H, Ctrl+PgUp/PgDn entre abas, F2, F4 alternando referência absoluta/relativa na edição).
- Acessibilidade mínima: navegação completa por teclado, foco visível, leitores de tela pelo menos na toolbar e diálogos (a grade canvas expõe célula ativa via `aria-live`).

---

## 8. Estrutura do projeto

```
calco/
├── package.json              → electron, electron-builder, typescript, vite (renderer), vitest
├── electron-builder.yml      → targets: AppImage/flatpak-ready (linux), nsis (win), dmg (mac)
├── src/
│   ├── main/
│   │   ├── index.ts
│   │   ├── menu.ts           → menu nativo pt-BR
│   │   ├── file-io.ts        → open/save/export, recentes, autosave de recuperação
│   │   └── windows.ts
│   ├── preload/index.ts      → contextBridge (CalcoAPI)
│   ├── renderer/
│   │   ├── app/              → shell da UI, toolbar, barra de fórmulas, status bar, diálogos
│   │   ├── grid/             → canvas grid isolado (render, hit-testing, seleção, edição inline)
│   │   ├── engine/           → adapter sobre HyperFormula (modelo de documento ↔ HF)
│   │   ├── formats/          → serialização .calco, import/export xlsx/csv
│   │   ├── charts/           → objetos de gráfico
│   │   └── i18n/             → pt-BR.json, en-US.json
│   └── shared/
│       ├── ipc.ts            → contratos tipados
│       └── model.ts          → SerializedWorkbook, Sheet, Cell, Style
├── tests/                    → vitest: engine adapter, serialização, séries do fill handle, parsing csv
├── LICENSE                   → GPLv3
├── README.md
└── ROADMAP.md                → itens pós-MVP listados na seção 6
```

---

## 9. Requisitos de qualidade (critérios de aceite)

1. `npm run typecheck` limpo, `strict: true` no tsconfig, zero `any` não justificado.
2. Testes unitários cobrindo: adapter do engine, round-trip `.calco` (salvar → abrir → documento idêntico), import/export xlsx de um arquivo de referência, detecção de séries do fill handle, parsing CSV com `;` e `,`.
3. Abrir um `.xlsx` de 50.000 linhas em < 3s e manter scroll fluido.
4. Nenhuma perda de dados: fechar com alterações sempre pergunta; crash recupera do autosave.
5. Fórmula digitada como `=SOMA(A1;B1)` funciona, é persistida como `=SUM(A1,B1)` e reabre corretamente em qualquer locale.
6. App abre em < 2s em hardware modesto (alvo do Lyra OS).

---

## 10. Entregáveis

1. Projeto completo compilável (`npm install && npm run dev` funcional).
2. `README.md` com build, arquitetura resumida e decisões de design.
3. `ROADMAP.md` com o backlog pós-MVP.
4. Arquivo `.calco` de exemplo (demonstrando fórmulas, formatação, múltiplas sheets e um gráfico).
5. Configuração do electron-builder pronta para gerar os três targets.

---

## 11. O que NÃO fazer

- Não inventar integração com outros produtos W3TI.
- Não usar DOM por célula na grade.
- Não escrever parser/engine de fórmulas próprio.
- Não persistir fórmulas traduzidas (pt-BR é só apresentação).
- Não exibir o nome "Atelier" em lugar nenhum da UI.
- Não adicionar telemetria de nenhum tipo.
