# NotDex

Clipboard automático e notificações com métricas para o **Codex CLI**, em Windows, macOS e Linux desktop.

Ao concluir um turno, o NotDex copia a resposta final e mostra o título da sessão, total de tokens, input, output, percentual de cache e latência. A resposta não aparece na notificação.

**Prévia experimental:** o timeout de cinco segundos ainda pode ser excedido no Windows; alguns desktops Linux não reproduzem o som. macOS ainda não teve validação visual e sonora nativa.

## Instalar em poucos passos

1. Tenha o [Codex CLI](https://developers.openai.com/codex/cli/) **0.166.0+** instalado e disponível no PATH.
2. [Baixe o NotDex.zip](https://github.com/n1imp/NotDex/releases/download/v0.1.0-preview.1/NotDex.zip) e **extraia toda a pasta**.
3. Abra o instalador do seu sistema:

| Sistema | Instalador |
| --- | --- |
| Windows 10/11 | Dois cliques em [Install.cmd](Install.cmd). |
| macOS 13.5+ | Abra [install.command](install.command), ou rode `sh install.sh` no Terminal. |
| Linux com desktop | Abra um terminal na pasta extraída e rode `sh install.sh`. |

4. Reinicie o Codex, abra **/hooks** e revise/confie no hook **NotDex** uma vez. Essa aprovação faz parte da [política de hooks do Codex](https://developers.openai.com/codex/hooks/).

O instalador reutiliza Node.js 24+ ou baixa uma cópia privada de nodejs.org, com versão e SHA-256 fixados. Não é necessário instalar pacotes npm. No Linux, solicita consentimento antes de instalar ferramentas de desktop ausentes.

Se um atalho baixado for bloqueado, revise a origem e use o comando equivalente dentro da pasta extraída:

```powershell
# Windows
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\install.ps1
```

```sh
# macOS ou Linux
sh install.sh
```

## Desinstalar ou atualizar

- **Windows:** abra [Uninstall.cmd](Uninstall.cmd).
- **macOS:** abra [uninstall.command](uninstall.command).
- **macOS/Linux:** também pode executar `sh uninstall.sh` na pasta extraída.
- **Atualizar:** extraia uma versão nova e execute seu instalador novamente. O hook gerenciado não é duplicado.

Outros hooks e configurações são preservados. O runtime fica em `CODEX_HOME/notdex`, por padrão `~/.codex/notdex`. O cache privado do Node e pacotes Linux compartilhados permanecem após desinstalar.

## Requisitos e limites conhecidos

- Uma sessão gráfica local é necessária; SSH/headless não oferece este fluxo de clipboard e notificações.
- Windows requer PowerShell 5.1. A inicialização fria do PowerShell excedeu cinco segundos em testes reais; `exit 0` não impede o Codex de encerrar um processo por timeout.
- macOS usa `pbcopy`, AppleScript e o som `Glass`. Permissões e apresentação ainda precisam de teste em um Mac real.
- Linux usa `notify-send` e `wl-copy` em Wayland, ou `xclip`/`xsel` em X11. O instalador oferece dependências via apt-get, dnf, pacman ou zypper. O daemon decide se aceita o som solicitado; Xfce4 Notifyd 0.9.4 no Ubuntu testado exibiu o banner, mas ficou sem som.
- O bootstrap cobre x64/ARM64 quando houver binário oficial compatível. Linux requer kernel 4.18+ e glibc 2.28+; musl x64 é experimental. Outras arquiteturas exigem Node.js 24+ compatível no PATH. Veja as [plataformas do Node 24](https://github.com/nodejs/node/blob/v24.22.2/BUILDING.md#platform-list).
- O primeiro download requer internet; Unix também precisa de curl ou wget. Políticas administrativas ou hooks explicitamente desabilitados podem impedir a integração.
- Se você já usa um hook de notificação manual, desative o antigo para evitar avisos duplicados.
- Círculos coloridos são emojis; a aparência depende do sistema. Não há garantia de cópia abaixo de 50 ms.

## Métricas e privacidade

**Total, input e output** são acumulados da sessão. **Cache** é `cached_input_tokens / input_tokens × 100`. **Lat. turno** usa a duração do turno; `~` identifica uma estimativa e `N/D` indica dados indisponíveis. Cache e raciocínio não são somados novamente ao total.

O NotDex lê o índice, o banco local em modo somente leitura e o transcript informado pelo Codex. Formatos internos podem mudar. A resposta segue somente para o clipboard local; o worker recebe metadados. O runtime não envia telemetria nem faz chamadas de rede.

## Opções avançadas

`CODEX_HOME` seleciona outro perfil. Também é possível informar o destino explicitamente:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\install.ps1 -CodexHome 'D:\Codex Home'
```

```sh
sh install.sh --codex-home '/caminho/Codex Home'
```

Use o mesmo destino ao iniciar o Codex e ao desinstalar. `-NoDownload` no Windows e `--no-download --no-system-packages` no Unix impedem downloads e instalação de pacotes. `-NodePath` seleciona um Node existente no Windows. Quem já tem Node 24+ pode executar `node install.cjs`.

O cache privado fica em `%LOCALAPPDATA%/NotDex/runtime` no Windows, `~/Library/Caches/NotDex/runtime` no macOS e `${XDG_CACHE_HOME:-~/.cache}/notdex/runtime` no Linux. `NOTDEX_CACHE_HOME` permite outro destino.

## Desenvolvimento

O repositório inclui testes sintéticos e [CI em Windows/macOS/Linux](https://github.com/n1imp/NotDex/actions). Execute `node --no-warnings test.cjs` com Node 24+. O ZIP de instalação exclui testes, CI e documentos internos. Testes automatizados não comprovam permissão, aparência ou som em cada desktop.

## Licença

Nenhuma licença de redistribuição foi definida nesta prévia.