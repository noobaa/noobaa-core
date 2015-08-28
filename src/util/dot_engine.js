'use strict';

var fs = require('fs');
var path = require('path');
var _ = require('lodash');
var dot = require('./dot');

// express engine using doT.
// example usage: app.engine('html', dot_engine('./views/'));
// based on the dot_emc module.

function dot_engine(views_path) {
    // return an express engine function
    var self = function(name, options, callback) {
        if (!callback) {
            // sync call (may throw)
            return self.load_template(name).func(options);
        }
        var result;
        try {
            result = self.load_template(name).func(options);
        } catch (err) {
            return callback(err);
        }
        return callback(null, result);
    };

    self.views_path = views_path || '.';
    self.disable_cache = false;
    self.templates = {};

    // override this function to get templates from elsewhere
    self.read_template = function(name) {
        var filename = path.resolve(self.views_path, name);
        return fs.readFileSync(filename);
    };

    self.load_template = function(name, more_defs) {
        try {
            var t = self.templates[name];
            if (!t) {
                t = {};
                // read from file
                t.text = self.read_template(name);
                // compile the template
                var all_defs = more_defs ?
                    _.extend({}, self.defs, more_defs) : self.defs;
                t.func = dot.template(t.text, null, all_defs);
                // cache the template info for next calls
                if (!self.disable_cache) {
                    self.templates[name] = t;
                }
            }
            return t;
        } catch (err) {
            console.error('template failed', name);
            console.error(err, err.stack);
            throw err;
        }
    };


    // defs is the object used by doT for resolving compile time names
    // such as used with {{{# def.lalala }}} so we extend it by defining
    // the include() function to load a file into the template.
    // example usage: {{{# def.include('page.html') }}}
    self.defs = {
        // include loads this template into another one,
        // so only return the text to be included and the parent
        // template will compile as a whole, and run.
        include: function(name, more_defs) {
            return self.load_template(name, more_defs).text;
        },
    };

    return self;
}

module.exports = dot_engine;
