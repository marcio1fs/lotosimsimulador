import { defineConfig, loadEnv } from 'vite';

// Em desenvolvimento, a API (server/handler.js) roda dentro do próprio Vite: `npm run dev` basta.
export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, process.cwd(), '');
    if (env.DATABASE_URL) process.env.DATABASE_URL = env.DATABASE_URL;

    // Hosts extras aceitos pelo servidor de desenvolvimento (ex.: preview do
    // ambiente de execução). Vazio por padrão: em produção quem serve é a
    // Vercel, e liberar host arbitrário no dev abriria a porta para DNS
    // rebinding sem necessidade.
    const devAllowedHosts = String(env.VITE_DEV_ALLOWED_HOSTS || '')
        .split(',')
        .map(host => host.trim())
        .filter(Boolean);

    return {
        server: {
            allowedHosts: ['localhost', '127.0.0.1', ...devAllowedHosts]
        },
        plugins: [{
            name: 'lotomais-api',
            configureServer(server) {
                server.middlewares.use('/api', async (req, res) => {
                    req.url = '/api' + req.url;            // o Connect remove o prefixo montado
                    const { handler } = await server.ssrLoadModule('/server/handler.js');
                    return handler(req, res);
                });
            }
        }]
    };
});

