createRouter.inject = ['appState'];
export default function createRouter(appState) {
	
	crossRoads
		.map('/overview', () => {
			state.heading = 'overview';
			state.panel = 'overview-panel';
		})
		.map('/about', () => {
			state.heading = 'about';
			state.panel = 'about-panel';
		})
}