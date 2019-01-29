/* Copyright (C) 2016 NooBaa */

import { mergeMap } from 'rxjs/operators';
import { ofType } from 'rx-extensions';
import { UPDATE_SERVER_DNS_SETTINGS } from 'action-types';
import { completeUpdateServerDNSSettings, failUpdateServerDNSSettings } from 'action-creators';

export default function(action$, { api }) {
    return action$.pipe(
        ofType(UPDATE_SERVER_DNS_SETTINGS),
        mergeMap(async action => {
            const {
                secret,
                hostname,
                primaryDNS,
                secondaryDNS,
                searchDomains
            } = action.payload;

            const dnsServers = [primaryDNS, secondaryDNS].filter(Boolean);

            try {
                await api.cluster_server.update_dns_servers({
                    target_secret: secret,
                    dns_servers: dnsServers,
                    search_domains: searchDomains
                });

                return completeUpdateServerDNSSettings(secret, hostname);

            } catch (error) {
                return failUpdateServerDNSSettings(secret, hostname, error);
            }
        })
    );
}
