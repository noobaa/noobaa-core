'use strict';

var crypto = require('crypto');
var transformer = require('./transformer');

var MD5Stream = transformer.ctor({
    init: t => t.digester = crypto.createHash('md5'),
    transform: (t, data, encoding) => {
        // console.log('MD5Stream', data.length);
        t.digester.update(data);
        return data;
    }
});

MD5Stream.prototype.toString = function() {
    return this.digester.digest('hex');
};

module.exports = MD5Stream;
