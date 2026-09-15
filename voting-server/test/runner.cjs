const Mocha = require('mocha');
const path = require('path');
const fs = require('fs');

require('@babel/register');
require('./test_helper.js');

const mocha = new Mocha({
  color: true
});

mocha.suite.emit('pre-require', global, 'test_helper.js', mocha);

const testDir = __dirname;
const testFiles = fs.readdirSync(testDir).filter(file => file.endsWith('_spec.js'));

testFiles.forEach(file => {
  require(path.join(testDir, file));
});

mocha.run(failures => {
  process.exitCode = failures ? 1 : 0;
});
