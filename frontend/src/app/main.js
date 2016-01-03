import ko from 'knockout';
import 'knockout-projections';
import 'knockout-validation';
import registerBindings from 'bindings/register';
import registerComponents from 'components/register';
import registerValidationRules from 'validations';
import page from 'page';
import routing from 'routing';
import { uiState } from 'model';
import { start } from 'actions';

// Enable knockout 3.4 deferred updates.
ko.options.deferUpdates = true;

// Setup validation policy.
ko.validation.init({
	//insertMessages: false,
	errorMessageClass: 'val-msg',
	decorateInputElement: true,
	errorElementClass: 'invalid',
	errorsAsTitle: false,
	messagesOnModified: true
});

// Register custom bindings, components and validation rules.
registerBindings(ko);
registerComponents(ko);
registerValidationRules(ko);

// Configure the appliction router.
routing(page);

// Bind the ui to the 
ko.applyBindings({ 
	layout: ko.pureComputed( () => uiState().layout ) 
});

// start the application.
start();
