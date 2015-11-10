import ko from 'knockout';
import rx from 'rxjs';

function rxToKo(defaultValue) {
	let value = ko.observable(defaultValue);
	let computed = ko.pureComputed(value)
	let sub = null;

	// Manage rx subscription lifetime;
	computed.subscribe(() => sub = this.subscribe(value), null, 'awake');
	computed.subscribe(() => sub.dispose(), null, 'asleep');

	return computed;	
}

function rxlog(prefix) {
	return this.tap(value => {
		if (prefix) {
			console.log(prefix, value)
		} else {
			console.log(value);
		}
	});
}

export default function register() {
	Object.assign(rx.Observable.prototype, {
		toKO: rxToKo,
		log: rxlog,
	});
}
