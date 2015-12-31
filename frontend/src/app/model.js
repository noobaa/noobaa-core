import ko from 'knockout';

// Hold the current ui state.
export let uiState = ko.observable({
	layout: 'empty'
});

// Hold the current route context.
export let routeContext = ko.observable();

// Hold current session information.
export let sessionInfo = ko.observable();

// Hold the state of the server.
export let serverInfo = ko.observable();

// Hold a overview information of a system.
export let systemOverview = ko.observable();

// Hold agent installation information.
export let agentInstallationInfo = ko.observable();

// Hold the current bucket list. derived from system info.
export let bucketList = ko.observableArray(); 
bucketList.sortedBy = ko.observable('name')
bucketList.order = ko.observable(1);

// Hold the current bucket info.
export let bucketInfo = ko.observable();

// Hold the current bucket object list.
export let bucketObjectList = ko.observableArray();
bucketObjectList.count = ko.observable(0);
bucketObjectList.sortedBy = ko.observable('name');
bucketObjectList.order = ko.observable(1);
bucketObjectList.filter = ko.observable();
bucketObjectList.page = ko.observable(0);

// Hold the current bucket policy.
export let bucketPolicy = ko.observable();

// Hold the current pool list. derived from system info.
export let poolList = ko.observableArray();
poolList.sortedBy = ko.observable('name');
poolList.order = ko.observable(1);

// Hold the current pool info.
export let poolInfo = ko.observable();

// Hold a list of all the nodes in the system.
export let nodeList = ko.observableArray();


// Hold the current pool node list.
export let poolNodeList = ko.observableArray();
poolNodeList.filter = ko.observable();

// Hold the current node info.
export let nodeInfo = ko.observable();

// Hold the objects that are stored on the curr node.
export let nodeObjectList = ko.observableArray();

// Hold the current node info.
export let objectInfo = ko.observable();

// Hold the parts of the curr object.
export let objectPartList = ko.observableArray();
objectPartList.filter = ko.observable();

// Hold the recent uploads.
export let recentUploads = ko.observableArray();