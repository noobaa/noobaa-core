'use strict';
var _ = require('lodash');
var P = require('./util/promise');
var AWS = require('aws-sdk');
var dbg = require('./util/debug_module')(__filename);


var mys3 = new AWS.S3({
    accessKeyId: "AKIAJOP7ZFXOOPGL5BOA",
    secretAccessKey: "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",
    //s3ForcePathStyle: true,
	maxRedirects: 10
});

var params = {
    Bucket: "ca-tester",
};

return P.ninvoke(mys3, 'getBucketLocation', params)
    .then(function(location) {
        dbg.log0('location', location);
        //mys3.setRegion(location.LocationConstraint);
        mys3.config.update({
            region: location.LocationConstraint
        });
        return P.ninvoke(mys3, 'listObjects', params)
            .fail(function(error) {
                dbg.error('update_c2n_worklist failed to list files from cloud: sys', error, error.stack);
                throw new Error('update_c2n_worklist failed to list files from cloud');
            }).
			then(function(cloud_obj) {
	            var cloud_object_list = _.map(cloud_obj.Contents, function(obj) {
	                return {
	                    create_time: obj.LastModified,
	                    key: obj.Key
	                };
	            });
				dbg.log0('list', cloud_object_list);
			})
    });
