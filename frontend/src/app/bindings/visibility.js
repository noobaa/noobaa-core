import ko from 'knockout';

export default {
    init: function(element, valueAccessor, allBindings, viewModel, bindingContext) {
    	let value = valueAccessor();
    	let visibility = ko.pureComputed(() => !ko.unwrap(value) ? 'hidden' : 'visible');
    	
    	ko.applyBindingsToNode(element, { style: { visibility } });
    }
}
