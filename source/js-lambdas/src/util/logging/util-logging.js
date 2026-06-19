const info = (...args) => console.log("[INFO]", ...args);
const warn = (...args) => console.warn("[WARN]", ...args);
const error = (...args) => console.error("[ERROR]", ...args);
const debug = (...args) => console.debug("[DEBUG]", ...args);

module.exports = { info, warn, error, debug };
