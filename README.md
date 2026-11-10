# NotDex

Clipboard automático, notificações e observabilidade no próprio terminal do **Codex CLI**, em Windows, macOS e Linux desktop.

Ao terminar um turno, copia a resposta final e mostra uma notificação com o título da sessão e **métricas daquele turno**. O conteúdo da resposta não aparece na notificação. O painel permite alternar entre turno, última requisição e sessão, sem usar um modelo para calcular os dados.

**Prévia experimental:** testes automatizados cobrem os três sistemas; apresentação e som dependem do desktop. macOS ainda precisa de validação visual e sonora numa máquina real.

## Instalar

1. Tenha o [Codex CLI](https://developers.openai.com/codex/cli/) **0.167.0+** instalado e disponível no PATH.
2. [Baixe NotDex.zip](https://github.com/n1imp/NotDex/releases/download/v0.2.0-preview.1/NotDex.zip) e **extraia toda a pasta**.
3. Execute o instalador:

| Sistema | Instalar | Abrir Codex com o painel |
| --- | --- | --- |
| Windows 10/11 | Dois cliques em [Install.cmd](Install.cmd) | [NotDex.cmd](NotDex.cmd) |
| macOS 13.5+ | [install.command](install.command), ou `sh install.sh` | [notdex.command](notdex.command), ou `sh notdex.sh` |
| Linux com desktop | `sh install.sh` | `sh notdex.sh` |

4. Reinicie o Codex, abra **/hooks** e revise/confie nos dois hooks **NotDex**. Essa aprovação pertence à [política de hooks do Codex](https://learn.chatgpt.com/docs/hooks).

O ZIP inclui as dependências com versões e hashes fixados. O instalador reutiliza Node.js 24+ ou baixa uma cópia privada de nodejs.org, também com SHA-256 fixado. A instalação pelo ZIP não precisa de npm nem compilação. Linux pede consentimento antes de instalar ferramentas de desktop ausentes.

Abra o launcher na pasta em que deseja trabalhar, usando um terminal. Abrir o atalho pelo gerenciador de arquivos pode selecionar a pasta do NotDex como diretório de trabalho. O comando habitual `codex` continua com clipboard e notificações; o painel exige o launcher NotDex.

Se um atalho baixado for bloqueado, revise a origem e use o comando equivalente na pasta extraída:

```powershell
# Windows
& "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File .\install.ps1
.\NotDex.cmd
```

```sh
# macOS ou Linux
sh install.sh
sh notdex.sh
```

## Usar o painel

O painel começa no canto superior direito. Posição, visibilidade e escopo ficam salvos no perfil local.

| Tecla | Ação |
| --- | --- |
| **F12** | Abrir/fechar os controles; revelar um painel oculto |
| **Setas**, com controles abertos | Mover dentro do terminal |
| **Tab**, com controles abertos | Alternar turno, requisição e sessão |
| **H**, com controles abertos | Ocultar |
| **Esc**, com controles abertos | Encerrar o posicionamento |

O terminal precisa de pelo menos **52 colunas × 12 linhas**; em tamanhos menores, o painel fica oculto. No macOS, pode ser necessário **Fn+F12**. Um atalho reservado pelo terminal ou sistema precisa ser liberado pelo usuário.

Quem tem Node 24+ no PATH pode encaminhar argumentos do Codex:

```sh
node notdex.cjs -- resume
node notdex.cjs --codex-home '/caminho/Codex Home' -- resume
```

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

O instalador preserva configurações, hooks e aprovações alheias ao NotDex. Migra versões antigas para um servidor MCP residente e dois callbacks; reinicie e revise os novos hooks em **/hooks**. Não há alteração automática da confiança.

O runtime fica em `CODEX_HOME/notdex`, normalmente `~/.codex/notdex`. Preferências do painel e arquivos não gerenciados permanecem após a remoção. Cache privado do Node e pacotes Linux compartilhados também permanecem.

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

`-NoDownload` no Windows e `--no-download --no-system-packages` no Unix impedem downloads e instalação de pacotes. `-NodePath` seleciona um Node existente no Windows. Quem já tem Node 24+ pode executar `node install.cjs`.

O cache privado fica em `%LOCALAPPDATA%/NotDex/runtime`, `~/Library/Caches/NotDex/runtime` ou `${XDG_CACHE_HOME:-~/.cache}/notdex/runtime`. `NOTDEX_CACHE_HOME` permite outro destino. Unix verifica propriedade, permissões, ausência de links privados e hash do Node antes de reutilizar o cache, inclusive offline. O Node encontrado no PATH é considerado escolhido pelo usuário.

## Desenvolvimento e contribuição

Com Node 24+ e npm, execute `npm ci --ignore-scripts`, depois `npm test`. Os testes usam perfis temporários e fixtures; não instalam no perfil pessoal. O [CI](https://github.com/n1imp/NotDex/actions) valida Windows, macOS e Linux, incluindo PTY nativo. Testes automatizados não comprovam som audível, permissões ou aparência em cada desktop.

Contribua por [issues](https://github.com/n1imp/NotDex/issues) e pull requests; consulte [CONTRIBUTING.md](CONTRIBUTING.md). O ZIP inclui runtime, dependências e suas licenças, instaladores, README e [MIT](LICENSE). Testes, CI e documentos internos ficam fora do pacote.
