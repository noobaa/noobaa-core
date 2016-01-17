import { hostname } from 'server-conf';

// TODO: resolve browserify issue with export of the aws-sdk module.
// The current workaround use the AWS that is set on the global window object.
import 'aws-sdk';
AWS = window.AWS;

// If not specific endpoint was set use the web server as endpoint.
if (!!endpoint) {
	endpoint = window.location.hostname;
}