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
node --no-warnings test.cjs
```

Não há dependências npm. Windows também usa PowerShell 5.1 nos testes. Os testes usam perfis temporários e ferramentas de desktop simuladas; executar a suíte não instala o NotDex no seu perfil pessoal.

6. Envie a branch ao seu fork e abra um pull request para `main` no repositório original:

```sh
git add ARQUIVOS_ALTERADOS
git commit -m "fix: descreva a correcao"
git push -u origin fix/minha-correcao
```

Informe o problema, a mudança e os testes executados. O CI testa Windows, macOS e Linux. Uma contribuição de fork pode precisar de liberação do mantenedor para iniciar o workflow.

## Preservar o comportamento

- O hook deve terminar com código zero mesmo se clipboard, áudio ou notificação falharem.
- Som e notificação ficam no worker separado; evite aumentar o trabalho antes de iniciar o worker.
- Copie somente a resposta final; não exiba conteúdo da conversa na notificação.
- Preserve outros hooks, configurações e arquivos do usuário na instalação e remoção.
- Use fixtures sintéticas. Não publique credenciais, bancos locais, transcripts completos ou respostas privadas.
- Documente as plataformas realmente testadas. Uma suíte verde não comprova banners, permissões ou som num desktop real.
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

O ZIP inclui instaladores, runtime, README e LICENSE. Testes, modelos do GitHub e este guia ficam fora da distribuição de instalação. O Node privado é obtido diretamente de nodejs.org e não é empacotado no ZIP.
