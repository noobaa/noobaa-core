import ko from 'knockout';

export default {
    init: function(element, valueAccessor, allBindings, viewModel, bindingContext) {
    	ko.utils.registerEventHandler(element, 'scroll', () => {
			let { scrollTop, scrollHeight, offsetHeight } = element;

			if (scrollTop >= scrollHeight - offsetHeight) {
				let location = scrollTop / (scrollHeight - offsetHeight);
				console.log(location * 100 + '%');	
			}	
    	});
	}
}
