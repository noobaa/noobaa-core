/* Copyright (C) 2016 NooBaa */

import template from './object-parts-list.html';
import Observer from 'observer';
import PartRowViewModel from './part-row';
import PartDetailsViewModel from './part-details';
import { action$, state$ } from 'state';
import { fetchObjectParts, openObjectPreviewModal, requestLocation } from 'action-creators';
import { paginationPageSize } from 'config';
import { flatMap } from 'utils/core-utils';
import { realizeUri } from 'utils/browser-utils';
import { getObjectId, summerizePartDistribution } from 'utils/object-utils';
import { getPlacementTypeDisplayName, getResiliencyTypeDisplay } from 'utils/bucket-utils';
import { capitalize } from 'utils/string-utils';
import ko from 'knockout';

function _summrizeResiliency(resiliency) {
    const { kind, replicas, dataFrags, parityFrags } = resiliency;
    const counts = kind === 'ERASURE_CODING' ?
        [dataFrags, parityFrags].join(' + ') :
        replicas;

    return `${getResiliencyTypeDisplay(kind)} (${counts})`;
}

function _getActionsTooltip(isOwner, httpsNoCert, verb, align) {
    if (!isOwner) {
        return {
            text: `${capitalize(verb)} is only available for the system owner`,
            align: align
        };

    }

    if (httpsNoCert) {
        return {
            text: `A certificate must be installed in order to ${verb} the file via https`,
            align: align
        };
    }

    return '';
}

class ObjectPartsListViewModel extends Observer {
    pageSize = paginationPageSize;
    pathname = '';
    selectedRow = -1;
    partsLoaded = ko.observable();
    page = ko.observable();
    s3SignedUrl = ko.observable();
    partCount = ko.observable();
    placementType = ko.observable();
    resilinecySummary = ko.observable();
    resourceCount = ko.observable();
    downloadTooltip = ko.observable();
    previewTooltip = ko.observable();
    rows = ko.observableArray();
    isRowSelected = ko.observable();
    partDetails = new PartDetailsViewModel(() => this.onCloseDetails())
    areActionsAllowed = ko.observable();
    actionsTooltip = ko.observable();

    constructor() {
        super();

        this.observe(
            state$.get('location'),
            this.onLocation
        );
        this.observe(
            state$.getMany(
                'buckets',
                ['objects', 'items'],
                ['objectParts', 'items'],
                'accounts',
                ['session', 'user'],
                'location',
                ['system', 'sslCert']
            ),
            this.onState
        );
    }

    onLocation(location) {
        const { bucket, object } = location.params;
        const { page } = location.query;
        if (!bucket || !object) return;

        action$.onNext(fetchObjectParts({
            bucket: bucket,
            key: object,
            skip: (Number(page) || 0) * this.pageSize,
            limit: this.pageSize
        }));
    }

    onState([buckets, objects, parts, accounts, user, location, sslCert]) {
        const { pathname, query, params } = location;
        const { system, bucket: bucketName, object: objId } = params;
        const page = Number(query.page) || 0;
        const selectedRow = query.row === null ? -1  : Number(query.row);
        const bucket = buckets && buckets[bucketName];
        const object = objects && objects[getObjectId(bucketName, objId)];

        if (!bucket || !accounts || !user || !object || !parts) {
            if (!bucket || !object) {
                this.partCount(0);
                this.placementType('');
                this.resilinecySummary('');
                this.resourceCount('');
            }
            this.partsLoaded(false);
            this.areActionsAllowed(false);

        } else {
            const { isOwner } = accounts[user];
            const { placement, resiliency } = bucket;
            const httpsNoCert = location.protocol === 'https' && !sslCert;
            const placementType = getPlacementTypeDisplayName(placement.policyType);
            const resilinecySummary = _summrizeResiliency(resiliency);
            const resources = flatMap(
                placement.mirrorSets,
                mirrorSet => mirrorSet.resources
            );

            const partDistributions = parts
                .map(part => summerizePartDistribution(bucket, part));

            const rows = parts
                .map((part, i) => {
                    const row = this.rows.get(i) || new PartRowViewModel(() => this.onSelectRow(i));
                    row.onState(part, partDistributions[i], selectedRow === i);
                    return row;
                });

            this.pathname = pathname;
            this.s3SignedUrl(object.s3SignedUrl);
            this.partCount(object.partCount);
            this.placementType(placementType);
            this.resilinecySummary(resilinecySummary);
            this.resourceCount(resources.length);
            this.downloadTooltip(_getActionsTooltip(isOwner, httpsNoCert, 'download'));
            this.previewTooltip(_getActionsTooltip(isOwner, httpsNoCert, 'preview', 'end'));
            this.rows(rows);
            this.page(page);
            this.isRowSelected(selectedRow >= 0);
            this.areActionsAllowed(isOwner && !httpsNoCert);

            if (selectedRow >= 0) {
                const { seq } = parts[selectedRow];
                const distribution = partDistributions[selectedRow];
                this.partDetails.onState(seq, distribution, system);
            }

            this.partsLoaded(true);
        }
    }

    onPreviewFile() {
        action$.onNext(openObjectPreviewModal(this.s3SignedUrl()));
    }

    onDownloadClick() {
        return this.areActionsAllowed();
    }

    onSelectRow(row) {
        const page = this.page();
        const url = realizeUri(this.pathname, {}, { page, row });
        action$.onNext(requestLocation(url, this.isRowSelected()));
    }

    onPage(page) {
        page = page || undefined;
        const url = realizeUri(this.pathname, {}, { page });
        action$.onNext(requestLocation(url, this.isRowSelected()));
    }

    onCloseDetails() {
        const page = this.page();
        const url = realizeUri(this.pathname, {}, { page });
        action$.onNext(requestLocation(url, true));
    }
}

export default {
    viewModel: ObjectPartsListViewModel,
    template: template
};
