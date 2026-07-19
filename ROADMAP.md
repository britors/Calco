# Roadmap da migração GTK4

## Já portado

- Documento esparso `.calco` compatível com `formatVersion: 1`.
- Grade Cairo virtualizada, navegação, edição e seleção retangular por teclado.
- Clipboard TSV, localizar/substituir, histórico global e múltiplas abas.
- Inserção/exclusão de linhas e colunas, deslocando conteúdo, referências A1, estilos, mesclagens e dimensões como uma única operação no histórico.
- Negrito, itálico, cores, alinhamentos e bordas por seleção, persistidos no `.calco` e renderizados pelo Cairo inclusive em células vazias.
- Mesclar/desmesclar células com validação de sobreposição, histórico, hit-test, editor e renderização Cairo.
- Adicionar, selecionar, renomear e excluir abas com validação de nomes, histórico e proteção da última planilha.
- Novo, abrir, salvar e salvar como com atalhos, filtros nativos de arquivo e diálogo Sobre.
- Proteção contra descarte de alterações ao criar, abrir, importar ou fechar.
- Seleção por arraste, `Shift`+clique, cabeçalhos de linha/coluna e `Ctrl+A` progressivo.
- Dimensões personalizadas no Cairo, mesclagens, hit-test, seleção, editor e scroll, com redimensionamento por arraste e undo.
- Fórmulas aritméticas, referências A1, intervalos, `SUM`/`SOMA`, `AVERAGE`/`MÉDIA`, `MIN` e `MAX`.
- Importação e exportação CSV UTF-8, com detecção de delimitador e valores calculados na exportação.
- CSV Windows-1252 e escolha explícita de codificação/delimitador.
- Importação e exportação XLSX de abas, valores, fórmulas, mesclagens, estilos e dimensões.
- Detecção de ciclos e propagação de erros entre fórmulas dependentes.
- Funções aninhadas, comparações, referências absolutas/mistas, operadores unários e funções `IF`/`SE`, `COUNT`, `ABS`, `ROUND`, `SQRT` e `POWER`.
- Strings, concatenação, comparações textuais, `IF`/`SE` textual, `DATE`/`DATA`, `YEAR`/`ANO`, `MONTH`/`MÊS`, `DAY`/`DIA` e funções textuais comuns.
- `VLOOKUP`/`PROCV` e normalização pt-BR consciente de strings, preservando separadores e vírgulas dentro de textos literais.
- Clipboard HTML/TSV com estilos, colagem somente valores e ajuste relativo de fórmulas internas.
- Abertura por argumento/associação, autosave recuperável, arquivos recentes e menu de aplicação em pt-BR.
- Cache de cálculo compartilhado por ciclo de renderização/exportação, evitando reavaliar dependências repetidas.
- Metadados e receitas para Flatpak, RPM e AUR, além de validação contínua de build no Linux, Windows e macOS.

## Migração concluída

- O runtime, a interface, formatos, testes e automações usam somente Rust/GTK4.
- O repositório contém somente a implementação nativa e suas dependências Rust/GTK4.
- A cobertura da engine inclui todas as fórmulas exercitadas pela suíte do aplicativo anterior.

## Evoluções posteriores

- Produzir instaladores finais assinados para Windows e macOS; os builds nativos já são validados na integração contínua.
- Ampliar a engine com funções adicionais e operações avançadas de datas conforme demanda.
