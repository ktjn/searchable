// A stand-in for the v1.1.2-era worker script (pre typed-error protocol):
// it replies to `init` with the legacy result shape (no protocolVersion)
// and reports every error with the legacy `{ message }` payload only. Used
// to prove the current index.js fails safely against a stale cached worker
// instead of hanging the request it can't deserialize
// (docs/reference/compatibility.md, worker-protocol.ts).
//
// When served with `?fail=1`, init is rejected with a legacy error -- the
// "deploy mixed for a moment" case for a bad manifest.
self.addEventListener("message", (event) => {
  const msg = event.data;
  const fail = new URL(self.location.href).searchParams.get("fail");
  if (msg.type === "init") {
    if (fail === "1") {
      self.postMessage({
        type: "error",
        id: msg.id,
        message: "legacy init rejected: invalid manifest",
      });
      return;
    }
    self.postMessage({
      type: "result",
      id: msg.id,
      result: { hits: [], totalHits: 0, language: "en" },
    });
    return;
  }
  self.postMessage({
    type: "error",
    id: msg.id,
    message: "legacy worker: unexpected request",
  });
});
