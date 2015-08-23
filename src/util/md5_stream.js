'use strict';

var crypto = require('crypto');
var transformer = require('./transformer');

var MD5Stream = transformer.ctor({
    init: function() {
        this.digester = crypto.createHash('md5');
    },
    transform: function(data, encoding) {
        console.log('MD5Stream', data.length);
        this.digester.update(data);
        return data;
    }
});

MD5Stream.prototype.toString = function() {
    return this.digester.digest('hex');
};

module.exports = MD5Stream;
