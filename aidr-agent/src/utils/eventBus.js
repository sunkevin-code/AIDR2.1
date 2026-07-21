const EventEmitter = require("events");

class EventBus extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(50);
  }

  publish(topic, data) {
    this.emit(topic, data);
  }
}

module.exports = { EventBus };
