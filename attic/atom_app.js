'use strict';

module.exports = function(filePath) {

    var app = require('app'); // Module to control application life.
    var BrowserWindow = require('browser-window');

    app.on('ready', function() {

        var windowMain = new BrowserWindow({
            // width: 0, height: 0, frame: false,
            show: false
        });

        /*windowMain.on('closed', function() {
         console.log('windowMain-closed');
         });

         windowMain.on('close', function() {
         console.log('windowMain-close');
         });

         windowMain.on('unresponsive', function() {
         console.log('windowMain-unresponsive');
         });*/

        windowMain.webContents.on('crashed', function() {
            //console.log('WebContents-crashed');
            windowMain.close();
        });

        windowMain.webContents.on('destroyed', function() {
            //console.log('WebContents-destroyed');
            windowMain.close();
        });

        // windowMain.show();
        // windowMain.openDevTools();

        windowMain.loadUrl('file://' + filePath);
    });

    app.on('window-all-closed', function() {
        app.quit();
    });
    return app;
};