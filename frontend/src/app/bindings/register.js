export default function register(ko) {
	// Extending existing handlers
	ko.bindingHandlers.template		= require('./template-ex');

	// Registering new handlers 
	ko.bindingHandlers.let 			= require('./let');
	ko.bindingHandlers.visibility 	= require('./visibility');
	ko.bindingHandlers.href 		= require('./href');
	ko.bindingHandlers.scroll 		= require('./scroll');
	ko.bindingHandlers.canvas 		= require('./canvas');	
	ko.bindingHandlers.animation	= require('./animation');
}