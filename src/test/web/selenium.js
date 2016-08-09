'use strict';

const mocha = require('mocha');
const wd = require('selenium-webdriver');

function init_mocha() {

    mocha.before(function() {
        const prefs = new wd.logging.Preferences();
        prefs.setLevel(wd.logging.Type.BROWSER, wd.logging.Level.ALL);
        prefs.setLevel(wd.logging.Type.CLIENT, wd.logging.Level.ALL);
        prefs.setLevel(wd.logging.Type.DRIVER, wd.logging.Level.ALL);
        prefs.setLevel(wd.logging.Type.PERFORMANCE, wd.logging.Level.ALL);
        prefs.setLevel(wd.logging.Type.SERVER, wd.logging.Level.ALL);
        wd.logging.installConsoleHandler();
        this.driver = new wd.Builder()
            .forBrowser('chrome')
            .setLoggingPrefs(prefs)
            .build();
    });

    mocha.after(function() {
        return this.driver.quit();
    });

}

exports.init_mocha = init_mocha;
