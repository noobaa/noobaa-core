import ko from 'knockout';

export default {
    update: function(element, valueAccessor, allBindings, viewModel, bindingContext) {
        
        return ko.bindingHandlers.css.update(
            element, 
            () => ({ 
                expandable: true, 
                expanded: valueAccessor() 
            }),
            allBindings, 
            viewModel, 
            bindingContext
        );  
    }
}