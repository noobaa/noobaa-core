import ko from 'knockout';
import koValidation from 'knockout-validation';
import registerExtensions  from 'extensions';
import registerBindings from 'bindings/register';
import registerComponents from 'components/register';
import router from 'services/router';
import routing from 'routing';
import api from 'services/api';

registerExtensions();

// Setup validation policy.
ko.validation.init({
	insertMessages: false,
	decorateInputElement: true,
	errorElementClass: 'invalid',
	errorsAsTitle: false,
	messagesOnModified: false
});

// Register custom bindings and components.
registerBindings(ko);
registerComponents(ko);

// Configure the appliction router.
routing(router);

api.init().then(() => {
	// Bind the UI with knockout.
	ko.applyBindings(router)

	// Start the router.
	router.start();	
})
