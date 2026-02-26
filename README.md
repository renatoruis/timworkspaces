<p align="center">
  <img src="website/assets/logo-fundo-escuro.png" alt="Tim Workspaces" width="200">
</p>

<h1 align="center">Tim Workspaces</h1>

<p align="center">
  <a href="https://github.com/renatoruis/timworkspaces/releases"><img src="https://img.shields.io/github/v/release/renatoruis/timworkspaces?include_prereleases" alt="Release"></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/renatoruis/timworkspaces" alt="License"></a>
  <a href="https://github.com/renatoruis/timworkspaces/stargazers"><img src="https://img.shields.io/github/stars/renatoruis/timworkspaces" alt="Stars"></a>
  <a href="https://github.com/renatoruis/timworkspaces"><img src="https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey" alt="Platform"></a>
  <a href="https://www.electronjs.org/"><img src="https://img.shields.io/badge/Electron-37-47848f" alt="Electron"></a>
</p>

Agregador de ferramentas web em um único ambiente: WhatsApp, Gmail, Microsoft Teams, Slack e outras aplicações que você usa no dia a dia. Centralize suas comunicações e produtividade em uma única janela.

## Screenshot

![Tim Workspaces](website/screenshot-1.png)

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
- **Contas separadas** — Cada aba mantém sua própria sessão (múltiplas contas Gmail, etc.)
- **Interface unificada** — Uma janela para todas as suas aplicações web
- **Tema claro/escuro** — Alternância entre modos de visualização
- **Cross-platform** — Funciona em Windows, macOS e Linux
- **Leve e simples** — Interface minimalista e funcional
- **Gratuito** — Sem custos e sempre será

## Tecnologias

- [Electron](https://www.electronjs.org/) — Framework para aplicativos desktop multiplataforma
- JavaScript/HTML/CSS

## Website

A pasta `/website` contém a landing page do projeto. Para publicar:

1. A landing page já inclui logo e screenshots
2. Hospede o conteúdo em GitHub Pages, Vercel ou similar, apontando para a pasta `website`

## Release

Ao fazer merge na `main`, a pipeline GitHub Actions compila para Windows, macOS e Linux e publica em [Releases](https://github.com/renatoruis/timworkspaces/releases). Atualize a versão em `package.json` antes do merge.

## Download

Versões compiladas e instaladores estão disponíveis em: **[Releases](https://github.com/renatoruis/timworkspaces/releases)**

### Instalação no macOS

Baixe o `.dmg` na versão compatível (arm64 para Apple Silicon, x64 para Intel). Arraste o app para a pasta Aplicativos. Feche o app antes de ejetar o disco.

**Problemas comuns:**
- *"The volume can't be ejected"* — Feche o Tim Workspaces completamente (Cmd+Q) antes de ejetar. Não execute o app diretamente do DMG; arraste-o para Aplicativos primeiro.
- *Não sobrescreve a instalação anterior* — Exclua manualmente a versão antiga em Aplicativos antes de arrastar a nova.

## Contribuir

Contribuições são bem-vindas! Você pode:

- Abrir [Issues](https://github.com/renatoruis/timworkspaces/issues) para reportar bugs ou sugerir melhorias
- Enviar [Pull Requests](https://github.com/renatoruis/timworkspaces/pulls) com correções ou novas funcionalidades
- Melhorar documentação, traduções ou a experiência do usuário

Tim Workspaces é **gratuito e sempre será** — feito com a colaboração da comunidade.

## Licença

Este projeto está licenciado sob [Creative Commons Attribution-NonCommercial 4.0 (CC BY-NC 4.0)](LICENSE) — permite uso, modificação e compartilhamento, mas proíbe uso comercial (incluindo venda).
