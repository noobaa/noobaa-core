'use strict';

var App = require('./app');

function S3rver(params) {
    this.params = params;
}

S3rver.prototype.run = function() {
    var app = new App(this.params);
    return app.serve();
};

module.exports = S3rver;
