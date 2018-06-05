/* Copyright (C) 2016 NooBaa */

import template from './bucket-versioning-policy-form.html';
import Observer from 'observer';
import { deepFreeze } from 'utils/core-utils';
import { realizeUri } from 'utils/browser-utils';
import { state$, action$ } from 'state';
import ko from 'knockout';
import { getMany } from 'rx-extensions';
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

class BucketVersioningPolicyFormViewModel extends Observer {
    isExpanded = ko.observable();
    bucketName = '';
    mode = ko.observable();
    stateIcon = ko.observable();
    summary = ko.observable();
    toggleBtnText = ko.observable();
    details = [
        {
            label: 'Object versioning state',
            template: 'styled-text',
            value: ko.observable()
        }
    ];

    constructor() {
        super();

        this.observe(
            state$.pipe(
                getMany(
                    'buckets',
                    'location'
                )
            ),
            this.onState
        );
    }

    onState([buckets, location]) {
        if (location.route !== routes.bucket) {
            return;
        }

        const { system, bucket: bucketName, tab = 'data-policies', section } = location.params;
        const bucket = buckets && buckets[bucketName];
        const mode = bucket ? bucket.versioning.mode : 'DISABLED';
        const { icon, summary, toggleBtn, state } = modeMapping[mode];
        const toggleSection = section === policyName ? undefined : policyName;
        const toggleUri = realizeUri(
            routes.bucket,
            { system, bucket: bucketName, tab, section: toggleSection }
        );

        this.isExpanded(section === policyName);
        this.bucketName = bucketName;
        this.mode = mode;
        this.stateIcon(icon);
        this.summary(summary);
        this.toggleBtnText(toggleBtn.text);
        this.details[0].value(state);
        this.toggleUri = toggleUri;
    }

    onToggleSection() {
        action$.next(requestLocation(this.toggleUri));
    }

    onToggleVersioning() {
        const { updateTo } = modeMapping[this.mode].toggleBtn;
        action$.next(updateBucketVersioningPolicy(this.bucketName, updateTo));
    }
}

export default {
    viewModel: BucketVersioningPolicyFormViewModel,
    template: template
};
