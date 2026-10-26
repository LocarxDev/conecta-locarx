// Variáveis mínimas para importar os módulos nos testes (nada se conecta de verdade).
process.env.CHAVE_CRIPTOGRAFIA ||= Buffer.alloc(32, 7).toString('base64');
process.env.DATABASE_URL ||= 'postgres://teste:teste@localhost:5432/teste';
process.env.APP_URL ||= 'https://conecta.locarx.com.br';
process.env.FRONTEND_ORIGINS ||= 'https://conecta.locarx.com.br';
process.env.LOCARX_API_TOKEN ||= 'token-de-teste';
process.env.LOCARX_API_URL ||= 'https://portalhml.locarx.com.br/api';
