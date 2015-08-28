'use strict';

var util = require('util');

module.exports = make_logger;

var MONGOOSE_INSPECT_OPT = {
    depth: 5
};

function make_logger(logger) {
    return function(collectionName, method, query, doc, options) {
        logger('\x1B[0;36mMongoose:\x1B[0m %s.%s(%s) %s %s %s',
        collectionName,
        method,
        util.inspect(query, MONGOOSE_INSPECT_OPT),
        doc ? util.inspect(doc, MONGOOSE_INSPECT_OPT) : '',
        options ? util.inspect(options, MONGOOSE_INSPECT_OPT) : '');
    };
}
