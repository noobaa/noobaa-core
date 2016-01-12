import registerBindings from 'bindings/register';
import registerComponents from 'components/register';


// Enable dependecy injeciton into components constructor.
class DIEnabledComponentLoader {
	constructor(defaultLoader, injector) {
		this._injector = injector;
		this._defaultLoader = defaultLoader;
	}

	getConfig(name, cb) {
		this._defaultLoader.getConfig(name, (conf) => {
			conf.synchronous = true;
			cb(conf)
		});
	}

	loadViewModel(name, viewModelCtor, cb) {
		cb((params, componentInfo) => {
			let overrides = new Map();
			overrides.set('params', params);
			overrides.set('element', componentInfo.element);
			overrides.set('templateNodes', componentInfo.templateNodes);

			let deps = (viewModelCtor.inject || []).map(
				name => this._injector.get(name, overrides)
			);

			return new viewModelCtor(...deps);
		});
	}	
}	

// Apply extensions to knockout.
export default function(ko, injector) {
	// Register a cutom loader that support di.
	ko.components.loaders.unshift(
		new DIEnabledComponentLoader(ko.components.defaultLoader, injector)
	);

	registerBindings(ko)
	registerComponents(ko);
}