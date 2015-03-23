'use strict';

var app = require('app'); // Module to control application life.
var BrowserWindow = require('browser-window');

app.on('ready', function() {

    var windowMain = new BrowserWindow({
        // width: 0, height: 0, frame: false,
        show: false
    });

    // windowMain.show();
    // windowMain.openDevTools();

    windowMain.loadUrl('file://' + __dirname + '/index.html');
});
