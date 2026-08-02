'use strict';
// Regression test for extract.js's extraGlobals injection + MVFresh capture readiness
// (freshness plan Task 1: see .superpowers/sdd/PLAN-multiverse-freshness-v1-26-0802/task-1-brief.md).
const { loadModules, buildDrivers } = require('./extract.js');
const mods = loadModules();
// extraGlobals reach the context
const drivers = buildDrivers(mods, { extraGlobals: { __PROBE__: 42 } });
if (drivers[0].sandbox.__PROBE__ !== 42) throw new Error('extraGlobals not injected');
// CAPTURE_NAMES includes MVFresh (Task 2 defines it; name must be captured already)
const src = require('fs').readFileSync(__dirname + '/extract.js', 'utf8');
if (!/CAPTURE_NAMES[^\]]*'MVFresh'/.test(src)) throw new Error('MVFresh not in CAPTURE_NAMES');
// bare buildDrivers(mods) must stay byte-identical to pre-opts behavior: no leaked sandbox key,
// and still JSON-serializable (the vm sandbox is self-referential via sandbox.globalThis and
// would throw if it leaked onto the driver).
const bareDrivers = buildDrivers(mods);
if ('sandbox' in bareDrivers[0]) throw new Error('bare buildDrivers leaked a sandbox key onto the driver');
JSON.stringify(bareDrivers[0]);
console.log('extract extensions: ALL CLEAN');
