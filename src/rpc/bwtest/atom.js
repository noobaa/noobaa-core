'use strict';

// Module to control application life in atom-shell

var app = require('app');
var BrowserWindow = require('browser-window');

app.on('ready', function() {
    var win = new BrowserWindow({});
    win.openDevTools();
    win.loadUrl('http://localhost:5999');
});
