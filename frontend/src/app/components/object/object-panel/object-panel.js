/* Copyright (C) 2016 NooBaa */

import template from './object-panel.html';
import BaseViewModel from 'components/base-view-model';
import ko from 'knockout';
import { routeContext, objectInfo, objectPartList } from 'model';

class ObjectPanelViewModel extends BaseViewModel {
    constructor() {
        super();

        this.obj = objectInfo;
        this.parts  = objectPartList;

        this.ready = ko.pureComputed(
            () => !!this.obj()
        );

        this.selectedTab = ko.pureComputed(
            () => routeContext().params.tab || 'parts'
        );
    }

    isTabSelected(name) {
        return this.selectedTab() === name;
    }
}

export default {
    viewModel: ObjectPanelViewModel,
    template: template
};
