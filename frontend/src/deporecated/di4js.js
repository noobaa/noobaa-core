export const lifetime = Object.freeze({
	singleton: 'singleton',
	request: 'request',
	instance: 'instance'
});

export class DIContainer {
	constructor() {
		this._providers = new Map();
	}

	registerInstance(name, instance) {
		if (this._providers.has(name)) {
			throw new Error(`Duplicate declearation for "${name}"`);
		}

		_providers.set(name, {
			deps: [],
			factory: () => instance,
			lifetime: lifetime.singleton
		});

		return this;
	}

	registerFactory(name, deps, factory, lt = lifetime.instance) {
		let _providers = this._providers;

		if (deps != null && !(deps instanceof Array)) {
			throw TypeError('Invlaid dependency list');
		}

		if (typeof factory !== 'function') {
			throw TypeError('Invalid factory');
		}

		if (_providers.has(name)) {
			throw new Error(`Duplicate proivder declearation for "${name}"`);
		}

		_providers.set(name, {
			deps: deps || [],
			factory: factory,
			lifetime: lt
		});

		return this;
	}

	registerInstance(name, instance) {
		return this.registerFactory(name, null, () => instance, lifetime.singleton);
	}

	registerType(name, ctor, lt) {
		if (typeof ctor !== 'function') {
			throw new TypeError('Invalid type constructor');
		}

		return this.registerFactory(name, ctor.inject, (...deps) => new ctor(...deps), lt);
	}

	createInjector() {
		return new Injector(this._providers);
	}
}

class Injector {
	constructor(providers) {
		this._providers = providers;
		let _globalCache = this._globalCache = new Map();

		_globalCache.set('injector', this)
	}

	get(name, requestCache = new Map())  {
		let { _providers, _globalCache } = this;

		let instance = _globalCache.get(name) || requestCache.get(name);
		if (instance == null) {

			let provider = _providers.get(name);
			if (provider == null) {
				return null;
			}

			// Resolve dependencies and create an instance.
			let deps = provider.deps.map(name => this.resolve(name, requestCache));
			instance = provider.factory(...deps);

			// Cache the insance if necessary.
			switch(provider.lifetime) {
				case lifetime.singleton:
					_globalCache.set(name, instance);
					break;

				case lifetime.request:
					requestCache.set(name, instance);
					break;
			}
		}

		return instance;
	}
}