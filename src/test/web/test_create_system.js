'use strict';

// const _ = require('lodash');
// const assert = require('assert');
const mocha = require('mocha');
const wd = require('selenium-webdriver');

const P = require('../../util/promise');
const selenium = require('./selenium');

selenium.init_mocha();

mocha.describe('create_system', function() {
    this.timeout(300000);

    mocha.it('should fill signup form and create system', function() {
        const d = this.driver;
        const URL = 'http://127.0.0.1:5001';
        console.log('Loading URL:', URL);
        return d.get(URL)
            .then(() => console.log('Wait for page title ...'))
            .then(() => d.wait(wd.until.titleIs('NooBaa Management Console'), 2000))
            .then(() => console.log('Wait for url to change to signup ...'))
            .then(() => d.wait(wd.until.urlIs(URL + '/fe/login'), 3000))
            .then(() => console.log('Wait for input element ...'))
            .then(() => d.wait(wd.until.elementLocated(wd.By.tagName('input')), 1000))
            .then(() => d.findElements(wd.By.tagName('input')))
            .then(inputs => P.join(
                    inputs[0].sendKeys('123'),
                    inputs[1].sendKeys('demo@noobaa.com'),
                    inputs[2].sendKeys('DeMo'),
                    inputs[3].sendKeys('DeMo')
                )
                .then(() => d.findElements(wd.By.tagName('button')))
                .then(buttons => P.delay(500)
                    .then(() => console.log('Wait for button to click next ...'))
                    .then(() => d.wait(wd.until.elementIsVisible(buttons[1]), 1000))
                    .then(() => buttons[1].click())
                    .then(() => console.log('Wait for input element in second step ...'))
                    .then(() => d.wait(wd.until.elementIsVisible(inputs[4]), 1000))
                    .then(() => console.log('Wait for button to create system ...'))
                    .then(() => d.wait(wd.until.elementIsVisible(buttons[2]), 1000))
                    .then(() => inputs[4].sendKeys('demo'))
                    .then(() => P.delay(500))
                    .then(() => buttons[2].click())
                )
            )
            .then(() => console.log('Wait for url to open the created system ...'))
            .then(() => d.wait(wd.until.urlIs(URL + '/fe/systems/demo'), 3000))
            .then(() => console.log('Done! system created.'));
    });

});
