import { WorkspaceStore } from "./store.js";
process.umask(0o077);
const store = new WorkspaceStore(process.env.DATA_DIR || "./data");
try { console.log(await store.snapshot()); } finally { store.close(); }
