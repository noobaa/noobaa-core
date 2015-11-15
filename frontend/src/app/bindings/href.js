import ko from 'knockout';

export default {
    update: function(element, valueAccessor, allBindings, viewModel, bindingContext) {
    
        return ko.bindingHandlers.attr.update(
        	element, 
        	() => ({ href: valueAccessor() }),
        	allBindings, 
        	viewModel, 
        	bindingContext
    	);
    }
}
