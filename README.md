# Batata Protected v2

Versão fechada do site com:
- login obrigatório
- sem cadastro público
- conta admin inicial
- painel admin
- criar conta
- excluir conta
- ban temporário
- ativar/desativar conta
- redefinir senha
- liberar o site para todos por tempo limitado

## Login inicial
- usuário: admin
- senha: admin123

## Como rodar
```bash
npm install
npm start
```

Depois abra:
```bash
http://localhost:3000
```

## Observação
Os usuários ficam salvos em `data/db.json`.
Isso funciona bem localmente, mas para produção séria é melhor trocar por banco de dados.
