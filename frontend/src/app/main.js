import ko from 'knockout';
import 'knockout-projections';
import 'knockout-validation';
import registerBindings from 'bindings/register';
import registerComponents from 'components/register';
import router from 'services/router';
import routing from 'routing';
import api from 'services/api'

const credentials = {
	system: 'demo',
	email:  'demo@noobaa.com',
	password: 'DeMo'	
};

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

// Create a token and start the applicaiton.
api.create_auth_token(credentials)
	.then(() => {
		// Bind the UI with knockout.
		ko.applyBindings()

		// Start the router.
		router.start();	
	});
