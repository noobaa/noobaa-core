/* Copyright (C) 2016 NooBaa */
'use strict';

const mocha = require('mocha');
const wd = require('selenium-webdriver');

function init_mocha() {

    mocha.before(function() {
        const self = this; // eslint-disable-line no-invalid-this
        const prefs = new wd.logging.Preferences();
        prefs.setLevel(wd.logging.Type.BROWSER, wd.logging.Level.ALL);
        prefs.setLevel(wd.logging.Type.CLIENT, wd.logging.Level.ALL);
        prefs.setLevel(wd.logging.Type.DRIVER, wd.logging.Level.ALL);
        prefs.setLevel(wd.logging.Type.PERFORMANCE, wd.logging.Level.ALL);
        prefs.setLevel(wd.logging.Type.SERVER, wd.logging.Level.ALL);
        wd.logging.installConsoleHandler();
        self.driver = new wd.Builder()
            .forBrowser('chrome')
            .setLoggingPrefs(prefs)
            .build();
    });

    mocha.after(function() {
        const self = this; // eslint-disable-line no-invalid-this
        return self.driver.quit();
    });

}

exports.init_mocha = init_mocha;
