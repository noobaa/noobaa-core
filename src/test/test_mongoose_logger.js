var dbg = require('../util/debug_module')(__filename);
var mongoose_logger = require('../util/mongoose_logger');
var logger = mongoose_logger(dbg.log0.bind(dbg));
logger('collectionName', 'method', 'query', 'doc', 'options');
logger('collectionName', 'method', 'query', 'doc');
logger('collectionName', 'method', 'query');
