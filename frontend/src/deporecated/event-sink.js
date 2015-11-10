import { invokeAsync }  from 'utils';

export default class EventSink {
	constructor(eventName) {
		this._name = name;
		this._mapping = new Map();

		Object.freeze(this);
	}

	subscribe(owner, handler) {
		let handlers = this._mapping.get(owner);
		handlers != null ?
			handlers.push(handler) :
			this._mapping.set(owner, [ handler ]);
	}

	unsubscribe(owner) {
		this._mapping.delete(owner);
	}

	emit(payload) {
		let { _name, _mapping } = this;	

		invokeAsync(() => {
			_mapping.forEach((handlers, owner) =>  {
				handlers.forEach(handler => handler.call(owner, payload, _name));
			});
		});
	}
}