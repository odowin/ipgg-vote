module.exports = {
  apps: [{
    name: 'ipgg-vote',
    script: 'server.js',
    instances: 1,  // SQLite requires single instance
    autorestart: true,
    watch: false,
    max_memory_restart: '500M',
    env_production: {
      NODE_ENV: 'production',
      PORT: 3000,
    },
    error_file: './logs/error.log',
    out_file:   './logs/out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
  }],
};
