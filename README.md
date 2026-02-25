# Tim Workspaces

Agregador de ferramentas web em um único ambiente: WhatsApp, Gmail, Microsoft Teams, Slack e outras aplicações que você usa no dia a dia. Centralize suas comunicações e produtividade em uma única janela.

## Screenshot

![Tim Workspaces](docs/screenshots/timworkspaces.png)

> Screenshots serão adicionados em `docs/screenshots/`.

## Instalação e execução

```bash
# Clone o repositório
git clone https://github.com/renatoruis/timworkspaces.git
cd timworkspaces

# Instale as dependências (use pnpm)
pnpm install

# Execute o aplicativo
pnpm run start
```

Alternativa com npm:

```bash
npm install
npm run start
```

## Funcionalidades principais

- **Integração múltipla** — WhatsApp, Gmail, Teams, Slack e outras ferramentas em abas
- **Interface unificada** — Uma janela para todas as suas aplicações web
- **Cross-platform** — Funciona em Windows, macOS e Linux
- **Leve e simples** — Interface minimalista e funcional
- **Gratuito** — Sem custos e sempre será

## Tecnologias

- [Electron](https://www.electronjs.org/) — Framework para aplicativos desktop multiplataforma
- JavaScript/HTML/CSS

## Website

A pasta `/website` contém a landing page do projeto. Para publicar:

1. Adicione `logo.png` e `screenshot.png` em `/website`
2. Hospede o conteúdo em GitHub Pages, Vercel ou similar, apontando para a pasta `website`

## Release

Ao fazer merge na `main`, a pipeline GitHub Actions compila para Windows, macOS e Linux e publica em [Releases](https://github.com/renatoruis/timworkspaces/releases). Atualize a versão em `package.json` antes do merge.

## Download

Versões compiladas e instaladores estão disponíveis em: **[Website / Releases](https://github.com/renatoruis/timworkspaces/releases)**

## Contribuir

Contribuições são bem-vindas! Você pode:

- Abrir [Issues](https://github.com/renatoruis/timworkspaces/issues) para reportar bugs ou sugerir melhorias
- Enviar [Pull Requests](https://github.com/renatoruis/timworkspaces/pulls) com correções ou novas funcionalidades
- Melhorar documentação, traduções ou a experiência do usuário

Tim Workspaces é **gratuito e sempre será** — feito com a colaboração da comunidade.

## Licença

Este projeto está licenciado sob [Creative Commons Attribution-NonCommercial 4.0 (CC BY-NC 4.0)](LICENSE) — permite uso, modificação e compartilhamento, mas proíbe uso comercial (incluindo venda).
