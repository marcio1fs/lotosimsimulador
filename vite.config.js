import { defineConfig, loadEnv } from 'vite';

// Em desenvolvimento, a API (server/handler.js) roda dentro do próprio Vite: `npm run dev` basta.
export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, process.cwd(), '');
    if (env.DATABASE_URL) process.env.DATABASE_URL = env.DATABASE_URL;

    return {
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

