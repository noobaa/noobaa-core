/* Copyright (C) 2025 NooBaa */
"use strict";

async function run({ dbg, system_store }) {
    try {
        dbg.log0("starting upgrade system_address mongodb api...");
        const system_updates = [system_store.data.systems[0]]
            .map(system_record => {
                const address_list = system_record.system_address;
                if (!Array.isArray(address_list) ||
                    !address_list.some(address_entry => address_entry && address_entry.api === "mongodb")) {
                    return false;
                }
                return {
                    _id: system_record._id,
                    system_address: address_list.map(address_entry => {
                        if (address_entry && address_entry.api === "mongodb") {
                            return { ...address_entry, api: "postgres" };
                        }
                        return address_entry;
                    }),
                };
            })
            .filter(Boolean);
        if (system_updates.length > 0) {
            dbg.log0("rewriting legacy api mongodb to postgres in system_address");
            await system_store.make_changes({ update: { systems: system_updates } });
        } else {
            dbg.log0("upgrade system_address mongodb api: no upgrade needed...");
        }
    } catch (error) {
        dbg.error("got error while upgrading system_address mongodb api:", error);
        throw error;
    }
}

module.exports = {
    run,
    description: "Rewrite system_address entries with legacy api mongodb to postgres",
};
