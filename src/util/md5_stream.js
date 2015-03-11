'use strict';
var crypto = require('crypto');
var stream = require('stream');
var util = require('util');

// node v0.10+ use native Transform, else polyfill
var Transform = stream.Transform ||
  require('readable-stream').Transform;


module.exports = md5_stream;

function md5_stream(options) {
  // allow use without new
  if (!(this instanceof md5_stream)) {
    return new md5_stream(options);
  }

  // init Transform
  Transform.call(this, options);

  this.digester = crypto.createHash('md5');
}
util.inherits(md5_stream, Transform);

/* during each chunk, update the digest */
md5_stream.prototype._transform = function (chunk, enc, cb) {
  // if is Buffer use it, otherwise coerce
//  console.log('aaa:',chunk);
  var buffer = (Buffer.isBuffer(chunk)) ? chunk : new Buffer(chunk, enc);
  this.digester.update(buffer); // update hash
  this.push(chunk);
  //console.log('aaa:',this.digester);

  // we are not writing anything out at this
  // time, only at end during _flush
  // so we don't need to call push
  cb();
};

/* at the end, output the hex digest */
md5_stream.prototype._flush = function (cb) {
//    console.log('dddddd 1111',this.digester.digest('hex'));
//  this.push(this.digester.digest('hex'));
//  console.log('dddddd',this.digester.digest('hex'));
  cb();
};

md5_stream.prototype.toString = function() {
    //console.log('aaaa',this,this.digester,this.digester.digest('hex'));
  return this.digester.digest('hex');
};
