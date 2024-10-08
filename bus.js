class EventBus {
  #listeners = {};

  dispatch(eventNames, data) {
    let tempEventNames = [];
    if (eventNames instanceof Array) {
      tempEventNames = eventNames;
    } else {
      tempEventNames = [eventNames];
    }

    tempEventNames.forEach((eventName) => {
      if (this.#listeners[eventName]) {
        this.#listeners[eventName].forEach((handler) => handler.callback(data));
      }
    });
  }

  async dispatchAsync(eventNames, data) {
    let tempEventNames = [];
    if (eventNames instanceof Array) {
      tempEventNames = eventNames;
    } else {
      tempEventNames = [eventNames];
    }

    tempEventNames.forEach(async (eventName) => {
      if (this.#listeners[eventName]) {
        try {
          const results = await Promise.allSettled(
            this.#listeners[eventName].map(async (handler) => {
              await handler.callback(data);
            }),
          );

          results.forEach((result, idx) => {
            if (result.status === "rejected") {
              console.error(
                `[EVENT] failed to handler event: ${eventName} -- handler ${
                  this.#listeners[eventName][idx]?.callback?.name || "anonymous"
                }`,
                result.reason?.message || result.reason,
                result.reason?.stack,
              );
            }
          });
        } catch (error) {
          console.error(
            `[EVENT] enexpected error when handler event: ${eventName}`,
            error?.message,
            error?.stack,
          );
        }
      }
    });
  }

  on(eventName, callback) {
    if (!this.#listeners[eventName]) {
      this.#listeners[eventName] = [];
    }
    this.#listeners[eventName].push({ callback });
  }

  off(eventName, callback = null) {
    if (callback !== null && callback instanceof Function) {
      this.#listeners[eventName]
        .filter((handler) => handler.callback === callback)
        .forEach((handler) =>
          this.#listeners[key].splice(this.#listeners[key].indexOf(handler), 1),
        );
      if (!this.#listeners[eventName]?.length) {
        delete this.#listeners[eventName];
      }
      return;
    }
    delete this.#listeners[eventName];
  }
}

const eventBus = new EventBus();

module.exports = {
  EventBus,
  eventBus,
};
