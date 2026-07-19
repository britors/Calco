# Calco

Editor de planilhas desktop nativo, escrito integralmente em Rust e GTK4.

## Executar

Pré-requisitos: Rust estável, GTK 4.14 ou posterior e os headers de desenvolvimento do GTK4.

```sh
cargo run
```

Para validar:

```sh
cargo fmt --check
cargo clippy --all-targets -- -D warnings
cargo test
```

## Empacotamento

Os arquivos em `packaging/` cobrem Flatpak, RPM e AUR. O manifesto Flatpak pode ser construído a partir da raiz com `flatpak-builder build-dir packaging/br.com.w3ti.Calco.yml`. A integração contínua também valida builds nativos no Linux, macOS e Windows com GTK4 instalado.

## Arquitetura

- `src/model.rs`: contrato serializado, compatível com `formatVersion: 1` do app anterior.
- `src/workbook.rs`: armazenamento esparso, abas, estilos e undo/redo.
- `src/formula.rs`: interface de cálculo e implementação nativa inicial.
- `src/format.rs`: leitura e gravação do contêiner ZIP `.calco`.
- `src/ui.rs`: shell GTK4, barra de fórmulas, abas e grade Cairo virtualizada.

A grade desenha somente a região invalidada/visível e mantém capacidade nominal de 100.000 linhas por 1.000 colunas. Não há um widget GTK por célula.

## Estado da compatibilidade

A migração cobre a base funcional já utilizável: edição direta com teclado, navegação e seleção retangular, copiar/recortar/colar em TSV, localizar/substituir, inserção/exclusão estrutural de linhas e colunas com ajuste de referências A1, CSV UTF-8/Windows-1252, importação/exportação XLSX, fórmulas numéricas, textuais e datas básicas com referências entre abas, gerenciamento de abas, formatação e mesclagens por seleção, histórico e arquivos `.calco`.

A engine de fórmulas está isolada por `CellLookup` e pode continuar recebendo novas funções sem acoplar a interface.

## Licença

GPL-3.0-only.
