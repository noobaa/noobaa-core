/* Copyright (C) 2016 NooBaa */

import template from './placement-policy-toggle.html';
import { deepFreeze } from 'utils/core-utils';
import { randomString } from 'utils/string-utils';
import ko from 'knockout';
import {
    placementPolicyToggleMirrorTooltip,
    placementPolicyToggleSpreadTooltip
} from 'knowledge-base-articles';

const policyTypeOptions = deepFreeze([
    {
        policyType: 'SPREAD',
        label: 'Spread',
        description: 'Spreading the data across the chosen resources, does not include failure tolerance in case of resource failure',
        tooltip: {
            template: 'checkList',
            text: {
                list: [
                    {
                        text: 'Copies/fragments across the underlying resources for each of the object parts',
                        checked: true
                    },
                    {
                        text: 'Includes failure tolerance in case of resource failure',
                        checked: false
                    }
                ],
                link: {
                    text: 'Learn more about spread policy',
                    href: placementPolicyToggleSpreadTooltip
                }

            }
        }
    },
    {
        policyType: 'MIRROR',
        label: 'Mirror',
        description: 'Full duplication of the data in each chosen resource, includes failure tolerance in case of resource failure',
        tooltip: {
            template: 'checkList',
            text: {
                list: [
                    {
                        text: 'Copies/fragments across the underlying resources for each of the object parts',
                        checked: true
                    },
                    {
                        text: 'Includes failure tolerance in case of resource failure',
                        checked: true
                    }
                ],
                link: {
                    text: 'Learn more about mirror policy',
                    href: placementPolicyToggleMirrorTooltip
                }

            }
        }
    }
]);

class PlacementPolicyToggleViewModel {
    policyTypeOptions = policyTypeOptions;
    toggleGroupId = randomString();
    hasFocus = false;
    selectedPolicy = null;

    constructor(params) {
        const { selectedPolicy, hasFocus } = params;

        this.hasFocus = hasFocus || false;
        this.selectedPolicy = ko.isWritableObservable(selectedPolicy) ?
            selectedPolicy :
            ko.observable(ko.unwrap(selectedPolicy));
    }
}

export default {
    viewModel: PlacementPolicyToggleViewModel,
    template: template
};
