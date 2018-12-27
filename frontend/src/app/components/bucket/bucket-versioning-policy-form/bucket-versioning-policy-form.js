/* Copyright (C) 2016 NooBaa */

import template from './bucket-versioning-policy-form.html';
import ConnectableViewModel from 'components/connectable';
import { deepFreeze } from 'utils/core-utils';
import { realizeUri } from 'utils/browser-utils';
import ko from 'knockout';
import * as routes from 'routes';
import {
    requestLocation,
    updateBucketVersioningPolicy
} from 'action-creators';

const policyName = 'versioning';

const modeMapping = deepFreeze({
    DISABLED: {
        icon: {
            name: 'healthy',
            css: 'disabled',
            tooltip: {
                text: 'Disabled',
                align: 'start'
            }
        },
        summary: 'Disabled',
        toggleBtn: {
            text: 'Enable Versioning',
            updateTo: 'ENABLED'
        },
        state: {
            text: 'Disabled',
            css: ''
        }
    },
    SUSPENDED: {
        icon: {
            name: 'problem',
            css: 'warning',
            tooltip: {
                text: 'Suspended',
                align: 'start'
            }
        },
        summary: 'Versioning is currently suspended',
        toggleBtn: {
            text: 'Resume Versioning',
            updateTo: 'ENABLED'
        },
        state: {
            text: 'Suspended',
            css: 'warning'
        }
    },
    ENABLED: {
        icon: {
            name: 'healthy',
            css: 'success',
            tooltip: {
                text: 'Enabled',
                align: 'start'
            }
        },
        summary: 'Enabled',
        toggleBtn: {
            text: 'Suspend Versioning',
            updateTo: 'SUSPENDED'
        },
        state: {
            text: 'Enabled',
            css: ''
        }
    }
});

class BucketVersioningPolicyFormViewModel extends ConnectableViewModel {
    isExpanded = ko.observable();
    toggleUri = '';
    bucketName = '';
    toggleBtn = {
        text: ko.observable(),
        updateTo: ''
    };
    stateIcon = {
        name: ko.observable(),
        css: ko.observable(),
        tooltip: ko.observable()
    };
    summary = ko.observable();
    details = [{
        label: 'Object versioning state',
        template: 'styled-text',
        value: {
            text: ko.observable(),
            css: ko.observable()
        }
    }];

    selectState(state) {
        const { location, buckets } = state;
        const { bucket: bucketName } = location.params;
        return [
            location,
            buckets && buckets[bucketName]
        ];
    }

    mapStateToProps(location, bucket) {
        if (!bucket || location.route !== routes.bucket) {
            ko.assignToProps(this, {
                isExpanded: false
            });
        } else {
            const { system, tab = 'data-policies', section } = location.params;
            const toggleSection = section === policyName ? undefined : policyName;
            const {
                icon,
                summary,
                toggleBtn,
                state
            } = modeMapping[bucket.versioning.mode];

            ko.assignToProps(this, {
                isExpanded: section === policyName,
                toggleUri: realizeUri(
                    routes.bucket,
                    { system, bucket: bucket.name, tab, section: toggleSection }
                ),
                bucketName: bucket.name,
                toggleBtn,
                stateIcon: icon,
                summary,
                details: [{ value: state }]
            });
        }
    }

    onToggleSection() {
        this.dispatch(requestLocation(this.toggleUri));
    }

    onToggleVersioning() {
        this.dispatch(updateBucketVersioningPolicy(
            this.bucketName,
            this.toggleBtn.updateTo
        ));
    }
}

export default {
    viewModel: BucketVersioningPolicyFormViewModel,
    template: template
};
