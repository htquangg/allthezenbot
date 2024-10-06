function sleep(ms) {
  let timeout = null;
  return new Promise((resolve) => {
    timeout = setTimeout(
      () => {
        clearTimeout(timeout);
        resolve();
      },
      ms + randomIntFromInterval(100, 3 * 1e3),
    );
  });
}

function formarCurrency(labelValue) {
  // Nine Zeroes for Billions
  return Math.abs(Number(labelValue)) >= 1.0e9
    ? (Math.abs(Number(labelValue)) / 1.0e9).toFixed(2) + "B"
    : // Six Zeroes for Millions
      Math.abs(Number(labelValue)) >= 1.0e6
      ? (Math.abs(Number(labelValue)) / 1.0e6).toFixed(2) + "M"
      : // Three Zeroes for Thousands
        Math.abs(Number(labelValue)) >= 1.0e3
        ? (Math.abs(Number(labelValue)) / 1.0e3).toFixed(2) + "K"
        : Math.abs(Number(labelValue));
}

function randomIntFromInterval(min, max) {
  // min and max included
  return Math.floor(Math.random() * (max - min + 1) + min);
}

function getDate() {
  const today = new Date();
  return (
    "[" +
    today.getFullYear() +
    "-" +
    (today.getMonth() + 1) +
    "-" +
    today.getDate() +
    " " +
    today.getHours() +
    ":" +
    today.getMinutes() +
    ":" +
    today.getSeconds() +
    "]"
  );
}

function cleanupAndExit(code = 0) {
  console.log(`cleanupAndExit done`);
  process.exit(code);
}

module.exports = {
  sleep,
  formarCurrency,
  randomIntFromInterval,
  getDate,
  cleanupAndExit,
};
