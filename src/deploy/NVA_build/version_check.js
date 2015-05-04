/* jshint node:true */
'use strict';

var request = require('request');

var args = process.argv.slice(2);
var current_ver = args[0];

request('https://noobaa-alpha.herokuapp.com/get_latest_version&curr=' + current_ver, function(error, response, body) {
    if (body.indexOf('s3') === -1) { //version up to date
        console.log("");
    } else {
      console.log(body.slice(body.indexOf('s3'), -2));
    }
});
