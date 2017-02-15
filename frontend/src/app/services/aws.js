// TODO: resolve browserify issue with export of the aws-sdk module.
// The current workaround use the AWS that is set on the global window object.
import 'aws-sdk';
export default window.AWS;
