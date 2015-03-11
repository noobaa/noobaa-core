var app = require('app');  // Module to control application life.
var BrowserWindow = require('browser-window');

app.on('ready', function() {
    var windowMain = new BrowserWindow({show: false}); // width: 0, height: 0, frame: false,
    windowMain.loadUrl('file://' + __dirname + '/index.html');
});
