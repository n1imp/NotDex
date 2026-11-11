# Contribuir com o NotDex

Você pode relatar problemas, sugerir melhorias ou enviar correções por pull request. Não é necessário acesso de escrita ao repositório original.

## Preparar uma alteração

1. Consulte as [issues](https://github.com/n1imp/NotDex/issues) para evitar trabalho duplicado. Para mudanças grandes, descreva primeiro o problema e a proposta em uma issue.
2. Faça um fork pelo botão **Fork** no GitHub.
3. Clone seu fork e crie uma branch:

```sh
git clone https://github.com/SEU_USUARIO/NotDex.git
cd NotDex
git remote add upstream https://github.com/n1imp/NotDex.git
git switch -c fix/minha-correcao
```

4. Faça uma alteração com escopo claro. Adicione uma regressão quando corrigir comportamento.
5. Com Node.js 24+, execute:

```sh
npm ci --ignore-scripts --no-audit --no-fund
node --no-warnings test.cjs
```

As dependências têm versões e integridade fixadas em `package-lock.json`; nenhum script de instalação é executado. Windows também usa PowerShell 5.1 nos testes. Os testes usam perfis temporários, ferramentas de desktop simuladas e PTY nativo; executar a suíte não instala o NotDex no seu perfil pessoal.

Para conferir manualmente um perfil temporário sem alterar seus shells, use `node install.cjs --codex-home CAMINHO_TEMPORARIO --no-shell-integration`. Ao removê-lo, use `node uninstall.cjs --codex-home CAMINHO_TEMPORARIO --no-shell-integration`. O instalador padrão modifica o PATH do usuário e/ou os arquivos de inicialização dos shells; reserve-o para testes explícitos dessa integração.

6. Envie a branch ao seu fork e abra um pull request para `main` no repositório original:

```sh
git add ARQUIVOS_ALTERADOS
git commit -m "fix: descreva a correcao"
git push -u origin fix/minha-correcao
```

Informe o problema, a mudança e os testes executados. O CI testa Windows, macOS e Linux. Uma contribuição de fork pode precisar de liberação do mantenedor para iniciar o workflow.

## Preservar o comportamento

- O hook deve terminar com código zero mesmo se clipboard, áudio ou notificação falharem.
- Confirme o callback MCP antes do trabalho do worker. Clipboard, som e notificação não podem bloquear o transporte MCP.
- Copie somente a resposta final; não exiba conteúdo da conversa na notificação.
- Preserve outros hooks, configurações e arquivos do usuário na instalação e remoção.
- Confira o comando normal `codex`, retomada de sessão e passagem direta de comandos não interativos. Evite recursão entre o launcher gerenciado e o executável original, inclusive com aliases de diretório e outros perfis.
- Preserve codificação e permissões dos perfis de shell, edições posteriores e aprovações dos hooks. Teste instalação repetida e remoção usando homes temporários e registro Windows simulado.
- Use fixtures sintéticas. Não publique credenciais, bancos locais, transcripts completos ou respostas privadas.
- Documente as plataformas realmente testadas. Uma suíte verde não comprova banners, permissões ou som num desktop real.
- Métricas precisam de registros reais ou fixtures equivalentes. Mostre `N/D` quando faltarem dados; US$ de referência não é cobrança da assinatura e quota da conta não é quota de um chat.
- Preserve a entrada e a restauração do terminal. Atalhos do painel só interceptam teclas documentadas, fora de texto colado.
- Código, dependências e assets adicionados devem ter licença compatível com a [MIT](LICENSE). Preserve avisos de terceiros quando necessários.

## Atualizar a branch de trabalho

```sh
git fetch upstream
git switch main
git merge --ff-only upstream/main
git switch -c fix/outra-correcao
```

Se houver alterações locais ou divergência, resolva-as antes de atualizar; não descarte trabalho para seguir estes comandos.

## Publicar uma versão — mantenedores

Após integrar e validar as alterações:

1. Escolha uma versão ainda não usada. Atualize o link de download no [README](README.md) e as instruções afetadas pela mudança.
2. Integre essas alterações em `main` e aguarde o CI.
3. Na versão de `main` que será publicada, crie e envie a tag. Exemplo de prévia:

```sh
git switch main
git pull --ff-only
git tag v0.2.0-preview.1
git push origin v0.2.0-preview.1
```

Substitua a versão do exemplo pela versão escolhida. Não mova nem reutilize tags publicadas.

O [workflow de release](.github/workflows/release.yml) repete os testes nos três sistemas. Só depois publica `NotDex.zip` e `SHA256SUMS.txt`. Tags com hífen geram prévias; tags como `v0.2.0` geram releases regulares. Apenas pessoas com permissão para enviar tags ao repositório original podem disparar essa publicação.

O ZIP inclui instaladores, runtime, dependências com licenças, README e LICENSE. O workflow verifica os hashes dos seis pacotes nativos x64/ARM64 de Windows, macOS e Linux antes de incluí-los; a instalação pelo ZIP não pode depender de npm. Testes, modelos do GitHub e este guia ficam fora da distribuição. O Node privado é obtido diretamente de nodejs.org e não é empacotado.

Ao atualizar a versão do Node, atualize `scripts/node-version.txt` e `scripts/node-shasums.txt`. Para cada plataforma Unix, registre o SHA-256 do arquivo `.tar.gz` e do executável `bin/node`. Confira primeiro o arquivo contra os checksums oficiais de nodejs.org; só então extraia e calcule o hash do executável, sem executá-lo. Valide os testes de bootstrap nos três sistemas.
