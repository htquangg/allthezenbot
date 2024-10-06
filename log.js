const util = require("util");

const chalk = require("chalk");

const { getDate } = require("./utils");

var logStdout = process.stdout;

console.debug = function () {
  const msg =
    chalk.cyan("[debug]") +
    getDate() +
    " " +
    util.format.apply(null, arguments);
  logStdout.write(msg + "\n");
};

console.log = function () {
  const msg =
    chalk.green("[log]") + getDate() + " " + util.format.apply(null, arguments);
  logStdout.write(msg + "\n");
};

console.error = function () {
  const msg =
    chalk.red("[error]") +
    " " +
    getDate() +
    " " +
    util.format.apply(null, arguments);
  logStdout.write(msg + "\n");
};
