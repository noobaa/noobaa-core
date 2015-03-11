'use strict';
var App = require('./app');
var S3rver = function(params) {
    this.params = params;
    //console.log('ppp0:',this.params);
};


S3rver.prototype.run = function(done) {
    //console.log('ppp1:',this.params);
    var app = new App(this.params);
    return app.serve(done);
};

module.exports = S3rver;
