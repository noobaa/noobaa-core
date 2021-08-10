/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const P = require('../../util/promise');
const mocha = require('mocha');
const assert = require('assert');
const fs = require('fs');
const DebugModule = require('../../util/debug_module');
const os_utils = require('../../util/os_utils');

// File Content Verifier according to given expected result (positive/negative)
function file_content_verify(flag, expected) {
    return P.delay(1000).then(function() {

        let content;
        if (os_utils.IS_MAC) {
            content = fs.readFileSync("./logs/noobaa.log", "utf8");
        } else {
            content = fs.readFileSync("/log/noobaa.log", "utf8");
        }
        if (flag === "text") { // Verify Log requests content
            assert(content.indexOf(expected) !== -1);
        } else if (flag === "no_text") { // Verify Log request DOES NOT appear
            assert(content.indexOf(expected) === -1);
        }
    });
}


mocha.describe('debug_module', function() {
    const self = this; // eslint-disable-line no-invalid-this

    //when log is 100MB, reading the log file for
    //verification can take about 1 sec.
    //various logs test creates inconsistency as it may reach timeout.
    self.timeout(10000);

    // This test case fails becauuse __filename is full path !
    // shouldn't the module trim the base path ??
    mocha.it('should parse __filename', function() {
        //CI integration workaround
        var filename = __filename.indexOf('noobaa-util') >= 0 ?
            __filename :
            '/Users/someuser/github/noobaa-core/src/util/test_debug_module.js';

        var dbg = new DebugModule(filename);
        assert.strictEqual(dbg._name, 'core.util.test_debug_module');
    });

    mocha.it('should parse heroku path names', function() {
        var dbg = new DebugModule('/app/src/blabla');
        assert.strictEqual(dbg._name, 'core.blabla');
    });

    mocha.it('should parse file names with extension', function() {
        var dbg = new DebugModule('/app/src/blabla.asd');
        assert.strictEqual(dbg._name, 'core.blabla');
    });

    mocha.it('should parse file names with folder with extention', function() {
        var dbg = new DebugModule('/app/src/blabla.asd/lll.asd');
        assert.strictEqual(dbg._name, 'core.blabla.asd.lll');
    });

    mocha.it('should parse file names with stems', function() {
        var dbg = new DebugModule('/noobaa-core/src/blabla.asd/lll.asd');
        assert.strictEqual(dbg._name, 'core.blabla.asd.lll');
    });

    mocha.it('should parse file names with stems and prefix', function() {
        var dbg = new DebugModule('/web/noise/noobaa-core/src/blabla.asd/lll.asd');
        assert.strictEqual(dbg._name, 'core.blabla.asd.lll');
    });

    mocha.it('should parse windows style paths', function() {
        var dbg = new DebugModule('C:\\Program Files\\NooBaa\\src\\agent\\agent_cli.js');
        assert.strictEqual(dbg._name, 'core.agent.agent_cli');
    });

    mocha.it('should set level for windows style module and propogate', function() {
        var dbg = new DebugModule('C:\\Program Files\\NooBaa\\src\\agent\\agent_cli.js');
        dbg.set_module_level(3, 'C:\\Program Files\\NooBaa\\src\\agent');
        assert.strictEqual(dbg._cur_level.__level, 3);
    });

    mocha.it('should log when level is appropriate', function() {
        var rotation_command = '';
        //no special handling on Darwin for now. ls as place holder
        if (os_utils.IS_MAC) {
            rotation_command = 'ls';
        } else {
            rotation_command = '/usr/sbin/logrotate /etc/logrotate.d/noobaa';
        }
        return os_utils.exec(rotation_command).then(function() {
            var dbg = new DebugModule('/web/noise/noobaa-core/src/blabla.asd/lll.asd');
            dbg.log0("test_debug_module: log0 should appear in the log");
            return file_content_verify("text", "test_debug_module: log0 should appear in the log");
        });
    });

    mocha.it('should NOT log when level is lower', function() {
        var dbg = new DebugModule('/web/noise/noobaa-core/src/blabla.asd/lll.asd');
        dbg.log2("test_debug_module: log2 should not appear in the log");
        return file_content_verify("no_text", "test_debug_module: log2 should not appear in the log");
    });

    mocha.it('should log after changing level of module', function() {
        var dbg = new DebugModule('/web/noise/noobaa-core/src/blabla.asd/lll.asd');
        dbg.set_module_level(4);
        var a = {
            out: "out",
            second: {
                inner: "inner"
            }
        };
        dbg.log4("test_debug_module: log4 should appear after level change", a);
        dbg.set_module_level(0);
        return file_content_verify("text", "core.blabla.asd.lll:: test_debug_module: log4 should appear after level change");
    });

    mocha.it('should log backtrace if asked to', function() {
        var dbg = new DebugModule('/web/noise/noobaa-core/src/blabla.asd/lll.asd');
        dbg.log0_withbt("test_debug_module: log0 should appear with backtrace");
        return file_content_verify("text", "core.blabla.asd.lll:: test_debug_module: log0 should appear with backtrace     at");
    });

    mocha.it('setting a higher module should affect sub module', function() {
        var dbg = new DebugModule('/web/noise/noobaa-core/src/blabla.asd/lll.asd');
        dbg.set_module_level(2, 'core');
        dbg.log2("test_debug_module: log2 setting a higher level module level should affect current");
        dbg.set_module_level(0, 'core');
        return file_content_verify("text", "core.blabla.asd.lll:: test_debug_module: log2 setting a higher level module level should affect current");
    });

    mocha.it('formatted string should be logged correctly (string substitutions)', function() {
        var dbg = new DebugModule('/web/noise/noobaa-core/src/blabla.asd/lll.asd');
        var s1 = 'this';
        var s2 = 'should';
        var s3 = 'expected';
        var d1 = 3;
        var d2 = 2;
        dbg.log0("%s string substitutions (%d) %s be logged as %s, with two (%d) numbers", s1, d1, s2, s3, d2);
        return file_content_verify("text", " this string substitutions (3) should be logged as expected, with two (2) numbers");
    });

    mocha.it('console various logs should be logged as well', function() {
        var syslog_levels = ["trace", "log", "info", "error"];
        return _.reduce(syslog_levels, function(promise, l) {
            return promise.then(function() {
                var dbg = new DebugModule('/web/noise/noobaa-core/src/blabla.asd/lll.asd');
                _.noop(dbg); // lint unused bypass
                console[l]("console - %s - should be captured", l);
                return file_content_verify("text", "CONSOLE:: console - " + l + " - should be captured");
            });
        }, P.resolve());
    });

    mocha.it('fake browser verify logging and console wrapping', function() {
        var dbg = new DebugModule('/web/noise/noobaa-core/src/blabla.asd/lll.asd');
        dbg.log0("test_debug_module: browser should appear in the log");
        return file_content_verify("text", "core.blabla.asd.lll:: test_debug_module: browser should appear in the log");
    });
});
