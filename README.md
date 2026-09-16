# ZPL para PDF

Converte etiquetas ZPL em um único PDF pronto para visualizar, baixar ou imprimir.
Aplicação pública: não tem login, conta nem cadastro.

## Como funciona

1. Cole o código ZPL ou envie um arquivo `.zpl`, `.txt`, `.prn` ou `.zip`.
2. Confira o resumo dos blocos e ajuste tamanho, densidade e rotação.
3. Baixe ou imprima o PDF.

Até 500 etiquetas por conversão.

### O resumo dos blocos

Antes de converter, a tela lista o que será feito com cada bloco `^XA…^XZ` do
arquivo:

- **etiqueta** — vira uma página do PDF
- **N cópias** — o bloco traz `^PQ`, então gera várias páginas iguais
- **modelo** — bloco `^DF`, reaproveitado pelas etiquetas que usam `^XF`
- **ignorado** — não gera etiqueta, com o motivo (normalmente um bloco só de
  configuração da impressora)

Esse resumo existe porque o descarte silencioso de blocos confunde: um arquivo
com um bloco de configuração e uma etiqueta `^PQ2` gera duas páginas iguais e
parece, à primeira vista, que as etiquetas do arquivo foram trocadas.

## Privacidade

Não há servidor próprio nem banco de dados. A montagem do PDF acontece no
navegador; o ZPL é enviado apenas ao serviço de renderização da
[Labelary](https://labelary.com) para virar imagem. Nenhuma etiqueta é
armazenada.

## Desenvolvimento

```bash
npm install
npm run dev
```

```bash
npm run build
```

Stack: React 19, TypeScript, Vite, Tailwind CSS 4, pdf-lib e PDF.js.
