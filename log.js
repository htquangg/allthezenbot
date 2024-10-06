const util = require("util");
const { getDate } = require("./utils");

var logStdout = process.stdout;

console.debug = function () {
  const msg = "[debug]" + getDate() + util.format.apply(null, arguments);
  logStdout.write(msg + "\n");
};

console.log = function () {
  const msg = "[log]" + getDate() + util.format.apply(null, arguments);
  logStdout.write(msg + "\n");
};

console.error = function () {
  const msg = "[error]" + getDate() + util.format.apply(null, arguments);
  logStdout.write(msg + "\n");
};
