'use strict';

// catch process uncaught exceptions, and treat as a panic and exit after logging
// since restarting the process is the most stable way of recovery
process.on('uncaughtException', err => panic('process uncaughtException', err));

function panic(message, err) {
    console.error('PANIC:', message, err.stack || err);
    process.exit(1);
}

exports.panic = panic;
