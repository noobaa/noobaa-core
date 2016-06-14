'use strict';
var _ = require('lodash');
var gcloud = require('./src/deploy/gcloud');

gcloud.initialize();
return gcloud.describe_instances({filter: 'status eq TERMINATED'})
.then(function(res) {
	var current_instances = _.slice(res, 0, res.length);
	var ids = _.map(current_instances, 'name');
	console.log('ids:',ids);
	
});
