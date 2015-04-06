'use strict';

// catch process uncaught exceptions, and treat as a panic and exit after logging
// since restarting the process is the most stable way of recovery
process.on('uncaughtException', panic.bind(null, 'process uncaughtException'));

module.exports = panic;

function panic(message, err) {
    console.error('PANIC:', message, err.stack || err);
    process.exit(1);
}
