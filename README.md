# NotDex

Clipboard automático, notificações do último turno e painel de observabilidade no próprio terminal do **Codex CLI**, em Windows, macOS e Linux desktop.

Instale uma vez e continue usando **`codex`**, **`codex resume`** ou **`codex fork`**. O painel é ativado automaticamente nas sessões interativas.

**Versão atual: [v0.2.0-preview.4](https://github.com/n1imp/NotDex/releases/tag/v0.2.0-preview.4)** · [Baixar ZIP](https://github.com/n1imp/NotDex/releases/download/v0.2.0-preview.4/NotDex.zip) · [Relatar problema](https://github.com/n1imp/NotDex/issues)

Ao terminar um turno, copia a resposta final e mostra uma notificação com o título da sessão e **métricas daquele turno**. O conteúdo da resposta não aparece na notificação. O painel permite alternar entre turno, última requisição e sessão, sem usar um modelo para calcular os dados.

**Prévia experimental:** testes automatizados cobrem os três sistemas; apresentação e som dependem do desktop. macOS ainda precisa de validação visual e sonora numa máquina real.

## Instalar

1. Tenha o [Codex CLI](https://developers.openai.com/codex/cli/) **0.167.0+** instalado e disponível no PATH.
2. [Baixe NotDex.zip](https://github.com/n1imp/NotDex/releases/download/v0.2.0-preview.4/NotDex.zip) e **extraia toda a pasta**.
3. Execute o instalador:

| Sistema | Instalar | Usar após instalar |
| --- | --- | --- |
| Windows 10/11 | Dois cliques em [Install.cmd](Install.cmd) | Abra um terminal novo e rode `codex` |
| macOS 13.5+ | [install.command](install.command), ou `sh install.sh` | Abra um terminal novo e rode `codex` |
| Linux com desktop | `sh install.sh` | Abra um terminal novo e rode `codex` |

4. Feche e reabra o terminal. Na pasta do seu projeto, execute `codex`.
5. Se o Codex solicitar revisão, abra **/hooks** e revise os callbacks **NotDex** de início da sessão, envio e conclusão do turno. Essa aprovação pertence à [política de hooks do Codex](https://learn.chatgpt.com/docs/hooks).

O ZIP inclui as dependências com versões e hashes fixados. O instalador reutiliza Node.js 24+ ou baixa uma cópia privada de nodejs.org, também com SHA-256 fixado. A instalação pelo ZIP não precisa de npm nem compilação. Linux pede consentimento antes de instalar ferramentas de desktop ausentes.

O instalador integra o painel ao comando habitual `codex`, inclusive `codex resume` e `codex fork`. Execute-o na pasta do projeto. O executável oficial permanece intacto. Comandos como `codex exec`, `app-server`, ajuda, versão e pipes seguem diretamente para o Codex, sem painel.

Os atalhos NotDex continuam disponíveis. A integração cobre o CLI no terminal; não injeta um painel no app desktop, na extensão do VS Code nem em programas que chamem o executável oficial por caminho absoluto. Aliases ou funções `codex` definidos pelo usuário podem ter precedência sobre o PATH.

### Instalação pelo terminal

Execute somente o bloco do seu sistema, dentro da pasta extraída. Se um atalho baixado for bloqueado, revise a origem antes de usar o comando equivalente.

```powershell
# Windows
& "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File .\install.ps1
```

```sh
# macOS ou Linux
sh install.sh
```

Depois que o instalador terminar, **abra um terminal novo** na pasta do projeto:

```sh
codex
```

Se usa o terminal integrado e o comando ainda carregar o PATH antigo, feche e reabra o VS Code. A instalação padrão já configura a integração; os launchers [NotDex.cmd](NotDex.cmd), [notdex.command](notdex.command) e [notdex.sh](notdex.sh) continuam disponíveis para uso direto ou portátil.

## Usar o painel

O painel começa no canto superior direito. Posição, visibilidade e escopo ficam salvos no perfil local.

| Tecla | Ação |
| --- | --- |
| **F9** | Abrir o command center nativo do Codex; liberar a navegação e suspender o painel |
| **F12** | Abrir/fechar os controles; revelar um painel oculto |
| **Setas**, com controles abertos | Mover dentro do terminal |
| **Tab**, com controles abertos | Alternar turno, requisição e sessão |
| **H**, com controles abertos | Ocultar |
| **Esc**, com controles abertos | Encerrar o posicionamento |
| **Digitar ou colar texto** | Encerrar o posicionamento e encaminhar a entrada ao Codex |

**F9** é configurado somente na execução pelo NotDex, por meio de `tui.keymap.global.open_agents`; o arquivo de atalhos do usuário é preservado. Se F9 já aparece num atalho explícito do perfil, projeto ou argumentos `-c`, o NotDex preserva essa configuração e mostra `/agents` no rodapé. Argumentos `-c` explícitos do usuário têm precedência. Ao navegar com F9 gerenciado pelo NotDex, o painel cede espaço ao command center. Enter/Esc devolvem a apresentação; F12 também revela o painel. A suspensão é temporária e não altera a visibilidade salva.

A troca de sessão limpa as métricas anteriores. A identificação vem dos eventos do Codex ou de um `codex resume ID` explícito; o NotDex não escolhe a conversa mais recente do disco. Quando o Codex não entrega `SessionStart` porque o MCP ainda está iniciando, os tokens aguardam o próximo evento de envio/conclusão. `Aguardando identificacao da sessao` indica esse estado. Ao trocar de chat por outra entrada nativa, como `/agents`, a vinculação depende do evento do Codex. Compactação automática não muda a seleção do painel.

O painel compõe texto e métricas numa única passagem e atualiza somente as linhas alteradas, sem apagar a tela a cada amostra.

O terminal precisa de pelo menos **52 colunas × 12 linhas**; em tamanhos menores, o painel fica oculto. No macOS, pode ser necessário **Fn+F9/F12**. Um atalho reservado pelo terminal ou sistema precisa ser liberado pelo usuário.

Quem tem Node 24+ no PATH pode encaminhar argumentos do Codex:

```sh
node notdex.cjs -- resume
node notdex.cjs --codex-home '/caminho/Codex Home' -- resume
```

Na instalação padrão, o comando habitual também aceita os argumentos do Codex, por exemplo `codex resume --last`.

## De onde vêm as métricas

- **Tokens:** registros locais do Codex, separados por sessão, turno e resposta. `token_usage_record` tem preferência; formatos antigos usam diferenças acumuladas somente quando existe uma base confiável. Replays do mesmo ID não somam o consumo novamente.
- **Cache:** `cached_input_tokens / input_tokens × 100`. Cache e raciocínio não são somados outra vez ao total.
- **Latência:** duração informada pelo Codex, ou intervalo entre início e fim do turno. `~` identifica um turno ainda em andamento; não representa tempo de rede isolado.
- **US$ ref.std:** referência calculada com os [preços Standard da API](https://developers.openai.com/api/docs/pricing), tabela conferida em **2026-11-10**, por modelo e requisição, incluindo desconto de cache e faixa de contexto. **Não é a cobrança do plano ChatGPT.** Histórico incompleto, modelo desconhecido ou preço ambíguo produzem `N/D`.
- **Conta e cotas:** plano e percentuais reais fornecidos pelo `codex app-server`, com atualização a cada 60 segundos e eventos locais de quota. O painel mostra a idade da amostra. As janelas, como 5 horas e semana, pertencem à **conta inteira**; não são a parcela consumida por este chat. A assinatura não fornece uma conversão confiável entre tokens, dólares e percentual do plano.

`N/D` significa indisponível. O painel não estima o plano pelo e-mail, valor da assinatura ou quantidade de tokens. A notificação mostra **o último turno**, mesmo quando o painel está no escopo de sessão.

## Atualizar ou remover

Feche as sessões abertas pelo NotDex antes de atualizar, pois o sistema pode manter a biblioteca nativa do terminal em uso.

- **Atualizar:** baixe o [ZIP mais recente](https://github.com/n1imp/NotDex/releases), extraia numa pasta nova e execute o instalador novamente. Não basta atualizar os arquivos do clone.
- **Remover no Windows:** [Uninstall.cmd](Uninstall.cmd).
- **Remover no macOS:** [uninstall.command](uninstall.command).
- **Remover no macOS/Linux:** `sh uninstall.sh`.

O instalador preserva configurações, hooks e aprovações alheias ao NotDex. Migra versões antigas para um servidor MCP residente e três callbacks (`SessionStart`, `UserPromptSubmit`, `Stop`); reinicie e revise os novos hooks em **/hooks**. Não há alteração automática da confiança.

Se já existem hooks inline no TOML, o instalador usa essa representação, migra as definições do JSON e guarda uma cópia privada em `CODEX_HOME/notdex/hooks-backup-*.json`. Assim evita o aviso de duas representações na mesma camada. Hooks migrados de terceiros permanecem ao desinstalar; definições ambíguas ou blocos gerenciados editados são rejeitados para revisão.

A ativação adiciona somente um diretório próprio de comandos e blocos identificados nos arquivos de inicialização do shell. Windows cobre PowerShell 5/7 e o PATH do usuário; macOS/Linux cobrem Bash e Zsh. Feche e reabra o aplicativo de terminal ou VS Code se ele ainda herdar o PATH antigo. Caminhos de sistema com precedência ou shells não configurados podem exigir colocar `CODEX_HOME/notdex/bin` primeiro no PATH. A remoção retira as entradas gerenciadas e preserva edições posteriores do usuário.

O runtime fica em `CODEX_HOME/notdex`, normalmente `~/.codex/notdex`. Preferências do painel e arquivos não gerenciados permanecem após a remoção. Cache privado do Node e pacotes Linux compartilhados também permanecem.

Abra um terminal novo após remover o NotDex para descartar o PATH mantido pela sessão anterior.

## Resolver problemas

| Sintoma | O que conferir |
| --- | --- |
| `codex` abre sem painel | Abra um terminal novo; reinicie o VS Code se necessário. No PowerShell, confira `Get-Command codex`; no Bash/Zsh, `command -v codex`. O comando integrado deve apontar para `CODEX_HOME/notdex/bin`. Aliases, funções ou caminhos de sistema podem ter precedência. |
| Painel foi ocultado | Pressione **F12** para revelá-lo. Confira também o mínimo de 52 colunas × 12 linhas e, no macOS, tente **Fn+F12**. |
| Aviso sobre hooks em JSON e TOML | Execute novamente o instalador atual. Ele consolida os hooks do perfil e guarda um backup do JSON. Não apague outros hooks manualmente. Se o aviso apontar outro projeto ou perfil, confira a camada indicada pelo Codex. |
| Notificação não aparece ou fica sem som | Confira permissões de notificações, saída de áudio e Não perturbe. Jogos em tela cheia e o daemon de notificações Linux podem suprimir banner ou som. |
| Métrica aparece como `N/D` | O Codex ainda não forneceu os dados necessários ou o histórico/modelo não permite um cálculo confiável. Confira a seção sobre a origem das métricas. |

Ao [relatar um problema](https://github.com/n1imp/NotDex/issues), informe sistema, shell, versão do Codex, versão do NotDex e mensagem de erro. Remova credenciais, conteúdo de conversas e outros dados privados antes de anexar saídas.

## Execução e privacidade

O callback MCP confirma o evento antes de delegar o trabalho a um worker residente. Clipboard, consulta de métricas, notificação e som ficam fora desse caminho de confirmação. Isso remove a abertura de PowerShell por missão do prazo de cinco segundos. Outros hooks do usuário continuam com seus próprios limites.

O worker recebe a resposta somente para copiá-la no clipboard. O painel recebe metadados por HTTP autenticado, limitado ao loopback, e acompanha o transcript local. O banco local é aberto somente para leitura. Nenhum conteúdo da conversa é enviado ao painel ou a um serviço externo. A consulta oficial de conta pode usar a rede; o NotDex não envia telemetria nem faz chamadas de geração a modelos.

## Requisitos e limites

- É necessária uma sessão gráfica local; clipboard e notificações não têm este fluxo em SSH/headless. O painel requer terminal interativo com cores e sequências VT.
- **Windows:** PowerShell 5.1; som WAV do sistema, sem bipe de placa-mãe. O envio do toast precede o som; o Windows controla quando o banner aparece. Não há garantia de cópia em menos de 50 ms.
- **macOS:** `pbcopy`, AppleScript e som `Glass`; permissões e apresentação precisam de verificação no desktop real.
- **Linux:** `notify-send` e `wl-copy` em Wayland, ou `xclip`/`xsel` em X11. O instalador oferece dependências via apt-get, dnf, pacman ou zypper. O daemon decide se aceita o som; alguns exibem somente o banner.
- Não perturbe, configurações de áudio e jogos em tela cheia exclusiva podem suprimir banner e som. O NotDex respeita essas políticas; não tenta sobrepor jogos como Roblox, Minecraft ou Fortnite.
- Os binários de terminal incluídos cobrem **x64 e ARM64** de Windows, macOS e Linux. Linux requer glibc compatível com o binário distribuído; musl e outras arquiteturas não são cobertos pelo overlay nesta prévia.
- O primeiro download do Node requer internet; Unix também precisa de curl ou wget. Políticas administrativas e hooks desabilitados podem impedir a integração.
- Um hook manual antigo fora da propriedade do NotDex pode gerar avisos duplicados. Revise seus hooks se isso acontecer.
- O PTY usa `@lydell/node-pty` **1.2.0-beta.18**, fixado por integridade. Essa versão inclui a correção necessária de encerramento do helper Windows; continua sendo uma dependência beta.

## Opções avançadas

`CODEX_HOME` seleciona outro perfil. Use o mesmo destino ao instalar, abrir e remover:

```powershell
& "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File .\install.ps1 -CodexHome 'D:\Codex Home'
.\start.ps1 -CodexHome 'D:\Codex Home'
```

```sh
sh install.sh --codex-home '/caminho/Codex Home'
CODEX_HOME='/caminho/Codex Home' sh notdex.sh
```

`-NoDownload` no Windows e `--no-download --no-system-packages` no Unix impedem downloads e instalação de pacotes. `-NodePath` seleciona um Node existente no Windows. Quem já tem Node 24+ pode executar `node install.cjs`. Para uma instalação portátil sem alterar a inicialização dos shells, use `-NoShellIntegration` no PowerShell ou `--no-shell-integration` nos instaladores Node/Unix; nesse caso, abra pelo launcher NotDex.

O cache privado fica em `%LOCALAPPDATA%/NotDex/runtime`, `~/Library/Caches/NotDex/runtime` ou `${XDG_CACHE_HOME:-~/.cache}/notdex/runtime`. `NOTDEX_CACHE_HOME` permite outro destino. Unix verifica propriedade, permissões, ausência de links privados e hash do Node antes de reutilizar o cache, inclusive offline. O Node encontrado no PATH é considerado escolhido pelo usuário.

## Desenvolvimento e contribuição

Com Node 24+ e npm, execute `npm ci --ignore-scripts`, depois `npm test`. Os testes usam perfis temporários e fixtures; não instalam no perfil pessoal. O [CI](https://github.com/n1imp/NotDex/actions) valida Windows, macOS e Linux, incluindo PTY nativo. Testes automatizados não comprovam som audível, permissões ou aparência em cada desktop.

Contribua por [issues](https://github.com/n1imp/NotDex/issues) e pull requests; consulte [CONTRIBUTING.md](CONTRIBUTING.md). O ZIP inclui runtime, dependências, [avisos de terceiros](src/THIRD_PARTY_NOTICES.txt), instaladores, README e [MIT](LICENSE). Testes, CI e documentos internos ficam fora do pacote.
