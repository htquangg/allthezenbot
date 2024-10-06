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
  return Math.abs(Number(labelValue)) >= 1.0e24
    ? (Math.abs(Number(labelValue)) / 1.0e24).toFixed(3) + "Y"
    : Math.abs(Number(labelValue)) >= 1.0e21
      ? (Math.abs(Number(labelValue)) / 1.0e21).toFixed(3) + "Z"
      : Math.abs(Number(labelValue)) >= 1.0e18
        ? (Math.abs(Number(labelValue)) / 1.0e18).toFixed(3) + "E"
        : Math.abs(Number(labelValue)) >= 1.0e15
          ? (Math.abs(Number(labelValue)) / 1.0e15).toFixed(3) + "P"
          : Math.abs(Number(labelValue)) >= 1.0e12
            ? (Math.abs(Number(labelValue)) / 1.0e12).toFixed(3) + "T"
            : Math.abs(Number(labelValue)) >= 1.0e9
              ? (Math.abs(Number(labelValue)) / 1.0e9).toFixed(3) + "B"
              : Math.abs(Number(labelValue)) >= 1.0e6
                ? (Math.abs(Number(labelValue)) / 1.0e6).toFixed(3) + "M"
                : Math.abs(Number(labelValue)) >= 1.0e3
                  ? (Math.abs(Number(labelValue)) / 1.0e3).toFixed(3) + "K"
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
