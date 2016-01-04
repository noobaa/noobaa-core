import ko from 'knockout';
import 'knockout-projections';
import 'knockout-validation';
import registerExtenders from 'extenders/register';
import registerValidationRules from 'validations';
import registerBindings from 'bindings/register';
import registerComponents from 'components/register';
import page from 'page';
import routing from 'routing';
import { uiState } from 'model';
import { start } from 'actions';

// Enable knockout 3.4 defer<p></p>red updates.
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

// Register custom extenders, bindings, components and validation rules.
registerExtenders(ko);
registerBindings(ko);
registerValidationRules(ko);
registerComponents(ko);

// Configure the appliction router.
routing(page);

// Bind the ui to the 
ko.applyBindings({ 
	layout: ko.pureComputed( () => uiState().layout ) 
});

// start the application.
start();
