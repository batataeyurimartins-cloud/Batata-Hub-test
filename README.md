# Batata Secure Hub

Sistema com login obrigatório + admin panel.

## O que já faz

- login obrigatório no site
- sem cadastro público
- conta admin inicial
- admin cria contas
- admin exclui contas
- admin desativa/reativa contas
- admin bane por tempo
- admin redefine senha
- admin libera o site inteiro por tempo limitado
- páginas protegidas por sessão

## Conta inicial

- usuário: `admin`
- senha: `admin123`

Troca essa senha depois no painel.

## Como rodar

```bash
npm install
npm start
```

Depois abre:

```bash
http://localhost:3000
```

## Importante sobre hospedagem

Esse projeto usa arquivo JSON local para salvar usuários e configurações.
Então ele funciona bem localmente ou em host com disco persistente.

### Em Vercel

O frontend abre, mas **os dados não ficam salvos de forma confiável** porque o filesystem do ambiente não é persistente como um servidor comum.
Pra produção real no Vercel, você precisaria trocar o `data/db.json` por um banco real.

## Estrutura

- `server.js` -> backend Express
- `public/` -> páginas e estilo
- `data/db.json` -> usuários, configurações e logs

## Próximo passo recomendado

Se você quiser colocar isso no teu site final de verdade, o próximo passo é plugar esse login nas tuas páginas atuais e trocar o JSON por banco.
