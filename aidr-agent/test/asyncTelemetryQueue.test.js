const assert = require("assert");
const { AsyncTelemetryQueue } = require("../src/observability/asyncTelemetryQueue");

(async () => {
  const processed = [];
  const queue = new AsyncTelemetryQueue(async item => {
    processed.push(item.eventId);
  }, { maxSize: 10, batchSize: 2, flushIntervalMs: 1 });
  assert.equal(queue.enqueue({ eventId: "low-1", severity: "low" }), true);
  assert.equal(queue.enqueue({ eventId: "high-1", severity: "high" }), true);
  assert.equal(await queue.flush(), true);
  assert.deepEqual(processed.sort(), ["high-1", "low-1"]);
  assert.equal(queue.getStatus().processed, 2);

  const saturated = new AsyncTelemetryQueue(async () => {}, { maxSize: 10, flushIntervalMs: 1000 });
  for (let index = 0; index < 10; index += 1) saturated.enqueue({ eventId: "info-" + index, severity: "info" });
  assert.equal(saturated.enqueue({ eventId: "critical-1", severity: "critical" }), true);
  assert.equal(saturated.getStatus().dropped, 1);
  assert.equal(saturated.getStatus().droppedBySeverity.info, 1);
  await saturated.stop({ drain: false });
  assert.equal(saturated.enqueue({ eventId: "late", severity: "high" }), false);
  console.log("async telemetry queue tests passed");
})().catch(error => { console.error(error); process.exitCode = 1; });
