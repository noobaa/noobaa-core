import ko from 'knockout';

ko.computedArray = function computedArray(valueAccessor) {
	if (typeof valueAccessor !== 'function') {
		throw new TypeError('Invalid valueAccessor, not invokable');
	}

	let arr = ko.observableArray();
	let computed = ko.pureComputed(valueAccessor);
	let subscription = computed.subscribe(items => arr(items))

	arr.dispose = function() { subscription.dispose(); }
	return arr;
}
