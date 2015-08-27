'use strict';

// this module requires the dot template engine and replaces
// the dot regexp to use {{{ }}} to avoid collision with angular {{ }}
//
// important - dot settings should run before any require() that
// might use dot directly or else the it will get mess up (like the email.js code)

var dot = require('dot');
var _ = require('lodash');

dot.templateSettings.strip = false;
dot.templateSettings.cache = true;

_.each(dot.templateSettings, function(val, key) {
    if (!(val instanceof RegExp)) {
        // console.log('DOT fyi found non regexp property', key, val);
        return;
    }
    // console.log('DOT fyi replacing delimiters in regexp', key, val);
    var pattern = val.source;
    pattern = pattern.replace(/\\\{\\\{/g, '\\{\\{\\{');
    pattern = pattern.replace(/\\\}\\\}/g, '\\}\\}\\}');
    var flags = '';
    if (val.global) {
        flags += 'g';
    }
    /* istanbul ignore if */
    if (val.ignoreCase) {
        flags += 'i';
    }
    /* istanbul ignore if */
    if (val.multiline) {
        flags += 'm';
    }
    dot.templateSettings[key] = new RegExp(pattern, flags);
});

module.exports = dot;
