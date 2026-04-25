# Changelog

## [1.3.0] - 2026-04-24

### ✨ Resiliência e Persistência de Estado (F5)

- **Mantimento de Funcionamento:** O radar agora sincroniza seu estado com o backend ao recarregar a página (F5). Se o monitoramento estiver ativo no servidor, a interface restaurará automaticamente o botão "Monitorando" e o polling de alertas.

- **Persistência de Alertas:** Implementação de persistência local do `lastAlertId`. Ao atualizar o dashboard, o sistema não dispara notificações duplicadas para ofertas que o usuário já visualizou antes do refresh.

- **Sincronização de Configurações:** Sincronização automática da lista de grupos monitorados entre o frontend e o backend durante a inicialização da sessão.

## [1.1.0] - 2026-04-20

### ✨ Novidades e Inteligência

- Sistema de Abas Independentes: Os níveis de monitoramento (Amplo, Marcas e Modelos) agora funcionam como menus isolados, permitindo ativar ou pausar cada radar de forma individual sem interferência entre os painéis.

- "Clickbait Killer": Implementação de lógica para extrair o nome real do produto, removendo frases de gatilho comuns em canais de ofertas (ex: "NGM MERECE COMER MARMITA FRIA").

- Expansão de Categorias: Adição de suporte completo para monitoramento de Moda & Acessórios, Games & Hardware e Esportes.

- Detecção de Pagamento: O motor agora identifica condições de preço, como descontos exclusivos no PIX ou parcelamentos sem juros.

### 🛠️ Arquitetura e Performance

- Modularização de Estilos: Migração de todo o CSS interno da extensão para um arquivo dedicado (dashboard.css), facilitando a manutenção e o carregamento.

- Refatoração do Backend: Reorganização estrutural do server.py para suportar múltiplos níveis de busca simultâneos e processamento paralelo de categorias.

- Automação de Releases: Integração total com GitHub Actions para geração automática de pacotes .zip e publicação de releases a cada nova tag de versão.

### 🐞 Correções

- Isolamento de Memória: Correção de bug onde a seleção de uma categoria em um nível ativava erroneamente a mesma categoria em outro painel.

- Sanitização de Cache: Implementação de rotina para limpar estados antigos de memória (Ghost State) ao carregar novas versões da extensão.
