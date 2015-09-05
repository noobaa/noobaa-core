'use strict';
var native_core = require('./src/util/native_core')('MUST LOAD');
var n = new native_core.Nudp();
n.on('message', function(m) {
    console.log('RECEIVED MESSAGE', m.toString());
});
if (process.argv[2]) {
    n.connect('127.0.0.1', 9090);
    setTimeout(function() {
        // n.send(new Buffer('yo yo, whats up'));
    }, 1000);
} else {
    n.bind('127.0.0.1', 9090);
}
