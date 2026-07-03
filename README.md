# Analyzer Data

Aplicacao web estatica para analisar arquivos CSV de bonus diretamente no navegador.

O processamento acontece localmente no dispositivo do usuario por meio de JavaScript e Web Worker. O arquivo importado nao e enviado para servidor, API externa ou backend.

## Como Usar

1. Abra o app publicado ou rode o projeto localmente.
2. Importe um arquivo CSV no seletor da tela inicial.
3. Aguarde o processamento local do arquivo.
4. Consulte os cards de resumo, filtros, rankings, tabelas Top 20 e graficos.
5. Use os filtros e a busca textual para recalcular os resultados por recorte.

## Tecnologias

- React
- Vite
- JavaScript
- Web Worker
- Recharts
- GitHub Pages
- GitHub Actions

## Desenvolvimento

Instalar dependencias:

```bash
npm install
```

Rodar em ambiente local:

```bash
npm run dev
```

Gerar build de producao:

```bash
npm run build
```
