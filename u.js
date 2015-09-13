var url = require('url');
var url_utils = require('./src/util/url_utils');
var x = process.argv[2];
console.log('url.parse(\"' + x + '\") =', url.parse(x, true));
console.log('quick_parse(\"' + x + '\") =', url_utils.quick_parse(x, true));
