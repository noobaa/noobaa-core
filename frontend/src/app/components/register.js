// -------------------------------
// Widgets
// -------------------------------
import svgIcon from './widgets/svg-icon/svg-icon'
import dropdown from './widgets/dropdown/dropdown';
import actionList from './widgets/action-list/action-list';
import radioButton from './widgets/radio-button/radio-button';
import capacityGauge from './widgets/capacity-gauge/capacity-gauge';
import rangeIndicator from './widgets/range-indicator/range-indicator';
import poolsOverview from './widgets/pools-overview/pools-overview';
import bucketsOverview from './widgets/buckets-overview/buckets-overview';
import nodeSummary from './widgets/node-summary/node-summary';
import nodePartsTable from './widgets/node-parts-table/node-parts-table';
import nodeInfo from './widgets/node-info/node-info';

// -------------------------------
// Layout
// -------------------------------
import header from './layout/header/header';
import commandBar from './layout/commands-bar/commands-bar';
import breadcrumbs from './layout/breadcrumbs/breadcrumbs';
import panelManager from './layout/panel-manager/panel-manager';
import modal from './layout/modal/modal';

// -------------------------------
// Panels
// -------------------------------
import overviewPanel from './panels/overview-panel/overview-panel';
import aboutPanel from './panels/about-panel/about-panel';
import bucketsPanel from './panels/buckets-panel/buckets-panel';
import nodePanel from './panels/node-panel/node-panel';

// -------------------------------
// Forms
// -------------------------------
import addNodeForm from './forms/add-node-form/add-node-form';
import createBucketForm from './forms/create-bucket-form/create-bucket-form';

// Register the components with knockout component container.
export default function register(ko) {
	ko.components.register('svg-icon', svgIcon);
	ko.components.register('dropdown', dropdown);
	ko.components.register('radio-button', radioButton);
	ko.components.register('pools-overview', poolsOverview);
	ko.components.register('capacity-gauge', capacityGauge);	
	ko.components.register('range-indicator', rangeIndicator);	
	ko.components.register('action-list', actionList);
	ko.components.register('buckets-overview', bucketsOverview);
	ko.components.register('node-summary', nodeSummary);
	ko.components.register('node-parts-table', nodePartsTable);
	ko.components.register('node-info', nodeInfo);
		ko.components.register('header', header);
	ko.components.register('breadcrumbs', breadcrumbs);
	ko.components.register('commands-bar', commandBar);
	ko.components.register('panel-manager', panelManager);
	ko.components.register('modal', modal);
	
	ko.components.register('overview-panel', overviewPanel);
	ko.components.register('about-panel', aboutPanel);
	ko.components.register('buckets-panel', bucketsPanel);
	ko.components.register('node-panel', nodePanel);

	ko.components.register('add-node-form', addNodeForm);
	ko.components.register('create-bucket-form', createBucketForm);	
}