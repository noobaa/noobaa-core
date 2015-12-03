import ko from 'knockout';

export default {
    update: function(element, valueAccessor, allBindings, viewModel, bindingContext) {
    	let selected = ko.unwrap(valueAccessor());

        return ko.bindingHandlers.css.update(
        	element, 
        	() => ({ selected }),
        	allBindings, 
        	viewModel, 
        	bindingContext
    	);
    }
}
