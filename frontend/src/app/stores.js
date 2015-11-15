import ko from 'knockout';


export let appState = ko.observable();

export let systemInfo = ko.observable();

export let bucketList = ko.observableArray(); 
systemInfo.subscribe(si => bucketList(si.buckets));

export let bucketInfo = ko.observable();

export let objectList = ko.observableArray();

export let nodeList = ko.observableArray();
systemInfo.subscribe(si => nodeList(si.nodes));

export let nodeInfo = ko.observable();

export let nodePartList = ko.observableArray();

export let fileInfo = ko.observable();

export let filePartList = ko.observableArray();

