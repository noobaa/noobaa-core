import ko from 'knockout';

ko.subscribable.fn.waitFor = function(cb) {
	let sub = this.subscribe(
		() => {
			sub.dispose();
			cb()
		}
	)
}

ko.observableWithDefault = function(valueAccessor) {
	let storage = ko.observable();
 	return ko.pureComputed({
		read: () => typeof storage() !== 'undefined' ? storage() : ko.unwrap(valueAccessor()),
		write: storage
	});
}

