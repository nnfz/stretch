const { spawn } = require('child_process');

process.env.NODE_ENV = 'development';

const electronPath = require('electron');

const electron = spawn(electronPath, ['.'], {
  stdio: 'inherit',
  env: { ...process.env, NODE_ENV: 'development' }
});

electron.on('close', (code) => {
  process.exit(code);
});
