/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const P = require('../../../util/promise');
const mocha = require('mocha');
const assert = require('assert');
const fs = require('fs');
const DebugModule = require('../../../util/debug_module');
const os_utils = require('../../../util/os_utils');
const config = require('../../../../config');

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
        const filename = __filename.indexOf('noobaa-util') >= 0 ?
            __filename :
            '/Users/someuser/github/noobaa-core/src/util/test_debug_module.js';

        const dbg = new DebugModule(filename);
        assert.strictEqual(dbg._name, 'core.util.test_debug_module');
    });

    mocha.it('should parse heroku path names', function() {
        const dbg = new DebugModule('/app/src/blabla');
        assert.strictEqual(dbg._name, 'core.blabla');
    });

    mocha.it('should parse file names with extension', function() {
        const dbg = new DebugModule('/app/src/blabla.asd');
        assert.strictEqual(dbg._name, 'core.blabla');
    });

    mocha.it('should parse file names with folder with extention', function() {
        const dbg = new DebugModule('/app/src/blabla.asd/lll.asd');
        assert.strictEqual(dbg._name, 'core.blabla.asd.lll');
    });

    mocha.it('should parse file names with stems', function() {
        const dbg = new DebugModule('/noobaa-core/src/blabla.asd/lll.asd');
        assert.strictEqual(dbg._name, 'core.blabla.asd.lll');
    });

    mocha.it('should parse file names with stems and prefix', function() {
        const dbg = new DebugModule('/web/noise/noobaa-core/src/blabla.asd/lll.asd');
        assert.strictEqual(dbg._name, 'core.blabla.asd.lll');
    });

    mocha.it('should parse windows style paths', function() {
        const dbg = new DebugModule('C:\\Program Files\\NooBaa\\src\\agent\\agent_cli.js');
        assert.strictEqual(dbg._name, 'core.agent.agent_cli');
    });

    mocha.it('should set level for windows style module and propogate', function() {
        const dbg = new DebugModule('C:\\Program Files\\NooBaa\\src\\agent\\agent_cli.js');
        dbg.set_module_level(3, 'C:\\Program Files\\NooBaa\\src\\agent');
        assert.strictEqual(dbg._cur_level.__level, 3);
    });

    mocha.it('should log when level is appropriate', function() {
        let rotation_command = '';
        //no special handling on Darwin for now. ls as place holder
        if (os_utils.IS_MAC) {
            rotation_command = 'ls';
        } else {
            rotation_command = '/usr/sbin/logrotate /etc/logrotate.d';
        }
        return os_utils.exec(rotation_command).then(function() {
            const dbg = new DebugModule('/web/noise/noobaa-core/src/blabla.asd/lll.asd');
            dbg.log0("test_debug_module: log0 should appear in the log");
            return file_content_verify("text", "test_debug_module: log0 should appear in the log");
        });
    });

    mocha.it('should NOT log when level is lower', function() {
        const dbg = new DebugModule('/web/noise/noobaa-core/src/blabla.asd/lll.asd');
        dbg.log2("test_debug_module: log2 should not appear in the log");
        return file_content_verify("no_text", "test_debug_module: log2 should not appear in the log");
    });

    // NOOBAA_LOG_LEVEL=warn maps to level -1, and the name promises warnings. A quiet level
    // turns off the numbered debug logs but must not swallow WARN/ERROR.
    mocha.it('should still log warn and error at a quiet negative level', function() {
        const dbg = new DebugModule('/web/noise/noobaa-core/src/blabla.asd/lll.asd');
        const captured = [];
        const orig_write = process.stderr.write;
        dbg.set_module_level(-1);
        try {
            process.stderr.write = function(chunk) {
                captured.push(String(chunk));
                return true;
            };
            dbg.error("test_debug_module: error at quiet level MUST appear");
            dbg.warn("test_debug_module: warn at quiet level MUST appear");
            dbg.info("test_debug_module: info at quiet level must NOT appear");
            dbg.log0("test_debug_module: log0 at quiet level must NOT appear");
        } finally {
            process.stderr.write = orig_write;
            dbg.set_module_level(0);
        }
        const out = captured.join('');
        assert(out.includes("error at quiet level MUST appear"), `error was suppressed: ${out}`);
        assert(out.includes("warn at quiet level MUST appear"), `warn was suppressed: ${out}`);
        assert(!out.includes("info at quiet level must NOT appear"), `info should be quiet: ${out}`);
        assert(!out.includes("log0 at quiet level must NOT appear"), `log0 should be quiet: ${out}`);
    });

    // -5 is the established "say nothing at all" level (agent.js, sanity_build_test.js).
    mocha.it('should log nothing at all at the silent level', function() {
        const dbg = new DebugModule('/web/noise/noobaa-core/src/blabla.asd/lll.asd');
        const captured = [];
        const orig_write = process.stderr.write;
        dbg.set_module_level(-5);
        try {
            process.stderr.write = function(chunk) {
                captured.push(String(chunk));
                return true;
            };
            dbg.error("test_debug_module: error at silent level must NOT appear");
            dbg.warn("test_debug_module: warn at silent level must NOT appear");
        } finally {
            process.stderr.write = orig_write;
            dbg.set_module_level(0);
        }
        assert.deepStrictEqual(captured, []);
    });

    // DEBUG_MODE is a "turn the volume up" switch, so a negative config.dbg_log_level must not
    // be applied to new loggers. It used to be, which permanently silenced the CONSOLE logger
    // that backs the console wrapper - nothing ever restores that one, unlike the core.* subtree -
    // and so discarded every console.* call in the process for its entire lifetime.
    mocha.it('should NOT apply a negative dbg_log_level to new modules', function() {
        const orig_debug_mode = process.env.DEBUG_MODE;
        const orig_dbg_log_level = config.dbg_log_level;
        const captured = [];
        const orig_write = process.stderr.write;
        try {
            process.env.DEBUG_MODE = 'true';
            config.dbg_log_level = -1;
            // same shape as the CONSOLE logger: a top level module, outside the core.* subtree
            const dbg = new DebugModule('NEGATIVE_LEVEL_PROBE.js');
            assert.strictEqual(dbg.get_module_level('NEGATIVE_LEVEL_PROBE'), 0,
                'a negative dbg_log_level must not be applied to a newly created logger');

            process.stderr.write = function(chunk) {
                captured.push(String(chunk));
                return true;
            };
            dbg.error("test_debug_module: error MUST survive a negative dbg_log_level");
        } finally {
            process.stderr.write = orig_write;
            config.dbg_log_level = orig_dbg_log_level;
            if (orig_debug_mode === undefined) {
                delete process.env.DEBUG_MODE;
            } else {
                process.env.DEBUG_MODE = orig_debug_mode;
            }
        }
        const out = captured.join('');
        assert(out.includes("test_debug_module: error MUST survive a negative dbg_log_level"),
            `logger was silenced by a negative dbg_log_level, got: ${out}`);
    });

    mocha.it('should log after changing level of module', function() {
        const dbg = new DebugModule('/web/noise/noobaa-core/src/blabla.asd/lll.asd');
        dbg.set_module_level(4);
        const a = {
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
        const dbg = new DebugModule('/web/noise/noobaa-core/src/blabla.asd/lll.asd');
        dbg.log0_withbt("test_debug_module: log0 should appear with backtrace");
        return file_content_verify("text", "core.blabla.asd.lll:: test_debug_module: log0 should appear with backtrace     at");
    });

    mocha.it('setting a higher module should affect sub module', function() {
        const dbg = new DebugModule('/web/noise/noobaa-core/src/blabla.asd/lll.asd');
        dbg.set_module_level(2, 'core');
        dbg.log2("test_debug_module: log2 setting a higher level module level should affect current");
        dbg.set_module_level(0, 'core');
        return file_content_verify("text", "core.blabla.asd.lll:: test_debug_module: log2 setting a higher level module level should affect current");
    });

    mocha.it('formatted string should be logged correctly (string substitutions)', function() {
        const dbg = new DebugModule('/web/noise/noobaa-core/src/blabla.asd/lll.asd');
        const s1 = 'this';
        const s2 = 'should';
        const s3 = 'expected';
        const d1 = 3;
        const d2 = 2;
        dbg.log0("%s string substitutions (%d) %s be logged as %s, with two (%d) numbers", s1, d1, s2, s3, d2);
        return file_content_verify("text", " this string substitutions (3) should be logged as expected, with two (2) numbers");
    });

    mocha.it('console various logs should be logged as well', function() {
        const syslog_levels = ["trace", "log", "info", "error"];
        return _.reduce(syslog_levels, function(promise, l) {
            return promise.then(function() {
                const dbg = new DebugModule('/web/noise/noobaa-core/src/blabla.asd/lll.asd');
                _.noop(dbg); // lint unused bypass
                console[l]("console - %s - should be captured", l);
                return file_content_verify("text", "CONSOLE:: console - " + l + " - should be captured");
            });
        }, P.resolve());
    });

    mocha.it('fake browser verify logging and console wrapping', function() {
        const dbg = new DebugModule('/web/noise/noobaa-core/src/blabla.asd/lll.asd');
        dbg.log0("test_debug_module: browser should appear in the log");
        return file_content_verify("text", "core.blabla.asd.lll:: test_debug_module: browser should appear in the log");
    });
});
