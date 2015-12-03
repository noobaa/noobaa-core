import ko from 'knockout';
import 'knockout-projections';
import 'knockout-validation';
import registerBindings from 'bindings/register';
import registerComponents from 'components/register';
import page from 'page';
import routing from 'routing';
import { uiState } from 'model';
import { start } from 'actions';

// Setup validation policy.
ko.validation.init({
	//insertMessages: false,
	errorMessageClass: 'val-msg',
	decorateInputElement: true,
	errorElementClass: 'invalid',
	errorsAsTitle: false,
	messagesOnModified: true
});

// Register custom bindings and components.
registerBindings(ko);
registerComponents(ko);

// Configure the appliction router.
routing(page);

// Bind the ui to the 
ko.applyBindings({ 
	layout: ko.pureComputed( () => uiState().layout ) 
});

// start the application.
start();
