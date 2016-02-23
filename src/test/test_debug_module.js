'use strict';

var _ = require('lodash');
var P = require('../util/promise');
var mocha = require('mocha');
var assert = require('assert');
var fs = require('fs');
var DebugModule = require('../util/debug_module');

var processType;

// File Content Verifier according to given expected result (positive/negative)
function file_content_verify(flag, expected) {
    return P.delay(1).then(function() {
            var content = fs.readFileSync("logs/noobaa.log", "utf8");

            if (flag === "text") { // Verify Log requests content
                assert(content.indexOf(expected) !== -1);
            } else if (flag === "no_text") { // Verify Log request DOES NOT appear
                assert(content.indexOf(expected) === -1);
            }
        });
}


mocha.describe('debug_module', function() {

    // This test case fails becauuse __filename is full path !
    // shouldn't the module trim the base path ??
    mocha.it('should parse __filename', function() {
        //CI integration workaround
        var filename = __filename.indexOf('noobaa-util') !== -1 ?
                      __filename :
                      '/Users/someuser/github/noobaa-util/test_debug_module.js';

        var dbg = new DebugModule(filename);
        assert.strictEqual(dbg._name, 'util.test_debug_module');
    });

    mocha.it('should parse heroku path names', function() {
        var dbg = new DebugModule('/app/src/blabla');
        assert.strictEqual(dbg._name, 'app.src.blabla');
    });

    mocha.it('should parse file names with extension', function() {
        var dbg = new DebugModule('/app/src/blabla.asd');
        assert.strictEqual(dbg._name, 'app.src.blabla');
    });

    mocha.it('should parse file names with folder with extention', function() {
        var dbg = new DebugModule('/app/src/blabla.asd/lll.asd');
        assert.strictEqual(dbg._name, 'app.src.blabla.asd.lll');
    });

    mocha.it('should parse file names with stems', function() {
        var dbg = new DebugModule('/noobaa-util/blabla.asd/lll.asd');
        assert.strictEqual(dbg._name, 'util.blabla.asd.lll');
    });

    mocha.it('should parse file names with stems and prefix', function() {
        var dbg = new DebugModule('/web/noise/noobaa-core/src/blabla.asd/lll.asd');
        assert.strictEqual(dbg._name, 'core.blabla.asd.lll');
    });

    mocha.it('should parse windows style paths', function() {
        var dbg = new DebugModule('C:\\Program Files\\NooBaa\\src\\agent\\agent_cli.js');
        assert.strictEqual(dbg._name, 'core.src.agent.agent_cli');
    });

    mocha.it('should set level for windows style module and propogate', function() {
      var dbg = new DebugModule('C:\\Program Files\\NooBaa\\src\\agent\\agent_cli.js');
      dbg.set_level(3, 'C:\\Program Files\\NooBaa\\src\\agent');
      assert.strictEqual(dbg._cur_level.__level,3);
    });

    mocha.it('should log when level is appropriate', function() {
        var dbg = new DebugModule('/web/noise/noobaa-core/src/blabla.asd/lll.asd');
        dbg.log0("test_debug_module: log0 should appear in the log");
        return file_content_verify("text", "core.blabla.asd.lll:: test_debug_module: log0 should appear in the log");
    });

    mocha.it('should NOT log when level is lower', function() {
        var dbg = new DebugModule('/web/noise/noobaa-core/src/blabla.asd/lll.asd');
        dbg.log2("test_debug_module: log2 should not appear in the log");
        return file_content_verify("no_text", "test_debug_module: log2 should not appear in the log");
    });

    mocha.it('should log after changing level of module', function() {
        var dbg = new DebugModule('/web/noise/noobaa-core/src/blabla.asd/lll.asd');
        dbg.set_level(4);
        var a = {
            out: "out",
            second: {
                inner: "inner"
            }
        };
        dbg.log4("test_debug_module: log4 should appear after level change", a);
        return file_content_verify("text", "core.blabla.asd.lll:: test_debug_module: log4 should appear after level change");
    });

    mocha.it('should log backtrace if asked to', function() {
        var dbg = new DebugModule('/web/noise/noobaa-core/src/blabla.asd/lll.asd');
        dbg.log0_withbt("test_debug_module: log0 should appear with backtrace");
        return file_content_verify("text", "core.blabla.asd.lll:: test_debug_module: log0 should appear with backtrace     at");
    });

    mocha.it('setting a higher module should affect sub module', function() {
        var dbg = new DebugModule('/web/noise/noobaa-core/src/blabla.asd/lll.asd');
        dbg.set_level(2, 'util');
        dbg.log2("test_debug_module: log2 setting a higher level module level should affect current");
        return file_content_verify("text", "core.blabla.asd.lll:: test_debug_module: log2 setting a higher level module level should affect current");
    });

    mocha.it('formatted string should be logged correctly (string substitutions)', function() {
        var dbg = new DebugModule('/web/noise/noobaa-core/src/blabla.asd/lll.asd');
        var s1 = 'this',
            s2 = 'should',
            s3 = 'expected';
        dbg.log0("%s string %s be logged as %s", s1, s2, s3);
        return file_content_verify("text", "core.blabla.asd.lll:: this string should be logged as expected");
    });

    mocha.it('console various logs should be logged as well', function() {
        var syslog_levels = ["trace", "log", "info", "error"];
        return _.reduce(syslog_levels, function(promise, l) {
                return promise.then(function() {
                    var dbg = new DebugModule('/web/noise/noobaa-core/src/blabla.asd/lll.asd');
                    dbg = dbg; // lint unused bypass
                    console[l]("console - %s - should be captured", l);
                    return file_content_verify("text", "CONSOLE:: console - " + l + " - should be captured");
                });
            }, P.resolve());
    });

    mocha.it('fake browser verify logging and console wrapping', function() {
        var dbg = new DebugModule('/web/noise/noobaa-core/src/blabla.asd/lll.asd');
        // jshint proto:true
        dbg.__proto__.set_t = function() {
            processType = 'browser'; //global at the debug_module level, ignore
        };
        dbg.log0("test_debug_module: browser should appear in the log");
        return file_content_verify("text", "core.blabla.asd.lll:: test_debug_module: browser should appear in the log");
    });
});
