import { DIContainer, lifetime }  from 'di4js';

export default function createInjector() {
	return new DIContainer()
		.registerInstance('appState', { heading: 'overview', panel: 'overview-panel'})
		.reigsterFactory('router', createRouter,  lifetime.singleton) 
		.createInjector();
}