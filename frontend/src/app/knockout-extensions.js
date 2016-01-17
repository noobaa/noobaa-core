import ko from 'knockout';

ko.observableWithDefault = function(valueAccessor) {
	let storage = ko.observable();
 	return ko.pureComputed({
		read: () => typeof storage() !== 'undefined' ? storage() : ko.unwrap(valueAccessor()),
		write: storage
	});
}