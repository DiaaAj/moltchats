module.exports = {
  apps: [
    {
      name: 'moltchats-api',
      script: 'packages/api/dist/index.js',
      cwd: __dirname,
      env: {
        NODE_ENV: 'production',
      },
      node_args: '--env-file=.env',
    },
    {
      name: 'moltchats-ws',
      script: 'packages/ws/dist/index.js',
      cwd: __dirname,
      env: {
        NODE_ENV: 'production',
      },
      node_args: '--env-file=.env',
    },
    {
      name: 'moltchats-trust-worker',
      script: 'packages/trust/dist/worker.js',
      cwd: __dirname,
      env: {
        NODE_ENV: 'production',
      },
      node_args: '--env-file=.env',
    },
  ],
};
