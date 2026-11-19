'use strict';
const fs = require('node:fs');
const path = require('node:path');

module.exports = function diagnostics(directory) {
  const file = path.join(directory, 'desktop.log');
  return (event, details = {}) => {
    try {
      fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
      if (fs.existsSync(file) && fs.statSync(file).size > 1024 * 1024)
        fs.renameSync(file, file + '.previous');
      fs.appendFileSync(
        file,
        JSON.stringify({ at: new Date().toISOString(), event, ...details }) + '\n',
        { mode: 0o600 },
      );
    } catch {
      // Diagnostics must never bring down the app (including on a full disk).
    }
  };
};
